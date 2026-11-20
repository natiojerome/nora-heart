import type {Json} from '../src/contracts/json.ts';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {McpProjectsRepository} from '../src/modules/storage/mcp-projects/index.ts';
import {ExternalCallError} from '../src/contracts/external-tools.ts';
import {Memories} from '../src/app/memories.ts';
import {structuredMemoryFixture} from './structured-memory-fixture.ts';

test('project authority returns remote IDs, replays operation IDs and paginates without a stale catalog',async()=>{
 const id=randomUUID(), operationId=randomUUID(), calls:any[]=[];
 let title='Remote';
 const repository=new McpProjectsRepository(async(name,args):Promise<Json>=>{
  calls.push({name,args});
  if(name==='projects_create') return {id,name:args.name,version:1,status:'planning'};
  if(name==='projects_get') return {id,name:title,version:1,status:'planning'};
  return {items:[{id,name:title,version:1,status:'planning'}],nextCursor:null};
 });
 const {memory}=structuredMemoryFixture(), app=new Memories(memory,repository);
 const result=await app.createProject({title:'Projet',objective:'Livrer',operationId});
 assert.equal(result.project.id,id);assert.notEqual(result.project.id,operationId);
 assert.deepEqual(calls[0],{name:'projects_create',args:{name:'Projet',objective:'Livrer',operationId}});
 await app.createProject({title:'Projet',objective:'Livrer',operationId});assert.equal(calls[1].args.operationId,operationId);
 const pages=await Promise.all([repository.list(),repository.list()]);assert.equal(calls.filter(c=>c.name==='projects_search').length,1);
 pages[0][0].title='mutated';assert.equal(pages[1][0].title,'Remote');
 title='Renommé dans le MCP';assert.equal((await repository.list())[0].title,title);
 assert.equal((await repository.get(id))?.id,id);
});

test('project remote errors do not fall back and malformed pagination stops',async()=>{
 let count=0;
 const unavailable=new McpProjectsRepository(async()=>{count++;throw new ExternalCallError('UNAVAILABLE')});
 await assert.rejects(unavailable.create({id:randomUUID(),title:'P'}),{code:'UNAVAILABLE'});assert.equal(count,1);
 await assert.rejects(unavailable.get(randomUUID()),{code:'UNAVAILABLE'});
 const missing=new McpProjectsRepository(async()=>{throw new ExternalCallError('NOT_FOUND')});assert.equal(await missing.get(randomUUID()),null);
 const cycle=new McpProjectsRepository(async()=>({items:[],nextCursor:'same'}));await assert.rejects(cycle.list(),/pagination incohérente/);
 await assert.rejects(new McpProjectsRepository(async()=>({items:[],nextCursor:5})).list(),/pagination incompatible/);
});
