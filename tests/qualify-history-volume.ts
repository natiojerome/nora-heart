import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {writeFile,mkdtemp,rm} from 'node:fs/promises';
import {migrateSqlite,openSqliteStorage} from '../src/modules/storage/sqlite/index.ts';
import {createPostgresPool,migratePostgres,openPostgresStorage} from '../src/modules/storage/postgres/index.ts';
import {ConversationView} from '../src/app/conversation-view.ts';
import type {Event} from '../src/contracts/storage.ts';
const results=[];
const connection=process.env.HARNESS_TEST_DATABASE_URL;
if(!connection||!new URL(connection).pathname.endsWith('_test'))throw new Error('Base jetable avec suffixe _test requise.');
const root=await mkdtemp('/tmp/heart-history-db-');
const pool=createPostgresPool(connection);
try{
 await migratePostgres(pool);await migrateSqlite(root+'/state.sqlite');
 for(const [backend,storage] of [['postgres',await openPostgresStorage(connection)],['sqlite',await openSqliteStorage(root+'/state.sqlite')]] as const){
  try{
   const id=randomUUID(),at=new Date().toISOString(),events:Event[]=Array.from({length:1205},(_,i)=>({id:randomUUID(),runId:'fixture',at,type:'message',data:{role:i%2?'assistant':'user',content:('Texte de contrôle '+i+' ').repeat(12),...(i%2?{toolCalls:[]}:{})}}));
   await storage.conversations.create({id,title:'Volume',createdAt:at,updatedAt:at,selection:null});
   await storage.sessions.appendBatch(id,events);
   const ids:string[]=[];let before:string|undefined,more=true,pages=0;
   while(more){const page=await storage.sessions.page(id,{before,limit:200});ids.unshift(...page.events.map(e=>e.id));before=page.before!;more=page.hasMore;pages++;}
   assert.deepEqual(ids,events.map(e=>e.id));
   let transferred=0;
   const sessions={...storage.sessions,read:async()=>{throw Error('Full read forbidden');},page:async(key:string,input:any)=>{const page=await storage.sessions.page(key,input);transferred+=page.events.length;return page;},append:async()=>{}};
   const view=new ConversationView(sessions,id);await view.update();assert.equal(view.messageCount,1205);assert.equal(transferred,1205);
   await view.update();assert.equal(transferred,1205);
   const tail=await storage.sessions.page(id,{limit:200}),empty=await storage.sessions.page(id,{after:tail.after!});assert.equal(empty.events.length,0);
   const next:Event={id:randomUUID(),runId:'fixture',at,type:'message',data:{role:'user',content:'Nouveauté'}};await storage.sessions.append(id,next);
   await view.update();assert.equal(transferred,1206);
   const delta=await storage.sessions.page(id,{after:tail.after!});assert.deepEqual(delta.events.map(e=>e.id),[next.id]);
   const topic='Catalog-'+randomUUID();for(let i=0;i<125;i++)await storage.conversations.create({id:randomUUID(),title:topic+' '+i,createdAt:at,updatedAt:at,selection:null});
   const seen:string[]=[];let cursor:import("../src/contracts/conversations.ts").ConversationPosition|undefined;
   for(;;){const page=await storage.conversations.list({before:cursor,limit:20,query:topic});if(!page.length)break;seen.push(...page.map(c=>c.id));cursor=page.at(-1)!.position;}
   assert.equal(new Set(seen).size,125);
   results.push({backend,events:1205,earlierPages:pages,allIdsInOrder:true,catalogueThreads:125,catalogueComplete:true,initialProjectionEvents:1205,unchangedProjectionNewEvents:0,appendedProjectionNewEvents:1,initialPageBytes:Buffer.byteLength(JSON.stringify(tail)),emptyDeltaBytes:Buffer.byteLength(JSON.stringify(empty)),oneEventDeltaBytes:Buffer.byteLength(JSON.stringify(delta)),wholeJournalReadForbidden:true});
  }finally{await storage.close();}
 }
 await writeFile(process.env.HARNESS_HISTORY_REPORT??'docs/qualification/history/volume.json',JSON.stringify({at:new Date().toISOString(),host:'nora-tests',providerCalls:0,results},null,2)+'\n');console.log('Both SQL adapters: 1205 messages, 125 threads, ordered full traversal, delta and incremental projection verified.');
}finally{await pool.end();await rm(root,{recursive:true,force:true});}
