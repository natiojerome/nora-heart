import type {InputQuestion, InputRequest, InputResponse} from '../../../contracts/interactions.ts';
import type {Json} from '../../../contracts/json.ts';
import type {Tool} from '../../../contracts/tools.ts';
function fail():never{throw new Error('Formulaire ou réponse invalide. Vérifie les champs.');}
const record=(value:unknown):Record<string,unknown>=>value && typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:fail();
const text=(value:unknown)=>typeof value==='string'&&value.trim()?value:fail();
const id=(value:unknown)=>{const result=text(value);if(!/^[a-zA-Z0-9_-]+$/.test(result)||['__proto__','constructor','prototype'].includes(result))fail();return result;};
function optionalText(value:unknown){return value===undefined?undefined:text(value);}
function integer(value:unknown,min:number){if(!Number.isSafeInteger(value)||Number(value)<min)fail();return Number(value);}

export function inputRequest(value:unknown):InputRequest {
  const data=record(value), title=text(data.title);
  if(!Array.isArray(data.questions)||!data.questions.length)fail();
  const seen=new Set<string>();
  const questions=(data.questions as unknown[]).map(value=>{
    const q=record(value), key=id(q.id);if(seen.has(key))fail();seen.add(key);
    if(!['single','multiple','text'].includes(String(q.type))||(q.required!==undefined&&typeof q.required!=='boolean'))fail();
    const result:InputQuestion={id:key,label:text(q.label),type:q.type as InputQuestion['type'],required:q.required!==false};
    if(q.description!==undefined)result.description=optionalText(q.description);
    if(result.type==='text'){
      if(q.options!==undefined||q.minSelections!==undefined||q.maxSelections!==undefined)fail();
      if(q.placeholder!==undefined)result.placeholder=optionalText(q.placeholder);
      if(q.maxLength!==undefined)result.maxLength=integer(q.maxLength,1);
    }else{
      if(!Array.isArray(q.options)||!q.options.length||q.maxLength!==undefined||q.placeholder!==undefined)fail();
      const ids=new Set<string>();result.options=q.options.map(value=>{const option=record(value),key=id(option.id);if(ids.has(key))fail();ids.add(key);return {id:key,label:text(option.label),...(option.description!==undefined?{description:optionalText(option.description)}:{})};});
      if(result.type==='single'){if(q.minSelections!==undefined||q.maxSelections!==undefined)fail();}
      else{result.minSelections=q.minSelections===undefined?(result.required?1:0):integer(q.minSelections,0);result.maxSelections=q.maxSelections===undefined?result.options!.length:integer(q.maxSelections,1);if((result.required&&result.minSelections<1)||result.minSelections>result.maxSelections||result.maxSelections>result.options!.length)fail();}
    }
    return result;
  });
  return {kind:'input_request',title,questions,...(data.description!==undefined?{description:optionalText(data.description)}:{}),...(data.submitLabel!==undefined?{submitLabel:optionalText(data.submitLabel)}:{})};
}
export function inputResponse(request:InputRequest,value:unknown):InputResponse {
  const response=record(value);if(Object.keys(response).some(key=>!['status','answers'].includes(key)))fail();if(!['answered','cancelled'].includes(String(response.status)))fail();const values=record(response.answers);
  if(response.status==='cancelled'){if(Object.keys(values).length)fail();return {status:'cancelled',answers:{}};}
  const known=new Set(request.questions.map(q=>q.id));if(Object.keys(values).some(key=>!known.has(key)))fail();
  const answers:InputResponse['answers']={};
  for(const q of request.questions){
    const answer=values[q.id];
    if(answer===undefined){if(q.required!==false)fail();continue;}
    if(q.type==='text'){if(typeof answer!=='string'||(q.required!==false&&!answer.trim())||(q.maxLength!==undefined&&[...answer].length>q.maxLength))fail();if(q.required!==false||answer.trim())answers[q.id]=answer;}
    else if(q.type==='single'){if(typeof answer!=='string'||!q.options!.some(o=>o.id===answer))fail();answers[q.id]=answer;}
    else{if(!Array.isArray(answer)||answer.some(a=>typeof a!=='string'||!q.options!.some(o=>o.id===a))||new Set(answer).size!==answer.length||answer.length<(q.minSelections??0)||answer.length>(q.maxSelections??q.options!.length))fail();if(q.required!==false||answer.length)answers[q.id]=[...answer].sort();}
  }
  return {status:'answered',answers};
}
const string={type:'string',minLength:1};
const option={type:'object',properties:{id:string,label:string,description:string},required:['id','label'],additionalProperties:false};
export function interactionTools():Tool<InputRequest>[]{return [{
  name:'interactions.request_input',permission:'user.input',
  description:'Demander les informations ou choix réellement nécessaires dans un formulaire du chat. Choix single, multiple ou texte, identifiants stables. Préférer une question courte et quelques options, regrouper les questions liées. Aucun mot de passe, clé ou secret. Le moteur se met en attente et reprend avec les réponses structurées ; ne pose pas la même question en texte. YOLO ne dispense pas de recueillir une information utilisateur manquante.',
  parameters:{type:'object',properties:{title:string,description:string,submitLabel:string,questions:{type:'array',minItems:1,items:{type:'object',properties:{id:string,label:string,type:{type:'string',enum:['single','multiple','text']},description:string,required:{type:'boolean'},options:{type:'array',minItems:1,items:option},placeholder:string,maxLength:{type:'integer',minimum:1},minSelections:{type:'integer',minimum:0},maxSelections:{type:'integer',minimum:1}},required:['id','label','type'],additionalProperties:false}}},required:['title','questions'],additionalProperties:false} as Record<string,Json>,
  async execute(args){return inputRequest(args);}, resolveInput:inputResponse,
}];}
