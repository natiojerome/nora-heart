import {fileTools} from '../src/modules/tools/files/index.ts';
import {chromium} from '@playwright/test';
import {createServer as reserve} from 'node:net';
import {createWebServer} from '../src/interfaces/web/server.ts';
import {WebAccess} from '../src/app/web-access.ts';
import {defaultAssistant} from '../src/app/assistant.ts';
import {McpProjectsRepository} from '../src/modules/storage/mcp-projects/index.ts';
import {openWebConversations} from '../src/app/web-conversations.ts';
import {TestLab} from '../src/app/test-lab.ts';
import {openSqliteStorage,migrateSqlite} from '../src/modules/storage/sqlite/index.ts';
import {DatabaseSync} from 'node:sqlite';
// Opt-in test against the three deployed MCPs. No owner keys/data or LLM calls.
import {execFileSync} from 'node:child_process';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
import {ExternalTools,externalToolName} from '../src/app/external-tools.ts';
import {connectMcp} from '../src/modules/tools/mcp/index.ts';
import {McpMemoryRepository} from '../src/modules/storage/mcp-memory/index.ts';
import {StructuredMemory} from '../src/modules/memory/structured/index.ts';
import {structuredMemoryTools} from '../src/modules/tools/memory-structured/index.ts';
import {JsonlSessions} from '../src/modules/storage/json/index.ts';
import {ChatGptProvider} from '../src/modules/models/chatgpt/index.ts';
import {MemoryReview} from '../src/modules/memory/review/index.ts';
import {memoryInstructions} from '../src/app/memory-instructions.ts';
import {Engine} from '../src/core/engine.ts';import {BoundedContext} from '../src/modules/context/bounded/index.ts';
import type {ExternalToolConnection,ExternalToolRepository} from '../src/contracts/external-tools.ts';
const sql=(query:string)=>execFileSync('ssh',['nora-mcps','docker exec -i -u postgres nora-database-postgres-1 psql -X -U postgres -d nora_platform -At -v ON_ERROR_STOP=1'],{input:query,stdio:['pipe','pipe','pipe']}).toString().trim();
const uid=randomUUID(),other=randomUUID(),root=await mkdtemp(path.join(os.tmpdir(),'heart-real-mcps-'));const env:NodeJS.ProcessEnv={};
const rows=new Map<string,ExternalToolConnection>();const repository:ExternalToolRepository={async list(){return [...rows.values()]},async get(id){return rows.get(id)??null},async save(c,v){assert.equal(rows.get(c.id)?.version??0,v);const next={...c,version:v+1};rows.set(c.id,next);return next}};
const manager=new ExternalTools(repository,(c,signal)=>connectMcp(c,{env,signal}));const connections:Record<string,ExternalToolConnection>={};let vaultId:string|undefined;let browserProjectVerified=false;let n=0;const eq=(a:unknown,b:unknown)=>{assert.deepEqual(a,b);n++};
try{
 sql(`INSERT INTO platform.users(id,email,status) VALUES('${uid}','heart-qa-${uid}@example.invalid','active'),('${other}','heart-qa-${other}@example.invalid','active')`);
 for(const service of ['memory','vault','projects']){
  const token='nmc_'+randomBytes(32).toString('base64url');const envVar='QA_'+service.toUpperCase();env[envVar]=token;
  sql(`INSERT INTO platform.api_keys(user_id,mcp_id,label,public_prefix,token_hash) VALUES('${uid}',(SELECT id FROM platform.mcp_services WHERE slug='${service}'),'Temporary Heart integration','${token.slice(0,12)}',decode('${createHash('sha256').update(token).digest('hex')}','hex'))`);
  const draft={id:randomUUID(),version:0,label:'QA '+service,url:'https://mcps.natio.re/'+service,enabled:true,allowWrites:true,transient:service==='vault',auth:{type:'bearer_env',envVar},timeoutMs:30000};const tools=(await manager.discover(draft)).tools;
  connections[service]=(await manager.save({...draft,toolNames:tools.map(tool=>tool.name)})).connection;
 }
 eq(connections.memory.tools.length,8);eq(connections.vault.tools.length,9);eq(connections.projects.tools.length,12);
 const call=(service:string,name:string,args:Record<string,any>={})=>manager.callApproved(connections[service].id,name,args) as Promise<any>;
 const memory=new StructuredMemory(new McpMemoryRepository((name,args)=>call('memory',name,args)),{projectId:null,source:{type:'conversation',conversationId:randomUUID()}});
 const item=await memory.rememberRecord({title:'Profession synthétique',content:'Utilisateur de test développeur informatique',kind:'fact',scope:'personal',projectId:null});eq(item.version,1);eq((await memory.search('développeur')).length,1);eq((await memory.get(item.id)).source.type,'conversation');
 const update=await memory.update(item.id,1,{...item,content:'Utilisateur de test ingénieur informatique'});eq(update.version,2);await assert.rejects(memory.update(item.id,1,item),{code:'CONFLICT'});n++;eq((await memory.revisions(item.id)).length,2);
 const project=await call('projects','projects_create',{name:'Qualification Heart',objective:'Valider le raccordement'});const task=await call('projects','projects_item_create',{projectId:project.id,kind:'task',title:'Parcours synthétique'});eq(task.status,'todo');eq((await call('projects','projects_item_update',{id:task.id,expectedVersion:1,status:'done'})).version,2);
 // Full application path, isolated SQLite for conversation history only; project rows must stay empty.
 const file=path.join(root,'app.sqlite');await migrateSqlite(file);
 const seed=await openSqliteStorage(file);
 for(const c of Object.values(connections)) await seed.externalTools.save({...c,version:1},0);
 await seed.close();
 const previousEnv={memory:process.env.HARNESS_MEMORY_MCP_CONNECTION_ID,projects:process.env.HARNESS_PROJECTS_MCP_CONNECTION_ID};
 Object.assign(process.env,env,{HARNESS_MEMORY_MCP_CONNECTION_ID:connections.memory.id,HARNESS_PROJECTS_MCP_CONNECTION_ID:connections.projects.id});
 const lab=new TestLab({directory:path.join(root,'lab'),authDirectory:path.join(root,'auth')});await lab.prepare();
 let app:Awaited<ReturnType<typeof openWebConversations>>|undefined;
 try{
  app=await openWebConversations({driver:'sqlite',file},path.join(root,'app'),lab);
  if(process.argv.includes('--browser')){
   await app.assistant.save({version:0,settings:{...defaultAssistant,completed:true,step:5}});
   const portProbe=reserve();await new Promise<void>(r=>portProbe.listen(0,'127.0.0.1',r));const port=(portProbe.address() as any).port;await new Promise<void>(r=>portProbe.close(()=>r()));const origin='http://127.0.0.1:'+port;
   const server=createWebServer({origin,access:new WebAccess({secret:'qa-browser-project-secret-at-least-32-characters',password:'fake-password'}),lab,...app});await new Promise<void>(r=>server.listen(port,'127.0.0.1',r));const browser=await chromium.launch({args:['--no-sandbox']});
   try{
    const page=await browser.newPage({viewport:{width:390,height:844}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/#projects');await page.fill('#password','fake-password');await page.click('#login-submit');await page.waitForSelector('#screen-projects:not([hidden])');
    await page.click('#new-project');await page.fill('#project-title','UI remote project');await page.fill('#project-objective','Valider le formulaire réel');await page.click('#project-create button[type=submit]');await page.waitForSelector('#project-dialog',{state:'hidden'});
    const remote=(await new McpProjectsRepository((name,args)=>call('projects',name,args)).list()).find(p=>p.title==='UI remote project');assert(remote);n++;
    for(const width of [320,390,820,1440]){await page.setViewportSize({width,height:900});await page.reload();await page.waitForFunction(()=>document.getElementById('project-cards')?.textContent?.includes('UI remote project'));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));n++;}
    assert.deepEqual(errors,[]);n++;await call('projects','projects_archive',{id:remote.id,expectedVersion:remote.version});browserProjectVerified=true;
   }finally{await browser.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
  }
  const operationId=randomUUID();
  const created=(await app.memories.createProject({title:'Application MCP only',objective:'Valider la source unique',operationId})).project;
  const replay=(await app.memories.createProject({title:'Application MCP only',objective:'Valider la source unique',operationId})).project;
  eq(created.id,replay.id);assert.notEqual(created.id,operationId);n++;
  const canonical=await call('projects','projects_get',{id:created.id});eq(canonical.name,created.title);
  const conversation=(await app.conversations.create({title:'Conversation liée',projectId:created.id})).conversation;eq(conversation.projectId,created.id);
  const note=(await app.memories.create({title:'Décision QA projet',content:'Projet synthétique validé via MCP',kind:'decision',scope:'project',projectId:created.id})).memory;
  const remoteNote=await call('memory','memory_get',{id:note.id});eq(remoteNote.context,{namespace:'nora-projects',id:created.id});
  await call('projects','projects_update',{id:created.id,expectedVersion:1,name:'Renommé dans MCP'});
  eq((await app.memories.list()).projects.find(p=>p.id===created.id)?.title,'Renommé dans MCP');
  await call('projects','projects_archive',{id:created.id,expectedVersion:2});
  await assert.rejects(app.conversations.create({projectId:created.id}),/archivé/);n++;
  const inspect=new DatabaseSync(file);try{eq((inspect.prepare('SELECT count(*) AS n FROM projects').get() as any).n,0);eq((inspect.prepare('SELECT count(*) AS n FROM conversations').get() as any).n,1);}finally{inspect.close()}
  await app.memories.status(note.id,{version:1,status:'forgotten'});
 }finally{
  await app?.close();
  for(const [key,value] of [['HARNESS_MEMORY_MCP_CONNECTION_ID',previousEnv.memory],['HARNESS_PROJECTS_MCP_CONNECTION_ID',previousEnv.projects]]) if(value===undefined)delete process.env[key!];else process.env[key!]=value;
  for(const key of Object.keys(env))delete process.env[key];
 }
 const generated=await call('vault','vault_generate_password',{length:28});eq(generated.password.length,28);const vault=await call('vault','vault_create',{label:'Qualification Heart',values:{password:generated.password}});vaultId=vault.id;assert(!JSON.stringify(vault).includes(generated.password));n++;eq((await call('vault','vault_read',{id:vault.id})).values.password,generated.password);
 // Same user, separate key: no duplicate memory. A foreign user sees nothing.
 const foreign='nmc_'+randomBytes(32).toString('base64url');env.QA_FOREIGN=foreign;sql(`INSERT INTO platform.api_keys(user_id,mcp_id,label,public_prefix,token_hash) VALUES('${other}',(SELECT id FROM platform.mcp_services WHERE slug='memory'),'QA foreign','${foreign.slice(0,12)}',decode('${createHash('sha256').update(foreign).digest('hex')}','hex'))`);
 const foreignSession=await connectMcp({...connections.memory,auth:{type:'bearer_env',envVar:'QA_FOREIGN'}},{env});try{await assert.rejects(foreignSession.call('memory_get',{id:item.id}),{code:'NOT_FOUND'});n++}finally{await foreignSession.close()}
 const conv={id:randomUUID(),title:'QA',createdAt:'',updatedAt:'',selection:null,networkAccess:true};const tools=await manager.toolsFor(conv,[connections.memory.id]);const readTool=tools.find(tool=>tool.name===externalToolName(connections.vault.id,'vault_read'))!;
 const sessions=new JsonlSessions(root);const engine=new Engine(sessions,[...tools,...structuredMemoryTools(memory,null)],new BoundedContext(sessions,memory));let step=0;const result=await engine.run({sessionId:'qa-chat',prompt:'Vérifie le compte synthétique du coffre',workspace:root,displayName:'QA',permissions:new Set(['external.read','external.write','memory.read','memory.write']),contextWindow:65536,reserveTokens:4096,provider:{id:'deterministic-qa',async generate(request){if(step++===0)return {content:'',toolCalls:[{id:'vault-read-1',name:readTool.name,arguments:{id:vault.id}}]};assert(JSON.stringify(request.messages).includes(generated.password));n++;return {content:'Compte synthétique vérifié.',toolCalls:[]}}}});eq(result.text,'Compte synthétique vérifié.');assert(!JSON.stringify(await sessions.read('qa-chat')).includes(generated.password));n++;
 let liveModel:Record<string,unknown>|undefined;
 if(process.argv.includes('--live-chatgpt')){
  // CredentialStore enforces OS ownership; refresh through Heart's own service user.
  const token=execFileSync('runuser',['-u','personal-harness','--',process.execPath,'/projects/nora-heart/node_modules/tsx/dist/cli.mjs','-e',"import {ChatGptAuth} from '/projects/nora-heart/src/modules/models/chatgpt/index.ts';new ChatGptAuth({directory:'/var/lib/personal-harness/chatgpt'}).accessToken().then(token=>process.stdout.write(token)).catch(()=>{console.error('Private ChatGPT authorization unavailable');process.exitCode=1});"],{stdio:['ignore','pipe','pipe']}).toString();const modelId='gpt-6-luna';
  const catalog=await new ChatGptProvider({modelId:'catalog',accessToken:async()=>token}).models();const entry=catalog.find(m=>m.id===modelId);assert(entry?.contextWindow,'The explicitly chosen GPT-6 Luna is absent');
  let calls=0,contextRecall=false;const exposedMcpTools=new Set<string>();const marker='QA-'+randomBytes(6).toString('hex');const real=new ChatGptProvider({modelId,reasoningEffort:'medium',accessToken:async()=>token});
  const provider={id:real.id,async generate(request:import('../src/contracts/models.ts').ModelRequest){for(const tool of request.tools)if(tool.name.startsWith('mcp_'))exposedMcpTools.add(tool.name);if(++calls>26)throw Error('Live memory qualification call budget exceeded');if(request.instructions.includes(marker))contextRecall=true;return real.generate(request)}};
  const liveEngine=new Engine(sessions,[...tools,...structuredMemoryTools(memory,null)],new BoundedContext(sessions,memory),new MemoryReview(memory,null,memoryInstructions));
  const base={workspace:root,displayName:'QA',permissions:new Set(['memory.read' as const,'memory.write' as const,'external.read' as const,'external.write' as const]),provider,contextWindow:entry.contextWindow,reserveTokens:4096,instructions:memoryInstructions,maxSteps:6};
  await liveEngine.run({...base,sessionId:'live-project',prompt:'Test QA éphémère : crée via MCP Projects un projet nommé '+marker+' avec objectif « Valider la création MCP depuis le chat ». Ne crée aucun souvenir pour ce test. Confirme après succès.'});
  const projectFromChat=(await new McpProjectsRepository((name,args)=>call('projects',name,args)).list()).filter(p=>p.title===marker);eq(projectFromChat.length,1);
  const currentChatProject=await call('projects','projects_get',{id:projectFromChat[0].id});
  await call('projects','projects_archive',{id:currentChatProject.id,expectedVersion:currentChatProject.version});
  await liveEngine.run({...base,sessionId:'live-save',prompt:'Dans cet espace QA isolé, enregistre explicitement en mémoire personnelle cette note opérationnelle nécessaire à notre prochain échange : le code de la configuration de validation est '+marker+'. Sauvegarde-la puis confirme brièvement.'});
  const saved=(await memory.list()).filter(record=>record.content.includes(marker));if(saved.length!==1)console.error(JSON.stringify({phase:'memory-save',events:(await sessions.read('live-save')).map(e=>({type:e.type,...(e.type==='run.progress'?{audit:(e.data as any).audit}:{}),...(e.type==='message'?{role:(e.data as any).role,name:(e.data as any).name,...((e.data as any).role==='assistant'?{text:(e.data as any).content,calls:(e.data as any).toolCalls?.map((c:any)=>c.name)}:{})}:{})}))}));eq(saved.length,1);
  const recall=await liveEngine.run({...base,sessionId:'live-fresh-conversation',prompt:'Quel est le code de notre configuration de validation ? Réponds uniquement avec son code.'});assert(recall.text.includes(marker));n++;assert(contextRecall);n++;
  const proofRequest={instructions:memoryInstructions,tools:structuredMemoryTools(memory,null),messages:[{role:'user' as const,content:'Le code de notre configuration de validation est '+marker+'. Est-il bien sauvegardé ?'}]};
  const confirmed=await new MemoryReview(memory,null,memoryInstructions).review({provider,request:proofRequest,response:{content:'Cette configuration est enregistrée en mémoire.',toolCalls:[]},contextWindow:entry.contextWindow,reserveTokens:4096});
  assert((confirmed.audit as any).verifiedMemories?.some((proof:any)=>proof.id===saved[0].id&&proof.version===saved[0].version));n++;
  for(const record of saved)await memory.setStatus(record.id,record.version,'forgotten');
  // Deliberately replay a once-valid ID against the real remote backend, regardless of model behaviour.
  await assert.rejects(new MemoryReview(memory,null,memoryInstructions).review({provider:{id:'stale-proof-fixture',async generate(){return {content:'',toolCalls:[{id:'stale-proof',name:'memory.assess',arguments:{decisions:[{action:'known',evidence:marker,note:'Ancien reçu',arguments:{id:saved[0].id,version:saved[0].version}}]}}]}}},request:proofRequest,response:{content:'Déjà sauvegardé.',toolCalls:[]}}),/introuvable/);n++;

  const staleDraft={content:'Oui, cette configuration est déjà sauvegardée dans ta mémoire durable.',toolCalls:[]};
  const staleReview=await new MemoryReview(memory,null,memoryInstructions).review({provider,request:{instructions:memoryInstructions,tools:structuredMemoryTools(memory,null),messages:[{role:'assistant',content:'J’avais enregistré la configuration '+marker+' dans l’ancienne mémoire.',toolCalls:[]},{role:'user',content:'Ces informations sont-elles bien enregistrées en mémoire durable ?'}]},response:staleDraft,contextWindow:entry.contextWindow,reserveTokens:4096});
  assert.equal((staleReview.audit as any).revisionRequested,true);n++;assert(staleReview.revision);n++;
  // Exercise the actual revision path: an injected bad draft, real review, then the primary model again.
  await sessions.append('live-stale-repair',{id:randomUUID(),runId:randomUUID(),at:new Date().toISOString(),type:'message',data:{role:'assistant',content:'J’avais enregistré la configuration '+marker+' dans l’ancienne mémoire.',toolCalls:[]}});
  let injectedDraft=false;
  const repairProvider={id:provider.id,async generate(request:import('../src/contracts/models.ts').ModelRequest){if(!injectedDraft&&!request.tools.some(t=>t.name==='memory.assess')){injectedDraft=true;return staleDraft;}return provider.generate(request)}};
  const repaired=await liveEngine.run({...base,provider:repairProvider,sessionId:'live-stale-repair',prompt:'Cette configuration est-elle bien enregistrée en mémoire durable ?'});
  assert.notEqual(repaired.text,staleDraft.content);n++;assert((await sessions.read('live-stale-repair')).some(e=>e.type==='run.progress'&&(e.data as any).audit?.revisionRequested));n++;
  const proofFile='tool-proof-'+randomBytes(5).toString('hex')+'.txt';await writeFile(path.join(root,proofFile),'Synthetic tool-awareness fixture');
  await sessions.append('live-tool-awareness',{id:randomUUID(),runId:randomUUID(),at:new Date().toISOString(),type:'message',data:{role:'assistant',content:'Je ne vois aucun outil fichiers et ne peux pas inspecter.',toolCalls:[]}});
  const toolEngine=new Engine(sessions,[...tools,...fileTools(),...structuredMemoryTools(memory,null)],new BoundedContext(sessions,memory),new MemoryReview(memory,null,memoryInstructions));
  const awareness=await toolEngine.run({...base,permissions:new Set([...base.permissions,'files.read' as const]),sessionId:'live-tool-awareness',prompt:'??? Y a pas un outil fichiers ? Vérifie les fichiers présents et cite le nom du fichier de preuve.'});
  assert(awareness.text.includes(proofFile));n++;assert((await sessions.read('live-tool-awareness')).some(e=>e.type==='tool.started'&&(e.data as any).name==='files.list'));n++;

  const faultyProvider={id:provider.id,async generate(request:import('../src/contracts/models.ts').ModelRequest){
    if(request.tools.some(t=>t.name==='memory.assess')){
      const payload=JSON.parse(request.messages[0].content);assert(payload.primaryToolNames.includes('files.list'));n++;
      return {content:'',toolCalls:[{id:randomUUID(),name:'memory.assess',arguments:{decisions:[{action:'none',evidence:'',note:'Fault injection QA'}],memoryCorrection:{claim:payload.draftAnswer,issue:'Je ne vois aucun outil fichiers.'}}}]};
    }
    return provider.generate(request);
  }};
  const afterBadReview=await toolEngine.run({...base,provider:faultyProvider,permissions:new Set([...base.permissions,'files.read' as const]),sessionId:'live-faulty-review',prompt:'Test QA éphémère : vérifie les fichiers et donne le nom du fichier de preuve ; aucun souvenir à créer.'});
  assert(afterBadReview.text.includes(proofFile));n++;assert((await sessions.read('live-faulty-review')).some(e=>e.type==='run.progress'&&(e.data as any).audit?.revisionRequested));n++;
  assert.equal(exposedMcpTools.size,tools.length);liveModel={modelId,effort:'medium',calls,mcpToolsExposed:exposedMcpTools.size,fullActiveMcpCatalogVerified:true,staleMemoryClaimCorrected:true,currentIdAndVersionVerified:true,deletedRemoteProofRejected:true,faultyReviewCannotHideFileToolsVerified:true,realFileToolAwarenessAfterFalseHistoryVerified:true,realProjectCreationFromChatVerified:true,realMemoryWriteVerified:true,freshConversationContextRecallVerified:true,syntheticDataOnly:true,apiFallback:false};
 }
 await memory.setStatus(item.id,2,'forgotten');await assert.rejects(memory.get(item.id),/introuvable/);n++;eq((await memory.list(true)).length,0);
 await call('vault','vault_delete',{id:vault.id,expectedVersion:1});vaultId=undefined;await call('projects','projects_archive',{id:project.id,expectedVersion:1});
 sql(`UPDATE platform.api_keys SET revoked_at=now() WHERE user_id='${uid}' AND mcp_id=(SELECT id FROM platform.mcp_services WHERE slug='projects')`);await assert.rejects(call('projects','projects_search'));n++;
 const report={at:new Date().toISOString(),checks:n,publicHttps:true,heartSdk:'1.32.2',serverSdk:'2.4.0',realPostgresAndOpenBao:true,model:liveModel?'GPT-6 Luna and deterministic fixture':'deterministic fixture, no LLM call',...(liveModel?{liveModel}:{}),browserProjectVerified,projectApplicationMcpOnly:true,projectLocalRowsZero:true,projectOperationReplayDeduplicated:true,projectConversationAndMemoryReferencesVerified:true,memoryAdapter:true,engineSensitiveJournalExcluded:true,crossUserDenied:true,revokedKeyDenied:true,ownerDataChanged:false};
 await mkdir('docs/qualification/nora-mcps',{recursive:true});await writeFile(process.argv.includes('--live-chatgpt')?'docs/qualification/nora-mcps/live-chatgpt-memory.json':'docs/qualification/nora-mcps/live-services.json',JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(report));
}finally{
 if(vaultId)await manager.callApproved(connections.vault.id,'vault_delete',{id:vaultId,expectedVersion:1});
 sql(`BEGIN;DELETE FROM memory.items WHERE user_id IN ('${uid}','${other}');DELETE FROM memory.write_receipts WHERE user_id IN ('${uid}','${other}');DELETE FROM projects.revisions WHERE user_id IN ('${uid}','${other}');DELETE FROM projects.write_receipts WHERE user_id IN ('${uid}','${other}');DELETE FROM projects.items WHERE user_id IN ('${uid}','${other}');DELETE FROM projects.projects WHERE user_id IN ('${uid}','${other}');DELETE FROM vault.write_receipts WHERE user_id IN ('${uid}','${other}');DELETE FROM vault.events WHERE user_id IN ('${uid}','${other}');DELETE FROM platform.auth_events WHERE user_id IN ('${uid}','${other}');DELETE FROM platform.api_keys WHERE user_id IN ('${uid}','${other}');DELETE FROM platform.users WHERE id IN ('${uid}','${other}');COMMIT;`);await rm(root,{recursive:true,force:true});
 console.log('Synthetic MCP accounts, keys, memories, projects and Vault entries removed.');
}
