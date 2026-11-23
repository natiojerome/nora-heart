import type {ConversationDefaults} from '../contracts/conversation-defaults.ts';
export const initialConversationDefaults:ConversationDefaults={selection:null,fileAccess:'read',networkAccess:false};
export function validateConversationDefaults(input:unknown):ConversationDefaults{
 const value=input as ConversationDefaults;
 const fail=()=>{throw new Error('Réglages par défaut invalides.');};
 if(!value||!['none','read','write','develop','yolo'].includes(value.fileAccess)||typeof value.networkAccess!=='boolean')return fail();
 if(value.selection!==null&&(typeof value.selection!=='object'||!value.selection))return fail();
 let selection:ConversationDefaults['selection']=null;
 if(value.selection){
  const s=value.selection;
  if(!['demo','chatgpt','openai','anthropic','openrouter','venice','venice-web'].includes(s.provider)||typeof s.modelId!=='string'||s.modelId.length>200||(s.provider!=='demo'&&!s.modelId.trim())||!Number.isInteger(s.contextWindow)||s.contextWindow<4096||s.contextWindow>2000000||!['catalog','configured'].includes(s.capacitySource))return fail();
  if(s.reasoningEffort!==undefined&&(s.provider==='demo'||typeof s.reasoningEffort!=='string'||!s.reasoningEffort||s.reasoningEffort.length>40))return fail();
  selection={provider:s.provider,modelId:s.modelId.trim(),contextWindow:s.contextWindow,capacitySource:s.capacitySource,...(s.reasoningEffort?{reasoningEffort:s.reasoningEffort}:{})};
 }
 return {selection,fileAccess:value.fileAccess,networkAccess:value.fileAccess==='yolo'||value.networkAccess};
}
