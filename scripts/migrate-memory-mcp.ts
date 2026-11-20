/** Explicit operator migration. Default is a content-free plan; --apply requires stopped Heart. */
import {readFile,writeFile,rename,stat,chown} from 'node:fs/promises';
import {parseEnv} from 'node:util';import {createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';
import {openSqlStorage} from '../src/app/compose.ts';import {webStorageConfig} from '../src/app/config.ts';
import {ExternalTools} from '../src/app/external-tools.ts';import {connectMcp} from '../src/modules/tools/mcp/index.ts';
import {McpMemoryRepository} from '../src/modules/storage/mcp-memory/index.ts';
if(process.getuid?.()!==0)throw Error('Commande opérateur root.');
const envFile='/etc/personal-harness/nora-mcps.env';const env={...parseEnv(await readFile('/etc/personal-harness/web.env','utf8')),...parseEnv(await readFile(envFile,'utf8'))};Object.assign(process.env,env);
const config=webStorageConfig(env);if(!config)throw Error('Stockage Heart absent.');
const apply=process.argv.includes('--apply');const empty=process.argv.includes('--without-copy');
if(apply&&spawnSync('systemctl',['is-active','--quiet','personal-harness-web.service']).status===0)throw Error('Arrêter Heart sous maintenance avant bascule.');
const storage=await openSqlStorage(config);
try{
 const entries=await storage.structuredMemories.list({includeForgotten:false,limit:0});
 const signature=(items:typeof entries)=>createHash('sha256').update(JSON.stringify(items.toSorted((a,b)=>a.id.localeCompare(b.id)))).digest('hex');const before=signature(entries);
 const connections=await storage.externalTools.list();const memory=connections.filter(c=>c.url==='https://mcps.natio.re/memory'&&c.enabled);if(memory.length!==1)throw Error('Connexion mémoire active unique requise.');const id=memory[0].id;
 const manager=new ExternalTools(storage.externalTools,(c,signal)=>connectMcp(c,{env,signal}));const target=new McpMemoryRepository((name,args)=>manager.callApproved(id,name,args));
 if(!apply){console.log(JSON.stringify({mode:'plan',localActive:entries.length,localSha256:before,remoteConnectionId:id,localDataRetained:true,forgottenNotTransferred:true,remoteForgetIsPermanent:true,applied:false}));}
 else{
  const aliases:Record<string,string>={};
  if(!empty)for(const entry of entries){const saved=await target.create(entry);const actual=await target.get(saved.id);for(const field of ['title','content','kind','scope','projectId'] as const)if(actual?.[field]!==entry[field])throw Error('Copie non conforme : aucune bascule.');aliases[entry.id]=saved.id;}
  if(signature(await storage.structuredMemories.list({includeForgotten:false,limit:0}))!==before)throw Error('Mémoire locale modifiée pendant la copie : aucune bascule.');
  const file='/var/lib/personal-harness/mcp-memory-aliases.json';const temporary=file+'.tmp';const owner=await stat('/var/lib/personal-harness');await writeFile(temporary,JSON.stringify(aliases,null,2)+'\n',{mode:0o600});await chown(temporary,owner.uid,owner.gid);await rename(temporary,file);
  const lines=(await readFile(envFile,'utf8')).split('\n').filter(line=>line&&!line.startsWith('HARNESS_MEMORY_MCP_CONNECTION_ID=')&&!line.startsWith('HARNESS_MEMORY_MCP_ALIASES_FILE='));
  lines.push('HARNESS_MEMORY_MCP_CONNECTION_ID='+id,'HARNESS_MEMORY_MCP_ALIASES_FILE='+file);await writeFile(envFile+'.tmp',lines.join('\n')+'\n',{mode:0o600});await rename(envFile+'.tmp',envFile);
  console.log(JSON.stringify({mode:empty?'switch-without-copy':'copy-and-switch',copied:Object.keys(aliases).length,localSha256:before,localDataRetained:true,oldIdsResolved:!empty,applied:true,restartRequired:true}));
 }
}finally{await storage.close()}
