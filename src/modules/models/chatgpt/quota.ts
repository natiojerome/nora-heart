import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import type {AccountQuotaSnapshot,QuotaWindow} from '../../../contracts/usage.ts';

const unavailable=()=>new Error('Compteurs du compte indisponibles.');
export const accountFingerprint=(email:string)=>createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);

function windows(value:any,id:string,name:string):QuotaWindow[]{
  return ['primary_window','secondary_window'].flatMap(slot=>{
    const w=value?.[slot];if(w==null)return [];
    if(!finite(w.used_percent)||w.used_percent<0||w.used_percent>100||!finite(w.limit_window_seconds)||w.limit_window_seconds<=0||!finite(w.reset_at)||w.reset_at<=0)throw unavailable();
    const date=new Date(w.reset_at*1000);if(!Number.isFinite(date.getTime()))throw unavailable();
    return [{limitId:id,limitName:name,windowDurationMins:w.limit_window_seconds/60,usedPercent:w.used_percent,remainingPercent:100-w.used_percent,resetsAt:date.toISOString()}];
  });
}

/** Read only the existing account's quota. No refresh, inference or reset request. */
export async function readChatGptAccountQuota(options:{accessToken:string;accountId:string;expectedEmail:string},transport:typeof fetch=fetch):Promise<AccountQuotaSnapshot>{
  const response=await transport('https://chatgpt.com/backend-api/wham/usage',{method:'GET',headers:{Authorization:'Bearer '+options.accessToken,'ChatGPT-Account-Id':options.accountId,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw unavailable();
  const data=await response.json() as any;
  if(typeof data.email!=='string'||accountFingerprint(data.email)!==accountFingerprint(options.expectedEmail)||data.account_id!==options.accountId)throw unavailable();
  const result=windows(data.rate_limit,'codex','Compte Codex');
  if(data.additional_rate_limits!=null){
    if(!Array.isArray(data.additional_rate_limits))throw unavailable();
    for(const item of data.additional_rate_limits){
      if(typeof item.metered_feature!=='string'||typeof item.limit_name!=='string')throw unavailable();
      result.push(...windows(item.rate_limit,item.metered_feature,item.limit_name));
    }
  }
  return {version:1,accountFingerprint:accountFingerprint(options.expectedEmail),observedAt:new Date().toISOString(),windows:result,status:result.length?'available':'unavailable'};
}

/** Root-owned, atomic snapshot; the web process never opens the source credentials. */
export async function readAccountQuotaSnapshot(file:string,email:string,maxAgeMs=180000,ownerUid=0):Promise<AccountQuotaSnapshot>{
  if(!Number.isFinite(maxAgeMs)||maxAgeMs<=0)throw unavailable();
  const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const stat=await handle.stat();
    if(!stat.isFile()||stat.uid!==ownerUid||(stat.mode&0o022)||stat.nlink!==1)throw unavailable();
    const value=JSON.parse(await handle.readFile('utf8')) as AccountQuotaSnapshot;
    const age=Date.now()-Date.parse(value.observedAt);
    if(value.version!==1||value.status!=='available'||value.accountFingerprint!==accountFingerprint(email)||!Number.isFinite(age)||age< -5000||age>maxAgeMs||!Array.isArray(value.windows)||!value.windows.length)throw unavailable();
    for(const w of value.windows){
      if(typeof w.limitId!=='string'||typeof w.limitName!=='string'||!finite(w.usedPercent)||w.usedPercent<0||w.usedPercent>100||w.remainingPercent!==100-w.usedPercent||!finite(w.windowDurationMins)||w.windowDurationMins<=0||!Number.isFinite(Date.parse(w.resetsAt)))throw unavailable();
    }
    return value;
  }finally{await handle.close();}
}
