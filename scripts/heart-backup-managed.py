#!/usr/bin/env python3
"""Root-only managed backup: drain HTTP mutations, defer on commands, stop briefly.
Keep the age private identity separately; never add it to the configured paths.
"""
from datetime import datetime, timedelta, timezone
import fcntl
import json
import os
import signal
import sys
from pathlib import Path
import subprocess
import tempfile
import time
from urllib.request import build_opener, ProxyHandler
import importlib.util

spec = importlib.util.spec_from_file_location('heart_bundle', Path(__file__).with_name('heart-bundle.py'))
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)


def health(endpoint):
    with build_opener(ProxyHandler({})).open(endpoint, timeout=5) as response:
        return json.load(response)


def main():
    if os.geteuid() != 0:
        raise RuntimeError('Root requis.')
    os.umask(0o077)
    settings = json.loads(subprocess.check_output(['/projects/nora-heart/.tools/node-v24.22.3-linux-x64/bin/node', '/projects/nora-heart/scripts/heart-backup-lock.mjs', '--web-settings'], stderr=subprocess.DEVNULL, text=True))
    directory = Path('/var/backups/personal-harness')
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (directory / '.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        today = datetime.now(timezone.utc).strftime('%Y%m%d')
        if '--force' not in sys.argv and any(directory.glob('heart-' + settings['driver'] + '-' + today + 'T*.tar.age')):
            print('Sauvegarde complète déjà créée aujourd’hui.')
            return
        gate = Path(settings['maintenanceFile'])
        # O_EXCL: do not remove another operator's maintenance marker.
        with gate.open('x') as stream:
            stream.write('backup\n')
        stopped = False
        guard = None
        target = None
        try:
            status = health(settings['healthUrl'])
            if not status.get('maintenance') or status.get('activeMutations') != 0:
                print('Sauvegarde complète différée : travail ou mutation en cours.')
                return
            for root in ('/var/lib/personal-harness/lab/commands', '/var/lib/personal-harness-host/commands'):
                for file in Path(root).glob('*/command.json'):
                    if json.loads(file.read_text())['command']['status'] == 'running':
                        print('Sauvegarde complète différée : commande à terminer ou vérifier.')
                        return
            stopped = True
            subprocess.run(['systemctl', 'stop', 'personal-harness-web.service'], check=True)
            guard = subprocess.Popen(['/projects/nora-heart/.tools/node-v24.22.3-linux-x64/bin/node', '/projects/nora-heart/scripts/heart-backup-lock.mjs'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
            if guard.stdout.readline().strip() != 'LOCKED':
                print('Sauvegarde complète différée : un autre moteur utilise le stockage.')
                return
            now = datetime.now(timezone.utc)
            # Explicit source selection; no private age identity or unrelated projects.
            config = {'revision': subprocess.check_output(['git', '-C', '/projects/nora-heart', 'rev-parse', 'HEAD'], text=True).strip(),
                      'dumpCommand': ['docker', 'exec', 'personal-harness-postgres', 'pg_dump', '--username=harness', '--dbname=harness', '--format=custom'],
                      'paths': {'state': '/var/lib/personal-harness', 'host': '/var/lib/personal-harness-host',
                                'web-config': '/etc/personal-harness/web.env', 'postgres-config': '/etc/personal-harness/postgres.env', 'quota-config': '/etc/personal-harness/quota.env', 'search-config': '/etc/personal-harness/search',
                                'units': '/etc/systemd/system/personal-harness-web.service',
                                'unit-overrides': '/etc/systemd/system/personal-harness-web.service.d'}}
            if Path('/etc/personal-harness/nora-mcps.env').exists():
                config['paths']['mcp-config']='/etc/personal-harness/nora-mcps.env'
            if Path(settings['projectsRoot']).exists():
                config['paths']['projects'] = settings['projectsRoot']
            config['database'] = {'driver': settings['driver'], 'format': 'pg_dump-custom' if settings['driver']=='postgres' else 'sqlite'}
            if settings['driver']=='sqlite':
                config['dumpCommand'] = ['/projects/nora-heart/.tools/node-v24.22.3-linux-x64/bin/node', '/projects/nora-heart/scripts/heart-sqlite-dump.mjs', settings['sqliteFile']]
                config['paths'].pop('postgres-config', None)
                config['paths']['sqlite-runtime'] = settings['sqliteFile'] + '.runtime'
            with tempfile.TemporaryDirectory(prefix='.config-', dir=directory) as folder:
                source = Path(folder) / 'source.tar'
                with source.open('wb') as output:
                    subprocess.run(['git', '-C', '/projects/nora-heart', 'archive', 'HEAD'], stdout=output, check=True)
                config['paths']['source'] = str(source)
                for path in Path('/etc/systemd/system').glob('personal-harness-*'):
                    if path.is_file() and path.name not in ('personal-harness-web.service',):
                        config['paths']['unit-' + path.name] = str(path)
                file = Path(folder) / 'config.json'
                file.write_text(json.dumps(config))
                recipient = Path('/etc/personal-harness/backup-age.recipient').read_text().strip()
                target = directory / ('heart-' + settings['driver'] + '-' + now.strftime('%Y%m%dT%H%M%S%fZ') + '.tar.age')
                bundle.create(file, target, recipient)
                if guard.poll() is not None:
                    target.unlink(missing_ok=True)
                    raise RuntimeError('Verrou de sauvegarde perdu.')
            for file in directory.glob('heart-*.tar.age'):
                if datetime.fromtimestamp(file.stat().st_mtime, timezone.utc) < now - timedelta(days=7):
                    file.unlink()
            print('Sauvegarde complète locale chiffrée terminée.')
        finally:
            if guard:
                try:
                    guard.stdin.close()
                except OSError:
                    pass
                try:
                    guard.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    guard.kill()
                    guard.wait()
                guard.stdout.close()
            if stopped:
                subprocess.run(['systemctl', 'start', 'personal-harness-web.service'], check=True)
                for attempt in range(30):
                    try:
                        if health(settings['healthUrl']).get('ok'):
                            break
                    except Exception:
                        pass
                    time.sleep(0.5)
                else:
                    raise RuntimeError('Service à vérifier.')
            gate.unlink(missing_ok=True)


def interrupted(signum, frame):
    raise SystemExit(128 + signum)


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    try:
        main()
    except Exception:
        print('Sauvegarde complète échouée. Vérifier le service et le marqueur de maintenance.', file=__import__('sys').stderr)
        raise SystemExit(1)
