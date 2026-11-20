import type {Event} from '../contracts/storage.ts';
import type {InputRequest, InputResponse, Interaction} from '../contracts/interactions.ts';

/** The journal is the single source of truth, including after process restart. */
export function interactionsFrom(events: readonly Event[]): Interaction[] {
  const items = new Map<string,Interaction>();
  for (const event of events) {
    if (event.type === 'interaction.requested') {
      const data = event.data as unknown as {callId:string;toolName:string;request:InputRequest};
      items.set(event.id,{id:event.id,callId:data.callId,toolName:data.toolName,request:data.request,at:event.at,status:'pending'});
    } else if (event.type === 'interaction.resolved') {
      const data = event.data as unknown as {requestId:string;response:InputResponse};
      const item=items.get(data.requestId);
      if(item){item.status=data.response.status;item.response=data.response;item.respondedAt=event.at;}
    }
  }
  return [...items.values()];
}
