import {constants} from 'node:fs';
import {open,rename,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import type {AccountQuotaSnapshot} from '../contracts/usage.ts';
import {accountFingerprint,readChatGptAccountQuota} from '../modules/models/chatgpt/index.ts';

async function privateJson(file:string){
  const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const stat=await handle.stat();
    if(!stat.isFile()||(stat.mode&0o077)||stat.nlink!==1)throw new Error('Source privée refusée.');
    return JSON.parse(await handle.readFile('utf8'));
  }finally{await handle.close();}
}

export async function collectAccountQuota(options:{sourceFile:string;heartAccountFile:string;snapshotFile:string},transport:typeof fetch=fetch):Promise<boolean>{
  let fingerprint='';
  let snapshot:AccountQuotaSnapshot;
  try{
    const heart=await privateJson(options.heartAccountFile);
    if(typeof heart.email!=='string'||!heart.email.trim())throw new Error('Compte absent.');
    fingerprint=accountFingerprint(heart.email);
    const {tokens}=await privateJson(options.sourceFile);
    if(typeof tokens?.access_token!=='string'||!tokens.access_token||typeof tokens?.account_id!=='string'||!tokens.account_id)throw new Error('Source absente.');
    snapshot=await readChatGptAccountQuota({accessToken:tokens.access_token,accountId:tokens.account_id,expectedEmail:heart.email},transport);
  }catch{
    snapshot={version:1,accountFingerprint:fingerprint,observedAt:new Date().toISOString(),status:'unavailable',windows:[]};
  }
  const temporary=options.snapshotFile+'.'+randomUUID()+'.tmp';
  try{
    const handle=await open(temporary,'wx',0o640);
    try{await handle.writeFile(JSON.stringify(snapshot));await handle.sync();}finally{await handle.close();}
    await rename(temporary,options.snapshotFile);
  }finally{await unlink(temporary).catch(()=>{});}
  return snapshot.status==='available';
}
