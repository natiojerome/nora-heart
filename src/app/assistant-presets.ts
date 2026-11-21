import type {AssistantAvatarPack,PersonalityTemplate} from '../contracts/assistant-presets.ts';
export const baseAvatarPackId='bdcb9596-cc59-44de-ad7f-b3e783593ca4';
// Only the current approved static base is offered. Older animation experiments stay out of the UI.
export const avatarPacks:readonly AssistantAvatarPack[]=[{id:baseAvatarPackId,name:'Pack de base',description:'Logo et portrait Nora, sans animation.',assets:{logo:'/brand/mark.png',conversationAvatar:'/brand/mark.png'}}];
export const personalityTemplates:readonly PersonalityTemplate[]=[
 {id:'professional',name:'Professionnel',instructions:'Structure clairement les résultats et les informations utiles.'},
 {id:'warm',name:'Chaleureux',instructions:'Échange avec chaleur et simplicité, sans flatterie ni familiarité forcée.'},
 {id:'direct',name:'Direct',instructions:'Va droit au résultat, avec assez de précisions pour agir.'},
 {id:'creative',name:'Créatif',instructions:'Apporte des idées utiles et concrètes, puis aide à les mettre en œuvre.'},
];
export function initialPersonality(value:{personality:string;length:string;initiative:string}){
 const template=personalityTemplates.find(item=>item.id===value.personality)??personalityTemplates[1];
 return 'Avec l’utilisateur : amical, naturel et attentif. Avec les interlocuteurs externes : amical et professionnel, registre adapté au destinataire.\n'+template.instructions+'\nRéponses '+(({short:'courtes',balanced:'équilibrées',detailed:'détaillées'} as Record<string,string>)[value.length]??'équilibrées')+'.\n'+(value.initiative==='proactive'?'Avance sur les prochaines étapes utiles de la demande dans les permissions accordées.':'Exécute ce qui est nécessaire à la demande, sans proposer de travail annexe.');
}
