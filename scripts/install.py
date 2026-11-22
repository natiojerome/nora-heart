#!/usr/bin/env python3
"""First installation, resumable by installation UUID. No production paths/accounts imported."""
import argparse
import fcntl
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import platform
import pwd
import secrets
import shutil
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
import urllib.parse
import uuid

REPOSITORY = Path(__file__).resolve().parent.parent
PNPM = '12.15.0'

def run(args, **kwargs):
    result = subprocess.run([str(a) for a in args], capture_output=True, **kwargs)
    if result.returncode:
        # Commands may contain connection data in their diagnostics. Never relay it.
        raise RuntimeError('Échec de ' + str(args[0]) + ' ; étape à reprendre sans effacer les données.')
    return result.stdout.decode().strip()

def atomic(file, value, mode=0o600):
    file = Path(file)
    tmp = file.with_name(file.name + '.' + uuid.uuid4().hex + '.tmp')
    with os.fdopen(os.open(tmp, os.O_CREAT | os.O_EXCL | os.O_WRONLY, mode), 'w') as stream:
        stream.write(value)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(tmp, file)

def available_port(preferred=0,host='127.0.0.1'):
    with socket.socket(socket.AF_INET6 if ':' in host else socket.AF_INET,socket.SOCK_STREAM) as listener:
        listener.bind((host, preferred))
        return listener.getsockname()[1]

def machine_address():
    # Hetzner link-local metadata; no third-party IP service or secret queried.
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open('http://169.254.169.254/hetzner/v1/metadata/public-ipv4',timeout=1) as response:
            candidate=ipaddress.ip_address(response.read(128).decode().strip())
        if candidate.is_global:return str(candidate)
    except Exception:pass
    if shutil.which('ip'):
        try:
            route=json.loads(run(['ip','-j','route','get','1.1.1.1']))[0]
            candidate=ipaddress.ip_address(route.get('prefsrc') or route.get('src'))
            if not candidate.is_loopback and not candidate.is_link_local:return str(candidate)
        except Exception:pass
        interfaces=json.loads(run(['ip','-j','address','show','scope','global']))
        addresses=[ipaddress.ip_address(a['local']) for interface in interfaces for a in interface.get('addr_info',[]) if a.get('family') in ['inet','inet6']]
        for candidate in sorted(addresses,key=lambda a:(not a.is_global,a.version)):
            if not candidate.is_loopback and not candidate.is_link_local:return str(candidate)
    raise RuntimeError('Adresse IP non détectée ; préciser --address ADRESSE_IP.')

def network_settings(domain=None,address=None,private=False):
    if domain and (address or private) or address and private:
        raise RuntimeError('Choisir --domain, --address ou --private ; options incompatibles.')
    if domain:return {'access':'domain','host':'127.0.0.1','address':None}
    if private:return {'access':'private','host':'127.0.0.1','address':None}
    try:ip=ipaddress.ip_address((address or machine_address()).strip('[]'))
    except ValueError:raise RuntimeError('--address doit être une adresse IP valide.')
    if ip.is_unspecified or ip.is_multicast or ip.is_link_local:raise RuntimeError('Adresse IP de connexion requise, pas une adresse d’écoute ou multicast.')
    return {'access':'ip','host':'0.0.0.0' if ip.version==4 else '::','address':str(ip)}

def web_origin(identity):
    if identity['domain']:return 'https://'+identity['domain']
    address=identity.get('address') if identity.get('access')=='ip' else 'localhost'
    if ':' in address:address='['+address+']'
    return 'http://'+address+':'+str(identity['port'])

def local_url(identity):
    return 'http://'+('[::1]' if identity.get('host')=='::' else '127.0.0.1')+':'+str(identity['port'])

def unit_value(value):
    return json.dumps(str(value).replace('%', '%%'), ensure_ascii=False)

def unit_command(args):
    # ':' disables systemd's dollar expansion; percent specifiers are escaped above.
    return ':' + ' '.join(unit_value(a) for a in args)

def env_text(values):
    return ''.join(k + '=' + json.dumps(str(v), ensure_ascii=False) + '\n' for k, v in values.items())

def keep_runtime(file, values, binary):
    if not file.exists():
        atomic(file,env_text(values))
        return
    reader='const fs=require("node:fs"),u=require("node:util");process.stdout.write(JSON.stringify(u.parseEnv(fs.readFileSync(process.argv[1],"utf8"))))'
    existing=json.loads(run([binary,'-e',reader,file]))
    keys=['PORT','HARNESS_WEB_HOST','HARNESS_WEB_ORIGIN','HARNESS_DATABASE_URL','HARNESS_STORAGE_DRIVER','HARNESS_WEB_STATE_DIR','HARNESS_CHATGPT_AUTH_DIR','HARNESS_PROJECTS_ROOT','HARNESS_HOST_SOCKET','HARNESS_WALLETS_SOCKET']
    if any(existing.get(k)!=str(values[k]) for k in keys):
        raise RuntimeError('Configuration structurelle personnalisée : conserver les données et adapter les services explicitement ; aucun fichier remplacé.')
    # In particular retain owner-added credentials, password rotation and settings.

def wait_for(check, label, seconds=90):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            if check():
                return
        except Exception:
            pass
        time.sleep(0.25)
    raise RuntimeError(label + ' indisponible ; installation conservée pour reprise.')

def health(url):
    with urllib.request.urlopen(url, timeout=3) as response:
        return response.status == 200

def units_active(identity):
    units=[identity['unit']+suffix for suffix in ['-web.service','-host.service','-search.service','-wallets.service','-wallets-backup.timer']]
    result=subprocess.run(['systemctl','is-active',*units],capture_output=True,text=True)
    return result.stdout.split()==['active']*len(units)

def socket_ready(file):
    with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as connection:
        connection.settimeout(2)
        connection.connect(file)
    return True

def verify_web(identity, credentials, public=False):
    origin=identity['origin']
    endpoint=origin if public else local_url(identity)
    headers={'Host':urllib.parse.urlparse(origin).netloc,'Origin':origin,'Content-Type':'application/json'}
    request=urllib.request.Request(endpoint+'/api/login',data=json.dumps({'password':credentials['password']}).encode(),headers=headers)
    with urllib.request.urlopen(request,timeout=5) as response:
        cookie=response.headers['Set-Cookie'].split(';')[0]
    request=urllib.request.Request(endpoint+'/api/state',headers={**headers,'Cookie':cookie})
    with urllib.request.urlopen(request,timeout=5) as response:
        state=json.load(response)
    return state.get('authenticated') and state.get('assistant') is not None and state.get('conversationsAvailable') and state.get('installation',{}).get('available')

def check_terminal(identity, credentials):
    endpoint=local_url(identity)
    headers={'Host':urllib.parse.urlparse(identity['origin']).netloc,'Origin':identity['origin'],'Content-Type':'application/json'}
    with urllib.request.urlopen(urllib.request.Request(endpoint+'/api/login',data=json.dumps({'password':credentials['password']}).encode(),headers=headers),timeout=5) as response:
        headers['Cookie']=response.headers['Set-Cookie'].split(';')[0]
        headers['x-csrf-token']=json.load(response)['csrf']
    with urllib.request.urlopen(urllib.request.Request(endpoint+'/api/projects-root/commands',data=json.dumps({'command':'node --version','cwd':'.'}).encode(),headers=headers),timeout=10) as response:
        command=json.load(response)['command']
    deadline=time.monotonic()+30
    while time.monotonic()<deadline:
        with urllib.request.urlopen(urllib.request.Request(endpoint+'/api/projects-root/commands/'+command['id'],headers=headers),timeout=5) as response:
            result=json.load(response)
        if result['command']['status']!='running':
            if result['command']['exitCode']!=0 or not result['output'].strip().startswith('v24.'):
                raise RuntimeError('Terminal protégé indisponible : vérifier les namespaces/AppArmor. Données conservées.')
            return
        time.sleep(0.1)
    raise RuntimeError('Vérification terminal en attente ; aucune installation déclarée prête.')

def ensure_node(root):
    version = (root / '.node-version').read_text().strip()
    arch = {'x86_64': 'x64', 'aarch64': 'arm64'}.get(platform.machine())
    if not arch:
        raise RuntimeError('Architecture requise : Linux x86_64 ou aarch64.')
    folder = 'node-v' + version + '-linux-' + arch
    binary = root / '.tools' / folder / 'bin/node'
    if not binary.exists():
        print('Téléchargement du runtime Node qualifié, vérification SHA-256…', flush=True)
        with tempfile.TemporaryDirectory(prefix='heart-node-') as tmp:
            archive = Path(tmp) / (folder + '.tar.xz')
            base = 'https://nodejs.org/dist/v' + version + '/'
            urllib.request.urlretrieve(base + archive.name, archive)
            sums = urllib.request.urlopen(base + 'SHASUMS256.txt').read().decode()
            expected = next(line.split()[0] for line in sums.splitlines() if line.split()[-1] == archive.name)
            if hashlib.sha256(archive.read_bytes()).hexdigest() != expected:
                raise RuntimeError('Empreinte du runtime incorrecte.')
            (root / '.tools').mkdir(exist_ok=True)
            with tarfile.open(archive) as source:
                # Official, checksummed archive; disallow absolute paths and parent traversal.
                if any(m.name.startswith('/') or '..' in Path(m.name).parts for m in source.getmembers()):
                    raise RuntimeError('Archive Node invalide.')
                source.extractall(root / '.tools')
    run([binary, '-e', 'if(process.versions.node.split(".")[0]!=="24")process.exit(1)'])
    return binary

def service(root, name, user, command, environment=None, writes=(), group=None, after=(), extra='', once=False):
    text = '[Unit]\nDescription=Nora Heart ' + name + '\nAfter=network-online.target ' + ' '.join(after) + '\nWants=network-online.target\n\n[Service]\n'
    text += 'User=' + user + '\nGroup=' + (group or user) + '\nWorkingDirectory=' + str(root).replace('%','%%') + '\n'
    if environment:
        text += 'EnvironmentFile=' + str(environment).replace('%','%%') + '\n'
    text += 'ExecStart=' + unit_command(command) + ('\nType=oneshot\nRestart=no\n' if once else '\nRestart=always\nRestartSec=2\n')+'UMask=0077\nLimitCORE=0\n'
    if user != 'root':
        text += 'NoNewPrivileges=true\nProtectSystem=strict\nPrivateTmp=true\n'
        text += 'ReadWritePaths=' + ' '.join(unit_value(w) for w in writes) + '\n'
    text += extra + '\n[Install]\nWantedBy=multi-user.target\n'
    atomic(Path('/etc/systemd/system') / (name + '.service'), text, 0o644)

def install(options):
    if os.geteuid() != 0 or not Path('/run/systemd/system').exists():
        raise RuntimeError('Installer comme root sur un serveur systemd Debian/Ubuntu.')
    if not shutil.which('systemd-creds'):
        raise RuntimeError('systemd-creds requis : Debian 12+ ou Ubuntu 24.04+.')
    if options.port and not 1024<=options.port<=65535:
        raise RuntimeError('Port requis entre 1024 et 65535.')
    if options.address:
        try:options.address=str(ipaddress.ip_address(options.address.strip('[]')))
        except ValueError:raise RuntimeError('--address doit être une adresse IP valide.')
    if options.private and (options.domain or options.address) or options.domain and options.address:
        raise RuntimeError('Choisir --domain, --address ou --private ; options incompatibles.')
    root = Path(options.path).expanduser().absolute().resolve()
    if root != REPOSITORY or root == Path('/') or any(c in str(root) for c in '\n\r\0'):
        raise RuntimeError('Exécuter l’installateur dans le dépôt cloné au chemin choisi.')
    if options.domain and not __import__('re').fullmatch(r'(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?', options.domain):
        raise RuntimeError('Domaine invalide ; fournir un nom DNS sans protocole ni chemin.')
    os.chmod(root,0o755)
    private = root / '.heart'
    config = private / 'config'
    manifest = private / 'install.json'
    if not manifest.exists() and private.exists() and any(private.iterdir()):
        raise RuntimeError('État privé existant non reconnu ; aucun écrasement.')
    private.mkdir(exist_ok=True)
    lock=open(private / '.install.lock','a')
    try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError: raise RuntimeError('Une installation est déjà en cours dans ce dossier.')
    config.mkdir(mode=0o700, exist_ok=True)
    identity = json.loads(manifest.read_text()) if manifest.exists() else None
    if identity and identity['root'] != str(root):
        raise RuntimeError('Installation déplacée : migration explicite requise, aucun chemin réécrit.')
    if not identity:
        install_id = str(uuid.uuid4())
        network=network_settings(options.domain,options.address,options.private)
        identity = {'version': 1, 'id': install_id, 'root': str(root), 'unit': 'heart-' + install_id.replace('-', '')[:10], 'port': available_port(options.port,network['host']), 'domain': options.domain, 'searchPort': available_port(), 'enginePort': available_port(), 'phase': 'created',**network}
        atomic(manifest, json.dumps(identity))
    elif (options.domain and identity['domain'] != options.domain) or (options.port and identity['port'] != options.port):
        raise RuntimeError('Une autre URL/port est déjà enregistré ; pas de modification implicite.')
    if (options.address and options.address!=identity.get('address')) or (options.private and identity.get('access','domain' if identity['domain'] else 'private')!='private'):
        raise RuntimeError('Accès réseau existant différent ; aucune exposition ou migration implicite.')
    name = identity['unit']
    if identity['phase'] == 'ready':
        try: healthy=units_active(identity) and health('http://127.0.0.1:'+str(identity['enginePort'])+'/') and verify_web(identity,json.loads((config/'secrets.json').read_text()),public=bool(identity['domain']))
        except Exception: healthy=False
        if healthy:
            print('Installation existante saine, comptes et données conservés.')
            print(identity['origin'])
            return
    print('Installation ' + identity['id'] + ' dans ' + str(root), flush=True)
    print('Préparation des dépendances système…', flush=True)
    run(['apt-get', 'update', '-qq'])
    run(['apt-get', 'install', '-y', '-qq', 'ca-certificates', 'curl', 'git', 'python3', 'xz-utils', 'bubblewrap', 'ripgrep', 'acl', 'util-linux'], env={**os.environ, 'DEBIAN_FRONTEND': 'noninteractive'})
    if not shutil.which('docker'):
        with tempfile.TemporaryDirectory(prefix='heart-docker-') as folder:
            script = Path(folder) / 'docker.sh'
            urllib.request.urlretrieve('https://get.docker.com', script)
            run(['sh', script])
    run(['docker', 'info'])
    if identity['domain']:
        if identity['phase'] == 'created':
            available_port(80)
            available_port(443)
    try:
        pwd.getpwnam(name)
    except KeyError:
        run(['useradd', '--system', '--user-group', '--home-dir', private / 'state', '--no-create-home', '--shell', '/usr/sbin/nologin', name])
    account = pwd.getpwnam(name)
    os.chmod(private, 0o710)
    os.chown(private, 0, account.pw_gid)
    for ancestor in root.parents:
        if ancestor != Path('/'):
            run(['setfacl', '-m', 'u:' + name + ':--x', ancestor])
    for relative in ['state', 'auth', 'wallets', 'projects', 'state/conversations']:
        folder = root / 'projects' if relative == 'projects' else private / relative
        folder.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.chown(folder, account.pw_uid, account.pw_gid)
    binary = ensure_node(root)
    env = {**os.environ, 'PATH': str(binary.parent) + ':' + os.environ['PATH']}
    pnpm = root / '.tools/pnpm/node_modules/.bin/pnpm'
    if not pnpm.exists():
        run([binary.parent / 'npm', 'install', '--prefix', root / '.tools/pnpm', '--no-audit', '--no-fund', 'pnpm@' + PNPM], env=env)
    print('Installation des dépendances verrouillées…', flush=True)
    run([pnpm, 'install', '--frozen-lockfile'], cwd=root, env=env)
    secrets_file = config / 'secrets.json'
    if not secrets_file.exists():
        if identity['phase']=='ready' or ((private/'postgres').exists() and any((private/'postgres').iterdir())):
            raise RuntimeError('Secrets manquants sur une base existante : restaurer la configuration, aucun mot de passe recréé.')
        password = Path(options.password_file).read_text().strip() if options.password_file else secrets.token_urlsafe(24)
        if len(password) < 16 or any(c in password for c in '\n\r\0'):
            raise RuntimeError('Mot de passe propriétaire : au moins 16 caractères, une ligne.')
        atomic(secrets_file, json.dumps({'password': password, 'session': secrets.token_hex(32), 'postgres': secrets.token_hex(32)}))
        atomic(config / 'owner-password', password + '\n')
    credentials = json.loads(secrets_file.read_text())
    pg_name = name + '-postgres'
    print('Démarrage du PostgreSQL dédié (accès local uniquement)…', flush=True)
    inspect = subprocess.run(['docker', 'inspect', pg_name], capture_output=True)
    if inspect.returncode:
        pg_env = config / 'postgres.env'
        atomic(pg_env, 'POSTGRES_USER=heart\nPOSTGRES_DB=heart\nPOSTGRES_PASSWORD=' + credentials['postgres'] + '\n')
        (private / 'postgres').mkdir(mode=0o700, exist_ok=True)
        pg_uid=int(run(['docker','run','--rm','--entrypoint','id','postgres:18.4-bookworm','-u','postgres']))
        pg_gid=int(run(['docker','run','--rm','--entrypoint','id','postgres:18.4-bookworm','-g','postgres']))
        os.chown(private/'postgres',pg_uid,pg_gid)
        run(['docker', 'run', '-d', '--name', pg_name, '--label', 're.natio.heart.installation=' + identity['id'], '--restart=unless-stopped', '-p', '127.0.0.1::5432', '--mount', 'type=bind,src=' + str(private / 'postgres') + ',dst=/var/lib/postgresql', '--env-file', pg_env, 'postgres:18.4-bookworm'])
    else:
        info = json.loads(inspect.stdout)[0]
        if info['Config']['Labels'].get('re.natio.heart.installation') != identity['id']:
            raise RuntimeError('Conteneur existant sans identité attendue.')
        run(['docker', 'start', pg_name])
    wait_for(lambda: subprocess.run(['docker', 'exec', pg_name, 'pg_isready', '-U', 'heart', '-d', 'heart'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0, 'PostgreSQL')
    info = json.loads(run(['docker', 'inspect', pg_name]))[0]
    db_port = info['NetworkSettings']['Ports']['5432/tcp'][0]['HostPort']
    print('Installation de la recherche web locale…',flush=True)
    search_settings=config / 'search.yml'
    if not search_settings.exists():
        atomic(search_settings,(root / 'deploy/search.settings.example.yml').read_text().replace('REPLACE_WITH_RANDOM_SECRET_OUTSIDE_REPOSITORY',secrets.token_hex(32)),0o644)
    engine_name=name+'-search-engine'
    if subprocess.run(['docker','inspect',engine_name],capture_output=True).returncode:
        image=next(line.strip().split(': ',1)[1] for line in (root / 'deploy/search.compose.yml').read_text().splitlines() if 'image:' in line)
        run(['docker','run','-d','--name',engine_name,'--label','re.natio.heart.installation='+identity['id'],'--restart=unless-stopped','-p','127.0.0.1:'+str(identity['enginePort'])+':8080','--mount','type=bind,src='+str(search_settings)+',dst=/etc/searxng/settings.yml,readonly',image])
    else: run(['docker','start',engine_name])
    origin = web_origin(identity)
    identity['origin'] = origin
    values = {'NODE_ENV': 'production', 'PATH': env['PATH'], 'PORT': identity['port'], 'HARNESS_WEB_HOST': identity.get('host','127.0.0.1'), 'HARNESS_WEB_ORIGIN': origin,
              'HARNESS_WEB_SESSION_SECRET': credentials['session'], 'HARNESS_WEB_PASSWORD': credentials['password'],
              'HARNESS_STORAGE_DRIVER': 'postgres', 'HARNESS_DATABASE_URL': 'postgresql://heart:' + credentials['postgres'] + '@127.0.0.1:' + db_port + '/heart',
              'HARNESS_WEB_STATE_DIR': str(private / 'state'), 'HARNESS_CHATGPT_AUTH_DIR': str(private / 'auth'), 'HARNESS_PROJECTS_ROOT': str(root / 'projects'),
              'HARNESS_MAINTENANCE_FILE': str(private / 'maintenance'), 'HARNESS_HOST_SOCKET': '/run/'+name+'-host/terminal.sock',
              'HARNESS_WALLETS_SOCKET':'/run/'+name+'-wallets/api.sock','HARNESS_WALLETS_SIGN_ENABLED':'1',
              'HARNESS_INSTALL_CONFIG_FILE': str(private / 'state/installation.json'), 'HARNESS_REQUIRE_REMOTE_MEMORY': '1', 'HARNESS_LOCAL_SEARCH_URL':'http://127.0.0.1:'+str(identity['searchPort'])+'/mcp'}
    runtime = config / 'runtime.env'
    keep_runtime(runtime,values,binary)
    command = [binary, root / 'node_modules/tsx/dist/cli.mjs']
    wallet_key=config / 'wallet-master.cred'
    if not wallet_key.exists():
        if (private/'wallets/wallets.enc').exists():
            raise RuntimeError('Credential wallet manquant : restaurer la clé, aucun remplacement du coffre existant.')
        # No time gating: restored installations must tolerate host clock skew.
        run(['systemd-creds','encrypt','--with-key=host','--timestamp=@0','--name=master','-',wallet_key],input=os.urandom(32))
        os.chmod(wallet_key,0o600)
    # Stable credential locator: some systemd versions mishandle whitespace in
    # LoadCredentialEncrypted sources. Material stays inside the chosen root.
    credential_directory=Path('/etc/nora-heart')/identity['id']
    credential_directory.mkdir(parents=True,exist_ok=True,mode=0o700)
    credential_link=credential_directory/'master.cred'
    if credential_link.is_symlink():
        if credential_link.resolve()!=wallet_key.resolve():raise RuntimeError('Référence de credential existante différente.')
    elif credential_link.exists():raise RuntimeError('Chemin de credential occupé ; aucun écrasement.')
    else:credential_link.symlink_to(wallet_key)
    wallet_env=config / 'wallets.env'
    atomic(wallet_env,env_text({'NORA_WALLETS_STATE':str(private/'wallets'),'HARNESS_WALLETS_SOCKET':values['HARNESS_WALLETS_SOCKET'],'HARNESS_INSTALL_CONFIG_FILE':values['HARNESS_INSTALL_CONFIG_FILE']}))
    if not (private / 'wallets/wallets.enc').exists():
        service(root,name+'-wallet-init',name,[*command,root/'src/interfaces/wallets.ts','init-empty'],wallet_env,writes=[private/'wallets'],extra='LoadCredentialEncrypted=master:'+str(credential_link)+'\n',once=True)
        run(['systemctl','daemon-reload'])
        run(['systemctl','start',name+'-wallet-init.service'])
    service(root,name+'-wallets',name,[*command,root/'src/interfaces/wallets.ts','daemon'],wallet_env,writes=[private/'wallets'],extra='RuntimeDirectory='+name+'-wallets\nRuntimeDirectoryMode=0750\nLoadCredentialEncrypted=master:'+str(credential_link)+'\n')
    service(root,name+'-wallets-backup',name,[*command,root/'src/interfaces/wallets.ts','backup-if-configured'],wallet_env,writes=[private/'wallets'],extra='LoadCredentialEncrypted=master:'+str(credential_link)+'\n',once=True)
    atomic(Path('/etc/systemd/system')/(name+'-wallets-backup.timer'),'[Unit]\nDescription=Heart wallet recovery backup\n[Timer]\nOnBootSec=5m\nOnCalendar=daily\nPersistent=true\n[Install]\nWantedBy=timers.target\n',0o644)
    run([*command, root / 'src/interfaces/migrate.ts'], cwd=root, env={**env, **{k:str(v) for k,v in values.items()}})
    worker_env = config / 'worker.env'
    atomic(worker_env, env_text({'HARNESS_HOST_SOCKET': values['HARNESS_HOST_SOCKET'], 'HARNESS_HOST_STATE_DIR': str(private / 'host/commands'), 'HARNESS_HOST_WORKSPACES': str(private / 'state/conversations'), 'HARNESS_HOST_HOME': str(private / 'host/home'), 'HARNESS_HOST_UNIT': name + '-host.service'}))
    service(root, name + '-host', 'root', [*command, root / 'src/interfaces/host-terminal.ts'], worker_env, group=name, extra='UMask=0007\nRuntimeDirectory='+name+'-host\nRuntimeDirectoryMode=0750\n')
    search_env=config / 'search.env'
    atomic(search_env,env_text({'HARNESS_SEARCH_PORT':identity['searchPort'],'HARNESS_SEARCH_ENGINE_URL':'http://127.0.0.1:'+str(identity['enginePort'])}))
    service(root,name+'-search',name,[*command,root/'src/interfaces/search.ts'],search_env,writes=[private/'state'])
    service(root, name + '-web', name, [*command, root / 'src/interfaces/web.ts'], runtime, writes=[private / 'state', private / 'auth', root / 'projects'], after=[name + '-host.service',name+'-search.service',name+'-wallets.service'])
    # AppArmor user-namespace permission required on Ubuntu 24.04; don't replace a host profile.
    restricted_userns=Path('/proc/sys/kernel/apparmor_restrict_unprivileged_userns')
    if restricted_userns.exists() and restricted_userns.read_text().strip()=='1' and shutil.which('apparmor_parser') and not Path('/etc/apparmor.d/heart-bwrap').exists():
        shutil.copyfile(root / 'deploy/heart-bwrap.apparmor', '/etc/apparmor.d/heart-bwrap')
        run(['apparmor_parser', '-r', '/etc/apparmor.d/heart-bwrap'])
    if identity['domain']:
        caddy = config / 'Caddyfile'
        atomic(caddy, identity['domain'] + ' {\n reverse_proxy 127.0.0.1:' + str(identity['port']) + '\n}\n')
        proxy_name = name + '-proxy'
        if subprocess.run(['docker', 'inspect', proxy_name], capture_output=True).returncode:
            (private / 'caddy').mkdir(exist_ok=True)
            run(['docker', 'run', '-d', '--name', proxy_name, '--label', 're.natio.heart.installation=' + identity['id'], '--restart=unless-stopped', '--network=host', '--mount', 'type=bind,src=' + str(caddy) + ',dst=/etc/caddy/Caddyfile,readonly', '--mount', 'type=bind,src=' + str(private / 'caddy') + ',dst=/data', 'caddy:2-alpine'])
    print('Démarrage du web et vérification réelle…', flush=True)
    run(['systemctl', 'daemon-reload'])
    run(['systemctl', 'enable', '--now', name + '-host.service',name+'-search.service',name+'-wallets.service',name+'-wallets-backup.timer', name + '-web.service'])
    wait_for(lambda: health(local_url(identity)+'/healthz'), 'Interface web')
    wait_for(lambda:verify_web(identity,credentials),'Connexion propriétaire et stockage')
    wait_for(lambda:units_active(identity),'Services de l’installation')
    wait_for(lambda:health('http://127.0.0.1:'+str(identity['enginePort'])+'/'),'Moteur de recherche local')
    wait_for(lambda:socket_ready(values['HARNESS_HOST_SOCKET']),'Worker hôte')
    wait_for(lambda:socket_ready(values['HARNESS_WALLETS_SOCKET']),'Wallets locaux')
    print('Vérification du terminal protégé Node 24…',flush=True)
    check_terminal(identity,credentials)
    if identity['domain']:
        print('Vérification HTTPS et certificat (DNS du domaine requis)…',flush=True)
        wait_for(lambda:verify_web(identity,credentials,public=True),'HTTPS public / DNS / certificat')
    identity['phase'] = 'ready'
    atomic(manifest, json.dumps(identity))
    print('Installation prête : ' + origin)
    if identity.get('access','private')=='private' and not identity['domain']:
        print('Accès privé : ssh -L ' + str(identity['port']) + ':127.0.0.1:' + str(identity['port']) + ' utilisateur@serveur, puis ouvrir ' + origin)
    elif not identity['domain']:
        print('Accès direct par IP : '+origin+' (autoriser TCP '+str(identity['port'])+' dans le pare-feu si nécessaire).')
    print('Mot de passe permanent : fichier privé ' + str(config / 'owner-password'))
    try:
        with open('/dev/tty', 'w') as terminal:
            terminal.write('\nMot de passe Heart (conserve-le) : ' + credentials['password'] + '\n')
    except OSError:
        pass
    print('Le premier accès ouvre la personnalisation et les connexions. Aucun compte ou secret de notre installation n’a été importé.')

def main():
    os.umask(0o022)
    parser = argparse.ArgumentParser(description='Installer Heart indépendamment dans le chemin choisi.')
    parser.add_argument('--path', default='/opt/nora-heart')
    parser.add_argument('--domain')
    parser.add_argument('--address',help='Adresse IP annoncée ; détection automatique par défaut.')
    parser.add_argument('--private',action='store_true',help='Écoute locale et tunnel SSH, sur demande uniquement.')
    parser.add_argument('--port', type=int, default=0)
    parser.add_argument('--password-file')
    options = parser.parse_args()
    try:
        install(options)
    except Exception as error:
        print('Installation interrompue : ' + str(error) if isinstance(error, RuntimeError) else 'Installation interrompue ; vérifier les prérequis et le dossier choisi. Aucun secret affiché.', file=sys.stderr)
        return 1
    return 0

if __name__ == '__main__':
    sys.exit(main())
