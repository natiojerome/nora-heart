#!/usr/bin/env python3
"""Install only the dedicated harness database. Never inspect another database."""
import json
import os
from pathlib import Path
import secrets
import subprocess
import time

ROOT = Path(__file__).resolve().parent.parent
PRIVATE = Path('/etc/personal-harness')
CONTAINER = 'personal-harness-postgres'
VOLUME = 'personal-harness-postgres-data'
IMAGE = 'postgres:18.4-bookworm'
PORT = 5547
LABEL = 'org.personal-harness.role'

def command(args, **options):
    result = subprocess.run(args, capture_output=True, **options)
    if result.returncode:
        raise RuntimeError('Commande de déploiement échouée : ' + args[0])
    return result.stdout

def install():
    if os.geteuid() != 0:
        raise RuntimeError('Droits administrateur requis.')
    PRIVATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    web_file = PRIVATE / 'web.env'
    if not web_file.exists():
        raise RuntimeError('Installer le service web avant la base.')
    env_file = PRIVATE / 'postgres.env'
    if not env_file.exists():
        with os.fdopen(os.open(env_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as stream:
            stream.write('POSTGRES_USER=harness\nPOSTGRES_DB=harness\nPOSTGRES_PASSWORD=' + secrets.token_hex(32) + '\n')
    env = dict(line.split('=', 1) for line in env_file.read_text().splitlines() if '=' in line)
    inspection = subprocess.run(['docker', 'inspect', CONTAINER], capture_output=True)
    if inspection.returncode:
        existing_volume = subprocess.run(['docker', 'volume', 'inspect', VOLUME], capture_output=True)
        if existing_volume.returncode == 0:
            labels = json.loads(existing_volume.stdout)[0].get('Labels') or {}
            if labels.get(LABEL) != 'database':
                raise RuntimeError('Volume existant sans identité attendue ; arrêt sans modification.')
        else:
            command(['docker', 'volume', 'create', '--label', LABEL + '=database', VOLUME])
        command(['docker', 'run', '--detach', '--name', CONTAINER, '--label', LABEL + '=database',
                 '--restart=unless-stopped', '--memory=512m', '--cpus=1', '--pids-limit=192',
                 '--publish', f'127.0.0.1:{PORT}:5432', '--mount', f'type=volume,src={VOLUME},dst=/var/lib/postgresql',
                 '--env-file', str(env_file), IMAGE, '-c', 'shared_buffers=64MB', '-c', 'max_connections=30'])
    else:
        info = json.loads(inspection.stdout)[0]
        if (info['Config'].get('Labels') or {}).get(LABEL) != 'database':
            raise RuntimeError('Conteneur existant sans identité attendue ; arrêt sans modification.')
        command(['docker', 'start', CONTAINER])
    for attempt in range(60):
        ready = subprocess.run(['docker', 'exec', CONTAINER, 'pg_isready', '--username=harness', '--dbname=harness'], capture_output=True)
        if ready.returncode == 0:
            break
        time.sleep(0.5)
    else:
        raise RuntimeError('Base dédiée non disponible.')
    connection = f"postgresql://harness:{env['POSTGRES_PASSWORD']}@127.0.0.1:{PORT}/harness"
    current = web_file.read_text()
    lines = [line for line in current.splitlines() if line.startswith('HARNESS_DATABASE_URL=')]
    if lines and lines != ['HARNESS_DATABASE_URL=' + connection]:
        raise RuntimeError('Une connexion différente est configurée ; arrêt sans remplacement.')
    node = ROOT / '.tools' / ('node-v' + (ROOT / '.node-version').read_text().strip() + '-linux-x64/bin/node')
    command([str(node), str(ROOT / 'node_modules/tsx/dist/cli.mjs'), str(ROOT / 'src/interfaces/migrate.ts')],
            env={**os.environ, 'HARNESS_DATABASE_URL': connection})
    if not lines:
        with web_file.open('a') as stream:
            stream.write(('' if current.endswith('\n') else '\n') + 'HARNESS_DATABASE_URL=' + connection + '\n')
    command(['install', '-m', '0755', str(ROOT / 'scripts/backup-postgres.py'), '/usr/local/sbin/personal-harness-backup'])
    backup_unit = Path('/etc/systemd/system/personal-harness-backup.service')
    backup_unit.write_text('[Unit]\nDescription=Backup dedicated personal harness database\nAfter=docker.service\n\n[Service]\nType=oneshot\nExecStart=/usr/local/sbin/personal-harness-backup\nUMask=0077\n')
    Path('/etc/systemd/system/personal-harness-backup.timer').write_text('[Unit]\nDescription=Daily dedicated harness backup\n\n[Timer]\nOnCalendar=*-*-* 03:20:00 UTC\nPersistent=true\nRandomizedDelaySec=300\n\n[Install]\nWantedBy=timers.target\n')
    command(['systemctl', 'daemon-reload'])
    command(['systemctl', 'enable', '--now', 'personal-harness-backup.timer'])
    command(['systemctl', 'start', 'personal-harness-backup.service'])
    print('Base dédiée initialisée, migrations vérifiées, sauvegarde locale quotidienne activée. Service web à redémarrer.')

try:
    install()
except Exception:
    print('Installation PostgreSQL interrompue. Vérifier le service dédié et sa configuration privée ; aucun secret affiché.', file=__import__('sys').stderr)
    raise SystemExit(1)
