#!/usr/bin/env python3
"""Operator-only provisioning. No key is accepted as argument or printed.

The fixed owner and target match this installation. Server files survive retries;
existing revoked keys are never silently replaced. Other installations create
keys through their own portal and provide private server environment variables.
"""
import json,os,re,subprocess
from pathlib import Path
assert os.geteuid()==0
os.umask(0o077)
remote=r'''
import hashlib,json,os,secrets,subprocess
from pathlib import Path
os.umask(0o077)
def sql(query):
 r=subprocess.run(['docker','exec','-i','-u','postgres','nora-database-postgres-1','psql','-X','-U','postgres','-d','nora_platform','-At','-v','ON_ERROR_STOP=1'],input=query,text=True,capture_output=True)
 if r.returncode:raise RuntimeError('Private key provisioning SQL rejected')
 return r.stdout.strip()
uid=sql("SELECT u.id FROM platform.users u JOIN platform.owner_settings o ON o.owner_user_id=u.id WHERE u.email='natio.jerome@gmail.com' AND u.status='active'")
if not uid:raise RuntimeError('Active owner absent')
folder=Path('/etc/nora-mcps/clients/nora-heart');folder.mkdir(parents=True,exist_ok=True);folder.chmod(0o700)
keys={}
for service in ['memory','vault','projects']:
 if sql(f"SELECT status FROM platform.mcp_services WHERE slug='{service}'")!='active':raise RuntimeError('MCP not active')
 file=folder/(service+'.token');fresh=not file.exists()
 if fresh:file.write_text('nmc_'+secrets.token_urlsafe(32)+'\n');file.chmod(0o600)
 token=file.read_text().strip();digest=hashlib.sha256(token.encode()).hexdigest()
 existing=sql(f"SELECT (revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now()) AND user_id='{uid}' AND mcp_id=(SELECT id FROM platform.mcp_services WHERE slug='{service}'))::int FROM platform.api_keys WHERE token_hash=decode('{digest}','hex')")
 if existing and existing!='1':raise RuntimeError('Existing key revoked or scope changed; no implicit replacement')
 if not existing:
  sql(f"INSERT INTO platform.api_keys(user_id,mcp_id,label,public_prefix,token_hash) VALUES('{uid}',(SELECT id FROM platform.mcp_services WHERE slug='{service}'),'Nora Heart','{token[:12]}',decode('{digest}','hex'))")
 keys['NORA_MCPS_'+service.upper()+'_TOKEN']=token
print(json.dumps(keys))
'''
r=subprocess.run(['ssh','nora-mcps','python3 -'],input=remote,text=True,capture_output=True)
if r.returncode:raise RuntimeError('Private MCP provisioning failed; no key displayed')
values=json.loads(r.stdout)
assert len(values)==3 and all(re.fullmatch(r'NORA_MCPS_(MEMORY|VAULT|PROJECTS)_TOKEN',k) and re.fullmatch(r'nmc_[A-Za-z0-9_-]{43}',v) for k,v in values.items())
file=Path('/etc/personal-harness/nora-mcps.env');lines=file.read_text().splitlines() if file.exists() else []
lines=[line for line in lines if not any(line.startswith(key+'=') for key in values)]
file.write_text('\n'.join(lines+[key+'='+value for key,value in values.items()])+'\n');file.chmod(0o600)
print('Three scoped MCP keys provisioned in a private environment file; no value displayed.')
