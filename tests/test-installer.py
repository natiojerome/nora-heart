import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('heart_installer',Path(__file__).resolve().parents[1]/'scripts/install.py')
installer=importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)

class InstallerTests(unittest.TestCase):
    def test_existing_owner_configuration_is_preserved_and_database_switch_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as root:
            file=Path(root)/'runtime.env'
            keys=['PORT','HARNESS_WEB_HOST','HARNESS_WEB_ORIGIN','HARNESS_DATABASE_URL','HARNESS_STORAGE_DRIVER','HARNESS_WEB_STATE_DIR','HARNESS_CHATGPT_AUTH_DIR','HARNESS_PROJECTS_ROOT','HARNESS_HOST_SOCKET','HARNESS_WALLETS_SOCKET']
            values={k:'synthetic-value' for k in keys}
            node=os.environ.get('HEART_INSTALL_TEST_NODE') or 'node'
            installer.keep_runtime(file,values,node)
            file.write_text(file.read_text()+'OWNER_EXTRA_KEY="synthetic-extra"\n')
            before=file.read_bytes()
            installer.keep_runtime(file,values,node)
            self.assertEqual(file.read_bytes(),before)
            with self.assertRaises(RuntimeError):installer.keep_runtime(file,{**values,'HARNESS_DATABASE_URL':'different database'},node)
            self.assertEqual(file.read_bytes(),before)

    def test_atomic_private_configuration_replaces_without_exposing_or_resetting_other_files(self):
        with tempfile.TemporaryDirectory() as root:
            file=Path(root)/'private file.json'
            installer.atomic(file,'first synthetic secret')
            installer.atomic(file,'second synthetic secret')
            self.assertEqual(file.read_text(),'second synthetic secret')
            self.assertEqual(file.stat().st_mode&0o777,0o600)
            self.assertEqual(list(Path(root).iterdir()),[file])

    def test_failed_command_never_relays_private_arguments_or_output(self):
        with self.assertRaises(RuntimeError) as caught:
            installer.run([sys.executable,'-c','import sys; print("synthetic credential"); sys.exit(1)','synthetic password argument'])
        self.assertNotIn('synthetic credential',str(caught.exception))
        self.assertNotIn('synthetic password',str(caught.exception))

    def test_random_ports_are_local_and_help_has_no_side_effect(self):
        port=installer.available_port()
        self.assertGreaterEqual(port,1024)
        result=subprocess.run([sys.executable,str(Path(installer.__file__)),'--help'],capture_output=True,text=True)
        self.assertEqual(result.returncode,0)
        self.assertIn('--path',result.stdout)
        self.assertIn('--domain',result.stdout)

if __name__=='__main__':unittest.main()
