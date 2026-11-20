#!/usr/bin/env python3
"""Dump only the dedicated harness database; retain seven days locally."""
from datetime import datetime, timedelta, timezone
import fcntl
import os
from pathlib import Path
import subprocess
import tempfile

DIRECTORY = Path('/var/backups/personal-harness')

def backup():
    if os.geteuid() != 0:
        raise RuntimeError('Droits administrateur requis.')
    DIRECTORY.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (DIRECTORY / '.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        handle, name = tempfile.mkstemp(prefix='.dump-', dir=DIRECTORY)
        temporary = Path(name)
        try:
            with os.fdopen(handle, 'wb') as output:
                result = subprocess.run(['docker', 'exec', 'personal-harness-postgres', 'pg_dump', '--username=harness', '--dbname=harness', '--format=custom'], stdout=output, stderr=subprocess.DEVNULL)
                if result.returncode:
                    raise RuntimeError('Sauvegarde échouée.')
                output.flush()
                os.fsync(output.fileno())
            now = datetime.now(timezone.utc)
            target = DIRECTORY / ('database-' + now.strftime('%Y%m%dT%H%M%S%fZ') + '.dump')
            temporary.replace(target)
            for file in DIRECTORY.glob('database-*.dump'):
                if datetime.fromtimestamp(file.stat().st_mtime, timezone.utc) < now - timedelta(days=7):
                    file.unlink()
            print('Sauvegarde locale PostgreSQL du harness terminée.')
        finally:
            temporary.unlink(missing_ok=True)

try:
    backup()
except Exception:
    print('Sauvegarde PostgreSQL du harness échouée.', file=__import__('sys').stderr)
    raise SystemExit(1)
