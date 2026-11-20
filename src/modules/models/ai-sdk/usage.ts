import type {ProviderUsage} from '../../../contracts/usage.ts';

/** Metadata only: never generates text, returns keys, or guesses a reset date. */
export async function readOpenRouterUsage(apiKey:string,modelId:string,transport:typeof fetch=fetch):Promise<ProviderUsage>{
  const base:ProviderUsage={provider:'openrouter',modelId,status:'unavailable',observedAt:new Date().toISOString(),source:'OpenRouter GET /api/v1/key',message:'Usage OpenRouter indisponible.',dashboardUrl:'https://openrouter.ai/settings/credits'};
  const number=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value:undefined;
  const date=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value))?new Date(value).toISOString():undefined;
  const get=async(endpoint:string)=>{
    const response=await transport('https://openrouter.ai/api/v1/'+endpoint,{method:'GET',headers:{Authorization:'Bearer '+apiKey},redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error('Unavailable');return (await response.json()).data;
  };
  try{
    const key=await get('key');if(!key||typeof key!=='object')return base;
    const budget=key.effective_budget;
    const effective=number(budget?.remaining_usd),remaining=number(key.limit_remaining);
    const result:ProviderUsage={...base,status:'available',message:'Données du compte et de la clé ; elles ne sont pas propres au modèle.'};
    const spend={scope:'key' as const,currency:'USD' as const,...Object.fromEntries([['total','usage'],['daily','usage_daily'],['weekly','usage_weekly'],['monthly','usage_monthly']].filter(([,field])=>number(key[field])!==undefined).map(([period,field])=>[period,key[field]]))};
    if(Object.keys(spend).length>2)result.spend=spend;
    if(effective!==undefined){result.balance={remaining:effective,currency:'USD',scope:'budget'};result.reset={scope:'budget',...(date(budget.resets_at)?{at:date(budget.resets_at)}:{}),...(typeof budget.reset_interval==='string'||budget.reset_interval===null?{interval:budget.reset_interval}:{})};}
    else if(remaining!==undefined){result.balance={remaining,currency:'USD',scope:'key'};result.reset=typeof key.limit_reset==='string'||key.limit_reset===null?{scope:'key',interval:key.limit_reset}:{scope:'key'};}
    else result.message=key.limit===null?'Solde du compte non communiqué ; la clé n’a pas de plafond.':'Solde et budget non communiqués.';
    if(modelId.endsWith(':free')&&number(key.free_model_daily_requests?.remaining)!==undefined&&number(key.free_model_daily_requests?.limit)!==undefined){result.dailyRequests={remaining:key.free_model_daily_requests.remaining,limit:key.free_model_daily_requests.limit};}
    if(key.is_management_key===true||key.is_provisioning_key===true){
      try{const credits=await get('credits');const total=number(credits?.total_credits),used=number(credits?.total_usage);if(total!==undefined&&used!==undefined){result.balance={remaining:total-used,currency:'USD',scope:'account'};result.source+=' + /api/v1/credits';}}catch{result.message='Solde du compte indisponible ; budget communiqué conservé.';}
    }
    return result;
  }catch{return base;}
}
