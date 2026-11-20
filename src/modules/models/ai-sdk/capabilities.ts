import type {ModelCapabilities} from '../../../contracts/models.ts';
// Wire values only; each catalogue decides which subset is available.
export const effortValues=['none','minimal','low','medium','high','xhigh','max'];
export function routerReasoning(item:Record<string,any>):Pick<ModelCapabilities,'reasoningEfforts'|'defaultReasoningEffort'>{
 const reasoning=item.reasoning;
 if(!reasoning||!Object.hasOwn(reasoning,'supported_efforts'))return {};
 const candidates=reasoning.supported_efforts===null?effortValues:reasoning.supported_efforts;
 if(!Array.isArray(candidates))return {};
 const reasoningEfforts=[...new Set(candidates.filter((value:unknown)=>typeof value==='string'&&effortValues.includes(value as string)&&!(reasoning.mandatory&&value==='none')))] as string[];
 return {reasoningEfforts,...(reasoningEfforts.includes(reasoning.default_effort)?{defaultReasoningEffort:reasoning.default_effort}:{})};
}
export async function apiModelCapabilities(provider:'openai'|'anthropic',modelId:string,apiKey:string,transport:typeof fetch=fetch):Promise<ModelCapabilities>{
 const url=(provider==='openai'?'https://api.openai.com':'https://api.anthropic.com')+'/v1/models/'+encodeURIComponent(modelId);
 const response=await transport(url,{headers:provider==='openai'?{Authorization:'Bearer '+apiKey}:{'x-api-key':apiKey,'anthropic-version':'2026-10-21'},redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error('Capacités du modèle indisponibles.');
 const item=await response.json();let reasoningEfforts:string[]=[];
 if(provider==='anthropic'){
  if(item.capabilities?.effort?.supported)reasoningEfforts=effortValues.filter(value=>item.capabilities.effort[value]?.supported===true);
 }else{
  const values=item.supported_reasoning_levels??item.supported_reasoning_efforts;
  if(Array.isArray(values))reasoningEfforts=values.map((v:any)=>typeof v==='string'?v:v?.effort).filter((v:unknown)=>typeof v==='string'&&effortValues.includes(v));
  // Documented Responses model families, used only when the Models API omits this metadata.
  else if(/^(gpt-6-astra|gpt-6-sol|gpt-6-luna|gpt-6\.1-sol)(-|$)/.test(modelId))reasoningEfforts=['low','medium','high','xhigh','max'];
  else if(/^(o3|o4-mini)(-|$)/.test(modelId))reasoningEfforts=['low','medium','high'];
 }
 return {id:modelId,reasoningEfforts,...(Number.isInteger(item.max_input_tokens)&&item.max_input_tokens>0?{contextWindow:item.max_input_tokens}:{})};
}
