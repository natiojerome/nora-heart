import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
const root=fileURLToPath(new URL('../',import.meta.url));
const actionPortraits=process.argv.includes('--action-portraits');
const robotPortraits=process.argv.includes('--robot-portraits');
const portraitVersion=actionPortraits?'v5':robotPortraits?'v4':'v3';
const portraits=actionPortraits||robotPortraits||process.argv.includes('--portraits');
const output=path.join(root,portraits?'assets/avatar-portraits/'+portraitVersion:'assets/avatar-video-pilots/v2');
const stateDir=path.join(root,portraits?'.tools/portrait-'+portraitVersion:'.tools/video-pilots');
const stateFile=path.join(stateDir,'jobs.json');
const model='bytedance/seedance-2.0';
const apiKey=process.env.OPENROUTER_API_KEY;
if(!apiKey)throw new Error('OPENROUTER_API_KEY missing.');
const shared='Locked static camera. Entire character, chair and both feet remain fully visible in exactly the original framing. Uniform pure chroma green background throughout. One fluid continuous animation, no cuts, no dissolves, no camera motion, no zoom. Preserve the exact face, hair or head shell, armor, materials, colors, chair and proportions from the supplied frame. Natural articulated hands, wrists, elbows, shoulders, neck and torso must move together, not stiff flat cutout pieces. No extra or missing fingers, no detached limbs, no objects popping in or out, no new characters or text. Begin completely at rest and end in precisely the supplied original pose and composition for looping. No audio.';
const bodyCandidates=[
 {id:'masculine',name:'Orion',seed:2026111401,prompt:'Orion, a friendly silver-haired masculine cybernetic assistant, performs one charming energetic work cycle while seated. His fingers type in a quick believable alternating rhythm on the cyan holographic keyboard, wrists and elbows flex naturally, shoulders subtly follow the movement. He tracks the keyboard with lively cyan eyes, briefly glances toward the viewer with a small knowing grin and one raised brow, then refocuses and settles naturally into the exact original pose. Small expressive head and torso gestures with convincing overlapping motion and smooth easing, like high-quality character animation, never a rigid mechanical sway. '+shared},
 {id:'neutral',name:'Prisme',seed:2026111402,prompt:'Prisme, a friendly compact gender-neutral white robot, performs one playful thoughtful work cycle while seated. Its three-finger hands type lightly and independently on the cyan holographic keyboard; wrists, elbows and shoulders move naturally. The large expressive cyan eyes follow the work, blink once, then the head tilts with curious delight toward the viewer and the little mouth smiles. Its rounded body makes a small coordinated enthusiastic bounce, then it gently settles back to the exact original attentive typing pose. Fluid appealing animation with anticipation, follow-through and subtle squash in expression, while preserving the hard shell geometry and all body proportions. Never a rigid puppet rocking as one flat piece. '+shared}
];
const portraitShared='Locked static camera, square close-up head-and-shoulders portrait. Preserve exact supplied character identity, hair, face, clothing, materials and framing. No full body, hands, props, keyboard, text, icons or symbols. Keep head within original margins, background uniformly pure chroma green, no camera move, no cuts, no zoom, no morphing. High-quality subtle fluid character animation, coordinated eyes, eyebrows and neck, not a rigid puppet. Start and end precisely at supplied pose for a seamless loop. No audio.';
const portraitCandidates=(robotPortraits?['orion']:['orion','prisme']).flatMap((identity,index)=>['working','idle','waiting'].map((state,stateIndex)=>({
 id:identity+'-'+state,name:identity+' '+state,keyframe:identity+'-keyframe.png',seed:(robotPortraits?2026111600:2026111500)+index*10+stateIndex,
 prompt:(identity==='orion'?(robotPortraits?'Orion, the masculine ceramic and metal robot: articulated white face plates, glowing mechanical blue eyes, silver sculpted metal crest, jaw hinges and segmented neck. Preserve all mechanical seams and hard materials; absolutely no human skin, hair, realistic lips or face display. ':'Orion, the human-faced masculine android with natural expressive blue eyes and silver hair. '):'Prisme, the friendly gender-neutral robot with expressive cyan eyes. ')+({
 working:'Focused work in progress: eyes attentively track an unseen task just below camera, blink naturally, brows concentrate, tiny deliberate nod of progress, brief satisfied expression, then return to initial pose. Clearly engaged and thinking, no speaking.',
 idle:'Relaxed and available at rest: soft smile, slow natural breath visible in shoulders, one gentle blink, tiny relaxed head movement and return. Calm, awake, welcoming, no nodding off or typing.',
 waiting:'Waiting for the user to answer: look directly toward viewer, gently tilt head with curious raised eyebrows, blink once and hold a patient questioning expression, then return. Curious and attentive, never confused or worried.'
 })[state]+' '+portraitShared
})));
const actionCandidates=['orion','prisme'].flatMap((identity,index)=>['working','waiting'].map((state,stateIndex)=>({
 id:identity+'-'+state,name:identity+' '+state,keyframe:identity+'-'+state+'-keyframe.png',seed:2026111700+index*10+stateIndex,
 prompt:(identity==='orion'?'Orion, the pearl ceramic and metal robot, preserving all face plates, seams, mechanical eyelids, metal crest and neck joints. No human skin or organic hair. ':'Prisme, the rounded white robot with a rigid head shell and cyan screen eyes, preserving its three-finger robot hands. ')+
 (state==='working'?'ACTIVELY WORKING for the full clip: both visible hands continuously type on the supplied holographic keyboard, alternating articulated fingers clearly press different keys, wrists and forearms coordinated naturally. Eyes remain focused DOWN on the keyboard and scan left to right across the work, mechanical eyelids blink once, mouth stays CLOSED and neutral. Keep typing throughout; no pausing to smile or pose, no looking at the viewer, no dance or bounce. The typing action is the main animation and must be clearly legible in a small portrait.':
 'WAITING PATIENTLY FOR THE VIEWER TO ANSWER for the full clip: keep direct eye contact, attentive raised mechanical brows fixed, mouth CLOSED and unchanged. '+(identity==='prisme'?'Keep the visible hand open palm UP in its asking pose; a tiny natural wrist gesture and one blink, no typing or keyboard. ':'One gentle eyelid blink only, hold the face expectantly toward viewer. '))+
 ' Camera locked, entire square bust framing unchanged. HEAD COMPLETELY UPRIGHT AND STILL: absolutely no nod, tilt, turn, stretch, squash, head bob or neck flex. Skull silhouette and proportions must stay geometrically identical to the reference in every frame. Hard robot shells remain rigid, face plates and jaw do not deform. No speaking or lip movements. Do not enlarge eyes or open the mouth. No cuts, zoom, full body, legs, props appearing, text or symbols. Uniform pure chroma green background. Preserve hands and keyboard if present exactly as supplied. Begin and finish at the supplied pose for looping. No audio.'
})));
const profileCandidates=actionPortraits?actionCandidates:portraits?portraitCandidates:bodyCandidates;
const only=process.argv.find(argument=>argument.startsWith('--only='))?.slice(7);
if(only&&!profileCandidates.some(item=>item.id===only))throw new Error('Unknown requested video.');
const candidates=only?profileCandidates.filter(item=>item.id===only):profileCandidates;
const budget=actionPortraits?1.2:robotPortraits?1:portraits?2:1.5;
const resolution=portraits?'480p':'720p';
const side=portraits?640:960;
await mkdir(stateDir,{recursive:true,mode:0o700});await mkdir(output,{recursive:true});
let state={model,budgetEstimateUSD:actionPortraits?1.1:robotPortraits?0.83:portraits?1.65:1.2096,noAutomaticReruns:true,jobs:{}};
try{state=JSON.parse(await readFile(stateFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
async function save(){await writeFile(stateFile,JSON.stringify(state,null,2)+'\n',{mode:0o600});}
async function jsonRequest(route,options={}){
 const url=new URL(route,'https://openrouter.ai/api/v1/');
 if(url.origin!=='https://openrouter.ai'||!url.pathname.startsWith('/api/v1/'))throw new Error('Unexpected API origin.');
 const response=await fetch(url,{...options,headers:{Authorization:'Bearer '+apiKey,Accept:'application/json',...(options.body?{'Content-Type':'application/json'}:{})},signal:AbortSignal.timeout(60000)});
 if(!response.ok){const payload=await response.json().catch(()=>null);const error=new Error(`OpenRouter HTTP ${response.status}`);error.status=response.status;error.retryAfter=response.headers.get('retry-after');error.limitSource=payload?.error?.metadata?.limit_source??null;error.providerMessage=typeof payload?.error?.message==='string'?payload.error.message.slice(0,500):null;throw error;}
 return response.json();
}
function remember(job){return {id:job.id,status:job.status,generationId:job.generation_id??null,usage:job.usage??null};}
for(const item of candidates){
 if(process.argv.includes('--collect-only'))continue;
 const prior=state.jobs[item.id];
 if(prior){
  if(prior.retryNotBefore&&Date.parse(prior.retryNotBefore)>Date.now())throw new Error('Provider settlement delay not elapsed; no submission.');
  const otherJobsFinished=candidates.filter(candidate=>candidate.id!==item.id).every(candidate=>state.jobs[candidate.id]?.status==='downloaded');
  if(!(process.argv.includes('--retry-declined')&&prior.httpStatus===402&&!prior.id&&otherJobsFinished))continue;
 }

 const catalog=await jsonRequest('videos/models');
 const chosen=(catalog.data??catalog.models??[]).find(value=>value.id===model);
 const rate=Number(chosen?.pricing_skus?.video_tokens_without_audio);
 if(!chosen||!Number.isFinite(rate)||rate>0.000007||!chosen.supported_durations.includes(4)||!chosen.supported_resolutions.includes(resolution))throw new Error('Model or expected price changed; no submission.');
 const estimate=side*side*24*4/1024*rate;
 const actual=Object.values(state.jobs).filter(value=>!(value.httpStatus===402&&!value.id)).reduce((sum,value)=>sum+Number(value.usage?.cost??(value.estimatedUSD??0.6048)*1.03),0);
 if(actual+estimate*1.03>budget)throw new Error('Pilot budget guard reached; no further submission.');
 if(portraits){const balance=(await jsonRequest('credits')).data; if(!Number.isFinite(Number(balance.total_credits))||!Number.isFinite(Number(balance.total_usage))||Number(balance.total_credits)-Number(balance.total_usage)<estimate*1.03)throw new Error('Insufficient account credits; no submission.');}
 const image=await readFile(path.join(output,item.keyframe??item.id+'-keyframe.png'));
 const frame={type:'image_url',image_url:{url:'data:image/png;base64,'+image.toString('base64')}};
 const request={model,prompt:item.prompt,duration:4,resolution,aspect_ratio:'1:1',generate_audio:false,seed:item.seed,
  frame_images:[{...frame,frame_type:'first_frame'},{...frame,frame_type:'last_frame'}]};
 await writeFile(path.join(output,item.id+'-request.json'),JSON.stringify({...request,frame_images:undefined,keyframe:item.keyframe??item.id+'-keyframe.png',keyframeSha256:createHash('sha256').update(image).digest('hex'),estimatedUSD:estimate},null,2)+'\n');
 state.jobs[item.id]={status:'submission_started',estimatedUSD:estimate,submittedAt:new Date().toISOString(),...(prior?{previousAttempts:[...(prior.previousAttempts??[]),{status:'submission_declined',httpStatus:prior.httpStatus,limitSource:prior.limitSource??null,retryAfter:prior.retryAfter??null,submittedAt:prior.submittedAt}]}:{})};await save();
 try{
  const job=await jsonRequest('videos',{method:'POST',body:JSON.stringify(request)});
  if(!job.id)throw new Error('Missing job ID; do not resubmit.');
  state.jobs[item.id]={...state.jobs[item.id],...remember(job),estimatedUSD:estimate};await save();
  console.log(item.name+': accepted ('+job.status+').');
 }catch(error){state.jobs[item.id].status=error.status===402?'submission_declined':'submission_outcome_unknown';state.jobs[item.id].httpStatus=error.status??null;state.jobs[item.id].limitSource=error.limitSource??null;state.jobs[item.id].providerMessage=error.providerMessage??null;state.jobs[item.id].retryAfter=error.retryAfter??null;const delaySeconds=Number(error.retryAfter);if(error.retryAfter&&Number.isFinite(delaySeconds)&&delaySeconds>=0)state.jobs[item.id].retryNotBefore=new Date(Date.now()+delaySeconds*1000).toISOString();await save();throw error;}
}
let rounds=0;
while(rounds++<90){
 let pending=false;
 for(const item of candidates){
  let entry=state.jobs[item.id];
  if(!entry){if(process.argv.includes('--collect-only'))continue;throw new Error('Video not submitted.');}
  if(entry.status==='downloaded')continue;
  if(!entry.id){if(process.argv.includes('--collect-only'))continue;throw new Error('Uncertain prior submission: manual reconciliation required, no rerun.');}
  if(['failed','cancelled','expired'].includes(entry.status)){console.log(item.name+': terminal failure, no automatic rerun.');continue;}
  if(entry.status!=='completed'){
   const job=await jsonRequest('videos/'+encodeURIComponent(entry.id));
   entry=state.jobs[item.id]={...entry,...remember(job)};await save();console.log(item.name+': '+entry.status+'.');
  }
  if(entry.status==='completed'){
   const response=await fetch('https://openrouter.ai/api/v1/videos/'+encodeURIComponent(entry.id)+'/content?index=0',{headers:{Authorization:'Bearer '+apiKey},signal:AbortSignal.timeout(120000)});
   if(!response.ok)throw new Error('Video download failed: HTTP '+response.status);
   const bytes=Buffer.from(await response.arrayBuffer());await writeFile(path.join(output,item.id+'-pilot.mp4'),bytes);
   entry.status='downloaded';entry.bytes=bytes.length;await save();
   await writeFile(path.join(output,item.id+'-result.json'),JSON.stringify({id:item.id,model,status:'completed',jobId:entry.id,generationId:entry.generationId,usage:entry.usage,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')},null,2)+'\n');
   console.log(item.name+': downloaded, cost '+(entry.usage?.cost??'not communicated')+' USD.');
  }else if(!['failed','cancelled','expired'].includes(entry.status))pending=true;
 }
 if(!pending)break;
 await delay(20000);
}
if(!process.argv.includes('--collect-only')&&candidates.some(item=>state.jobs[item.id]?.status!=='downloaded'))throw new Error('One or more pilots incomplete; persisted IDs retained.');
console.log(Object.values(state.jobs).filter(job=>job.status==='downloaded').length+' video pilots downloaded. No reruns submitted.');
