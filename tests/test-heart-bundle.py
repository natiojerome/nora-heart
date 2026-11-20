import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('bundle', Path(__file__).resolve().parents[1] / 'scripts/heart-bundle.py')
bundle = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bundle)


class Bundles(unittest.TestCase):
    def test_encrypted_files_configuration_and_digest_are_restored_without_overwriting(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            identity = root / 'identity'
            subprocess.run(['age-keygen', '-o', str(identity)], check=True, stderr=subprocess.DEVNULL)
            recipient = subprocess.check_output(['age-keygen', '-y', str(identity)], text=True).strip()
            workspace = root / 'workspace'
            workspace.mkdir()
            (workspace / 'test.txt').write_text('Un travail à reprendre é 🌍\n')
            (workspace / 'outside-link').symlink_to('/etc/passwd')
            config = root / 'private.env'
            config.write_text('FAKE_TEST_ONLY=not-a-real-secret\n')
            dump = root / 'fake.dump'
            dump.write_bytes(b'only a fixture; actual SQL restore qualified separately')
            setup = root / 'setup.json'
            setup.write_text(json.dumps({'dumpCommand': ['cat', str(dump)], 'paths': {'workspace': str(workspace), 'config': str(config)}}))
            encrypted = root / 'snapshot.age'
            manifest = bundle.create(setup, encrypted, recipient)
            self.assertNotIn(b'FAKE_TEST_ONLY', encrypted.read_bytes())
            self.assertEqual(encrypted.stat().st_mode & 0o777, 0o600)
            output = root / 'restored'
            self.assertEqual(bundle.unpack(str(encrypted), str(identity), output), manifest)
            self.assertEqual((output / 'files/workspace/test.txt').read_text(), (workspace / 'test.txt').read_text())
            self.assertEqual((output / 'files/config').read_bytes(), config.read_bytes())
            self.assertEqual((output / 'database.dump').read_bytes(), dump.read_bytes())
            self.assertFalse((output / 'files/workspace/outside-link').exists())
            self.assertEqual(json.loads((output / 'links.json').read_text())[0]['target'], '/etc/passwd')
            with self.assertRaises(ValueError):
                bundle.unpack(str(encrypted), str(identity), output)
            self.assertTrue(output.exists())
            broken = root / 'broken.age'
            broken.write_bytes(encrypted.read_bytes()[:-20])
            with self.assertRaises(Exception):
                bundle.unpack(str(broken), str(identity), root / 'bad')
            self.assertFalse((root / 'bad').exists())
            with self.assertRaises(ValueError):
                bundle.create(setup, encrypted, recipient)

    def test_sqlite_native_snapshot_keeps_its_format_and_restores_under_encryption(self):
        import sqlite3
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            identity = root / 'identity'
            subprocess.run(['age-keygen', '-o', str(identity)], check=True, stderr=subprocess.DEVNULL)
            recipient = subprocess.check_output(['age-keygen', '-y', str(identity)], text=True).strip()
            database = root / 'source.sqlite'
            connection = sqlite3.connect(database)
            try:
                connection.execute('CREATE TABLE proof(value TEXT)')
                connection.execute('INSERT INTO proof VALUES (?)', ('SQLite vérifié 🌍',))
                connection.commit()
            finally:
                connection.close()
            os.chmod(database, 0o600)
            workspace = root / 'workspace'
            workspace.mkdir()
            (workspace / 'work.txt').write_text('fichier conservé')
            setup = root / 'setup.json'
            snapshot = Path(__file__).resolve().parents[1] / 'scripts/heart-sqlite-dump.mjs'
            setup.write_text(json.dumps({'database': {'driver': 'sqlite', 'format': 'sqlite'}, 'dumpCommand': ['node', str(snapshot), str(database)], 'paths': {'workspace': str(workspace)}}))
            archive = root / 'sqlite.age'
            bundle.create(setup, archive, recipient)
            restored = root / 'restored'
            manifest = bundle.unpack(str(archive), str(identity), restored)
            self.assertEqual(manifest['database'], {'driver': 'sqlite', 'format': 'sqlite'})
            check = sqlite3.connect(restored / 'database.dump')
            try:
                self.assertEqual(check.execute('SELECT value FROM proof').fetchone()[0], 'SQLite vérifié 🌍')
                self.assertEqual(check.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
            finally:
                check.close()
            self.assertEqual((restored / 'files/workspace/work.txt').read_text(), 'fichier conservé')


if __name__ == '__main__':
    os.umask(0o077)
    unittest.main()
