#!/usr/bin/env python3
"""Local encryption + PostgreSQL restore on the disposable nora-tests container.
Requires heart-recovery-pg; no production configuration or credentials are read.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
from datetime import datetime, timezone

spec = importlib.util.spec_from_file_location('bundle', Path(__file__).resolve().parents[1] / 'scripts/heart-bundle.py')
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)
remote = ['ssh', 'nora-tests', 'sudo', 'docker', 'exec', '-i', 'heart-recovery-pg']


def sql(query, database='harness_test'):
    return subprocess.check_output(remote + ['psql', '-U', 'harness', '-d', database, '-At', '-v', 'ON_ERROR_STOP=1'], input=query, text=True).strip()


def snapshot(database):
    tables = ['instance', 'events', 'sessions', 'conversations', 'memories', 'memory_revisions', 'assistant_profile', 'projects', 'quick_prompts', 'chat_attachments', 'external_tools', 'reconciled_runs']
    # Only digests leave the disposable database, not its record contents.
    return {table: sql("SELECT md5(COALESCE(jsonb_agg(j ORDER BY j::text)::text,'[]')) FROM (SELECT to_jsonb(t) j FROM harness." + table + " t) s", database) for table in tables}


with tempfile.TemporaryDirectory(prefix='heart-restore-qualification-') as folder:
    root = Path(folder)
    identity = root / 'identity'
    subprocess.run(['age-keygen', '-o', str(identity)], check=True, stderr=subprocess.DEVNULL)
    recipient = subprocess.check_output(['age-keygen', '-y', str(identity)], text=True).strip()
    workspace = root / 'workspace'
    workspace.mkdir()
    (workspace / 'work.txt').write_text('Preuve de restauration PostgreSQL + fichiers.\n')
    private = root / 'private.env'
    private.write_text('SYNTHETIC_TEST_ONLY=configuration-fixture\n')
    setup = root / 'config.json'
    setup.write_text(json.dumps({'dumpCommand': remote + ['pg_dump', '-U', 'harness', '-d', 'harness_test', '-Fc'], 'paths': {'workspace': str(workspace), 'private-config': str(private)}}))
    before = snapshot('harness_test')
    archive = root / 'backup.age'
    manifest = bundle.create(setup, archive, recipient)
    restored = root / 'restored'
    bundle.unpack(str(archive), str(identity), restored)
    assert (restored / 'files/workspace/work.txt').read_bytes() == (workspace / 'work.txt').read_bytes()
    assert (restored / 'files/private-config').read_bytes() == private.read_bytes()
    sql('CREATE DATABASE harness_restore_test')
    try:
        with (restored / 'database.dump').open('rb') as stream:
            subprocess.run(remote + ['pg_restore', '-U', 'harness', '-d', 'harness_restore_test', '--no-owner', '--exit-on-error'], stdin=stream, stderr=subprocess.DEVNULL, check=True)
        after = snapshot('harness_restore_test')
        assert before == after
        events = int(sql('SELECT count(*) FROM harness.events', 'harness_restore_test'))
        report = {'at': datetime.now(timezone.utc).isoformat(), 'scope': 'Disposable PostgreSQL container on nora-tests; synthetic configuration and file; no production credential or provider inference', 'tablesCompared': len(before), 'eventsRestored': events, 'allTableDigestsEqual': True, 'workspaceBytesEqual': True, 'privateConfigBytesEqual': True, 'encryptedArchiveVerified': True, 'archiveSha256': hashlib.sha256(archive.read_bytes()).hexdigest(), 'limits': ['Isolated data/installation restoration; no production-credential activation', 'No off-machine production copy configured', 'Symlinks are recorded for explicit review rather than recreated automatically']}
        output = Path('docs/qualification/recovery')
        output.mkdir(parents=True, exist_ok=True)
        (output / 'backup.json').write_text(json.dumps(report, indent=2) + '\n')
        print('Restauration isolée vérifiée :', len(before), 'tables,', events, 'événements, fichier et configuration identiques.')
    finally:
        sql('DROP DATABASE harness_restore_test')
