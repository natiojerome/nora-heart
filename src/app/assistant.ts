import {validateSkillOverrides} from "./skills.ts";
import {resolvePolicies,validatePolicyOverrides,defaultRuntimePolicies} from "./runtime-policies.ts";
import type {PolicySection} from "../contracts/policies.ts";
import {instructionDefaults,validateInstructionOverrides} from "./instruction-defaults.ts";
import type {InstructionId} from "../contracts/instructions.ts";
import {avatarPacks,baseAvatarPackId,personalityTemplates,initialPersonality} from "./assistant-presets.ts";
import {initialConversationDefaults,validateConversationDefaults} from "./conversation-defaults.ts";
import type {
  AssistantProfileRepository,
  AssistantProfile,
  AssistantSettings,
} from "../contracts/assistant.ts";
export const defaultAssistant: AssistantSettings = {
  name: "Nora",
  gender: "feminine",
  avatar: "nora",
  theme: "light",
  personality: "warm",
  length: "balanced",
  initiative: "discreet",
  animations: true,
  step: 0,
  completed: false,
};
export class Assistant {
  constructor(private readonly repository: AssistantProfileRepository) {}
  presets(){return {avatarPacks,personalityTemplates};}
  private describe(profile:AssistantProfile){
    const settings={...profile.settings,avatarPackId:profile.settings.avatarPackId??baseAvatarPackId,personalityInstructions:profile.settings.personalityInstructions??initialPersonality(profile.settings)};
    const role={feminine:"une assistante personnelle",masculine:"un assistant personnel",neutral:"une IA qui accompagne personnellement l’utilisateur, avec des formulations neutres"}[settings.gender];
    return {...profile,settings,effectivePolicies:resolvePolicies(settings.runtimePolicies??{}),personalityDefault:initialPersonality(settings),presentationInstructions:`Tu t’appelles ${JSON.stringify(settings.name)}. Tu es ${role}.\nPersonnalité et préférences définies par l’utilisateur :\n${settings.personalityInstructions}`};
  }
  async get() {return this.describe((await this.repository.get())??{settings:{...defaultAssistant},version:0});}
  async save(body: Record<string, unknown>) {
    const value = body.settings as Record<string, unknown> | undefined;
    if (
      !value ||
      typeof value.name !== "string" ||
      !value.name.trim() ||
      value.name.trim().length > 60 ||
      /[\u0000-\u001f]/u.test(value.name) ||
      !Number.isInteger(body.version) ||
      Number(body.version) < 0
    )
      throw new Error("Profil assistant invalide.");
    const choices = {
      gender: ["feminine", "masculine", "neutral"],
      avatar: ["nora", "orion", "prisme"],
      theme: ["light", "night", "sage", "graphite", "system"],
      personality: ["professional", "warm", "direct", "creative"],
      length: ["short", "balanced", "detailed"],
      initiative: ["discreet", "proactive"],
    };
    for (const [key, options] of Object.entries(choices))
      if (typeof value[key] !== "string" || !options.includes(value[key]))
        throw new Error("Profil assistant invalide.");
    if (
      typeof value.animations !== "boolean" ||
      typeof value.completed !== "boolean" ||
      !Number.isInteger(value.step) ||
      Number(value.step) < 0 ||
      Number(value.step) > 5
    )
      throw new Error("Profil assistant invalide.");
    const stored=await this.get();
    const avatarPackId=Object.hasOwn(value,'avatarPackId')?value.avatarPackId:stored.settings.avatarPackId??baseAvatarPackId;
    if(typeof avatarPackId!=='string'||!avatarPacks.some(pack=>pack.id===avatarPackId))throw new Error('Profil assistant invalide.');
    const personalityInstructions=Object.hasOwn(value,'personalityInstructions')?value.personalityInstructions:(value.personality===stored.settings.personality?stored.settings.personalityInstructions:initialPersonality(value as unknown as AssistantSettings));
    if(typeof personalityInstructions!=='string'||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(personalityInstructions))throw new Error('Profil assistant invalide.');
    const conversationDefaults=validateConversationDefaults(value.conversationDefaults??stored.settings.conversationDefaults??initialConversationDefaults);
    const settings = {
      skillOverrides:validateSkillOverrides(value.skillOverrides??stored.settings.skillOverrides??{}),
      runtimePolicies:validatePolicyOverrides(value.runtimePolicies??stored.settings.runtimePolicies??{}),
      instructionOverrides:validateInstructionOverrides(value.instructionOverrides??stored.settings.instructionOverrides??{}),
      conversationDefaults,avatarPackId,personalityInstructions,
      ...Object.fromEntries(
        Object.keys(choices).map((key) => [key, value[key]]),
      ),
      name: value.name.trim(),
      animations: value.animations,
      completed: value.completed,
      step: value.step,
    } as AssistantSettings;
    return this.describe(await this.repository.save(settings, Number(body.version)));
  }
  async defaults(){const profile=await this.get();return {defaults:profile.settings.conversationDefaults??structuredClone(initialConversationDefaults),version:profile.version};}
  async saveDefaults(body:Record<string,unknown>){
    if(!Number.isInteger(body.version)||Number(body.version)<0)throw new Error("Profil assistant invalide.");
    const defaults=validateConversationDefaults(body.defaults), profile=await this.get();
    let version=body.version;
    if(version!==profile.version&&body.baseDefaults!==undefined){
      const baseline=validateConversationDefaults(body.baseDefaults);
      const current=profile.settings.conversationDefaults??initialConversationDefaults;
      if(JSON.stringify(baseline)!==JSON.stringify(validateConversationDefaults(current)))throw new Error('Profil modifié ailleurs. Actualise avant de réessayer.');
      version=profile.version;
    }
    const saved=await this.save({version,settings:{...profile.settings,conversationDefaults:defaults}});
    return {defaults:saved.settings.conversationDefaults!,version:saved.version,profile:saved};
  }
  async patch(body:Record<string,unknown>){
    const patch=body.patch as Record<string,unknown>,base=body.base as Record<string,unknown>;
    if(!Number.isInteger(body.version)||Number(body.version)<0||!patch||!base||Object.keys(patch).some(key=>!['theme','name','gender','avatarPackId','personality','personalityInstructions'].includes(key))||!Object.keys(patch).length)throw new Error('Profil assistant invalide.');
    const profile=await this.get();
    if(body.version!==profile.version&&Object.keys(patch).some(key=>JSON.stringify(profile.settings[key as keyof AssistantSettings])!==JSON.stringify(base[key])))throw new Error('Profil modifié ailleurs. Actualise avant de réessayer.');
    return this.save({version:profile.version,settings:{...profile.settings,...patch}});
  }
  async instructionOverrides(){return (await this.get()).settings.instructionOverrides??{};}
  async instructionCatalog(saved?:AssistantProfile){const profile=saved??await this.get(),overrides=profile.settings.instructionOverrides??{};return {version:profile.version,profile:this.describe(profile),blocks:instructionDefaults.map(block=>({...block,value:overrides[block.id]??block.defaultValue,customized:Object.hasOwn(overrides,block.id)}))};}
  async saveInstruction(body:Record<string,unknown>){
    if(!instructionDefaults.some(block=>block.id===body.id)||!Number.isSafeInteger(body.version)||Number(body.version)<0||(body.value!==null&&typeof body.value!=="string")||(body.baseValue!==null&&typeof body.baseValue!=="string"))throw new Error("Instructions invalides.");
    const id=body.id as InstructionId,profile=await this.get(),overrides={...profile.settings.instructionOverrides};
    if(body.version!==profile.version&&(overrides[id]??null)!==body.baseValue)throw new Error("Profil modifié ailleurs. Actualise avant de réessayer.");
    const defaultValue=instructionDefaults.find(block=>block.id===id)!.defaultValue;
    if(body.value===null||body.value===defaultValue)delete overrides[id];else overrides[id]=body.value as string;
    validateInstructionOverrides(overrides);
    const saved=await this.save({version:profile.version,settings:{...profile.settings,instructionOverrides:overrides}});
    return {...await this.instructionCatalog(saved),profile:saved};
  }
  async policies(){return resolvePolicies((await this.get()).settings.runtimePolicies??{});}
  async policyCatalog(saved?:AssistantProfile){
    const profile=saved??await this.get();
    return {profile,version:profile.version,policies:resolvePolicies(profile.settings.runtimePolicies??{}),defaults:structuredClone(defaultRuntimePolicies)};
  }
  async savePolicy(body:Record<string,unknown>){
    if(!Number.isSafeInteger(body.version)||Number(body.version)<0||typeof body.section!=='string'||!Object.hasOwn(defaultRuntimePolicies,body.section))throw new Error('Limites invalides.');
    const section=body.section as PolicySection;
    const canonical=(value:unknown)=>resolvePolicies({[section]:value})[section];
    if(body.value!==null)validatePolicyOverrides({[section]:body.value});
    const base=canonical(body.baseValue),profile=await this.get(),current=resolvePolicies(profile.settings.runtimePolicies??{});
    const fields=body.value===null?Object.keys(defaultRuntimePolicies[section]):Object.keys(body.value as object);
    if(!fields.length||!body.baseValue||typeof body.baseValue!=='object'||fields.some(key=>!Object.hasOwn(body.baseValue as object,key)))throw new Error('Limites invalides.');
    if(body.version!==profile.version&&fields.some(key=>(current[section] as unknown as Record<string,number>)[key]!==(base as unknown as Record<string,number>)[key]))throw new Error('Profil modifié ailleurs. Actualise avant de réessayer.');
    const next=body.value===null?structuredClone(defaultRuntimePolicies[section]):{...current[section],...body.value as object};
    const overrides=validatePolicyOverrides({...current,[section]:next});
    const saved=await this.save({version:profile.version,settings:{...profile.settings,runtimePolicies:overrides}});
    return this.policyCatalog(saved);
  }
  async saveSkill(body:Record<string,unknown>,defaultEnabled:boolean){
    if(typeof body.id!=='string'||typeof body.enabled!=='boolean'||typeof body.baseEnabled!=='boolean'||!Number.isSafeInteger(body.version)||Number(body.version)<0)throw new Error('Réglages de skills invalides.');
    validateSkillOverrides({[body.id]:body.enabled});
    const profile=await this.get(),overrides={...profile.settings.skillOverrides};
    if(body.version!==profile.version&&(overrides[body.id]??defaultEnabled)!==body.baseEnabled)throw new Error('Profil modifié ailleurs. Actualise avant de réessayer.');
    if((overrides[body.id]??defaultEnabled)===body.enabled)return profile;
    if(body.enabled===defaultEnabled)delete overrides[body.id];else overrides[body.id]=body.enabled;
    return this.save({version:profile.version,settings:{...profile.settings,skillOverrides:overrides}});
  }
  async instructions() {return (await this.get()).presentationInstructions;}
}
