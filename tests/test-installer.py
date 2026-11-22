import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch, MagicMock

spec=importlib.util.spec_from_file_location('heart_installer',Path(__file__).resolve().parents[1]/'scripts/install.py')
installer=importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)

class InstallerTests(unittest.TestCase):
    def test_default_ip_access_and_ipv6_origins(self):
        with patch.object(installer,'machine_address',return_value='192.0.2.40'):
            network=installer.network_settings()
        self.assertEqual(network,{'access':'ip','host':'0.0.0.0','address':'192.0.2.40'})
        identity={'domain':None,'port':4215,**network}
        self.assertEqual(installer.web_origin(identity),'http://192.0.2.40:4215')
        self.assertEqual(installer.local_url(identity),'http://127.0.0.1:4215')
        identity.update(installer.network_settings(address='[2001:db8::42]'))
        self.assertEqual(installer.web_origin(identity),'http://[2001:db8::42]:4215')
        self.assertEqual(installer.local_url(identity),'http://[::1]:4215')

    def test_private_domain_and_legacy_installations_keep_local_binding(self):
        for options,expected in [({'private':True},'http://localhost:4215'),({'domain':'assistant.example.com'},'https://assistant.example.com')]:
            network=installer.network_settings(**options)
            self.assertEqual(network['host'],'127.0.0.1')
            self.assertEqual(installer.web_origin({'domain':options.get('domain'),'port':4215,**network}),expected)
        self.assertEqual(installer.web_origin({'domain':None,'port':4215}),'http://localhost:4215')
        for options in [{'domain':'example.com','address':'192.0.2.1'},{'private':True,'address':'192.0.2.1'},{'private':True,'domain':'example.com'}]:
            with self.assertRaises(RuntimeError):installer.network_settings(**options)
        for address in ['example.com','0.0.0.0','::','224.0.0.1','fe80::1']:
            with self.assertRaises(RuntimeError):installer.network_settings(address=address)

    def test_machine_ip_uses_metadata_then_local_route_without_external_ip_service(self):
        response=MagicMock()
        response.__enter__.return_value.read.return_value=b'8.8.8.8\n'
        opener=MagicMock()
        opener.open.return_value=response
        with patch.object(installer.urllib.request,'build_opener',return_value=opener),patch.object(installer,'run') as run:
            self.assertEqual(installer.machine_address(),'8.8.8.8')
            run.assert_not_called()
        self.assertEqual(opener.open.call_args.args[0],'http://169.254.169.254/hetzner/v1/metadata/public-ipv4')
        opener.open.side_effect=OSError('metadata unavailable')
        with patch.object(installer.urllib.request,'build_opener',return_value=opener),patch.object(installer.shutil,'which',return_value='/usr/sbin/ip'),patch.object(installer,'run',return_value='[{"prefsrc":"10.0.0.9"}]') as run:
            self.assertEqual(installer.machine_address(),'10.0.0.9')
            run.assert_called_once_with(['ip','-j','route','get','1.1.1.1'])

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
