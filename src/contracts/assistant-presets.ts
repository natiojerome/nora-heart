export interface AssistantAvatarPack {
  id:string;name:string;description:string;
  assets:{logo:string;conversationAvatar:string};
}
export interface PersonalityTemplate {id:'professional'|'warm'|'direct'|'creative';name:string;instructions:string;}
