/** Operator command. Keys stay in private env files; only connection IDs/counts are reported. */
import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {randomUUID} from 'node:crypto';
import {openSqlStorage} from '../src/app/compose.ts';
import {webStorageConfig} from '../src/app/config.ts';
import {ExternalTools} from '../src/app/external-tools.ts';
import {connectMcp} from '../src/modules/tools/mcp/index.ts';
const env={...parseEnv(await readFile('/etc/personal-harness/web.env','utf8')),...parseEnv(await readFile('/etc/personal-harness/nora-mcps.env','utf8'))};
Object.assign(process.env,env);const config=webStorageConfig(env);if(!config)throw Error('Stockage Heart absent.');
const storage=await openSqlStorage(config);try{
 const manager=new ExternalTools(storage.externalTools,(connection,signal)=>connectMcp(connection,{env,signal}));
 const existing=(await manager.list()).connections;const report=[];
 for(const [service,label] of [['memory','Mémoire partagée'],['vault','Coffre-fort'],['projects','Projets partagés']]){
  const url='https://mcps.natio.re/'+service;const found=existing.filter(item=>item.url===url);if(found.length>1)throw Error('Connexions en double : résoudre avant raccordement.');
  const old=found[0];const draft={id:old?.id??randomUUID(),version:old?.version??0,label:'Nora MCPs · '+label,url,auth:{type:'bearer_env',envVar:'NORA_MCPS_'+service.toUpperCase()+'_TOKEN'},enabled:true,allowWrites:true,transient:service==='vault',timeoutMs:60000};
  const discovered=await manager.discover(draft);const saved=(await manager.save({...draft,toolNames:discovered.tools.map(tool=>tool.name),refreshDefinitions:true})).connection;
  report.push({service,connectionId:saved.id,tools:saved.tools.length,enabled:saved.enabled,allowWrites:saved.allowWrites,transient:saved.transient===true});
 }
 console.log(JSON.stringify({connections:report,memoryBinding:env.HARNESS_MEMORY_MCP_CONNECTION_ID??'local',projectsBinding:env.HARNESS_PROJECTS_MCP_CONNECTION_ID??'local',dataMigrated:false}));
}finally{await storage.close()}
