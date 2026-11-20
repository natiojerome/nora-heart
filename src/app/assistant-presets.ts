import type {AssistantAvatarPack,PersonalityTemplate} from '../contracts/assistant-presets.ts';
export const baseAvatarPackId='bdcb9596-cc59-44de-ad7f-b3e783593ca4';
// Only the current approved static base is offered. Older animation experiments stay out of the UI.
export const avatarPacks:readonly AssistantAvatarPack[]=[{id:baseAvatarPackId,name:'Pack de base',description:'Logo et portrait Nora, sans animation.',assets:{logo:'/brand/mark.png',conversationAvatar:'/brand/mark.png'}}];
export const personalityTemplates:readonly PersonalityTemplate[]=[
 {id:'professional',name:'Professionnel',instructions:'Adopte un ton professionnel, clair et structuré. Présente le résultat attendu, puis les informations utiles. Distingue les faits, les hypothèses et les points à vérifier.'},
 {id:'warm',name:'Chaleureux',instructions:'Adopte un ton chaleureux, calme et attentif. Échange simplement et avec naturel, sans flatterie ni familiarité forcée. Aide à avancer avec des propositions concrètes et explique les points importants avec clarté.'},
 {id:'direct',name:'Direct',instructions:'Adopte un ton direct, concis et concret. Commence par le résultat ou la prochaine action utile. Évite les détours et les répétitions. Signale clairement les incertitudes et donne assez de détails pour agir.'},
 {id:'creative',name:'Créatif',instructions:'Adopte un ton créatif, ouvert et précis. Propose des idées variées lorsque cela aide, puis indique comment les mettre en pratique. Distingue les pistes à explorer des faits vérifiés.'},
];
export function initialPersonality(value:{personality:string;length:string;initiative:string}){
 const template=personalityTemplates.find(item=>item.id===value.personality)??personalityTemplates[1];
 return template.instructions+'\nRéponses '+(({short:'courtes',balanced:'équilibrées',detailed:'détaillées'} as Record<string,string>)[value.length]??'équilibrées')+'.\n'+(value.initiative==='proactive'?'Avance sur les prochaines étapes utiles de la demande dans les permissions accordées.':'Exécute ce qui est nécessaire à la demande, sans proposer de travail annexe.');
}
