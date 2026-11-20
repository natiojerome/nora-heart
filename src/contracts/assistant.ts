import type {InstructionOverrides} from "./instructions.ts";
import type {ConversationDefaults} from "./conversation-defaults.ts";
export interface AssistantSettings {
  skillOverrides?:import("./skills.ts").SkillOverrides;
  runtimePolicies?:import("./policies.ts").PolicyOverrides;
  instructionOverrides?: InstructionOverrides;
  conversationDefaults?: ConversationDefaults;
  avatarPackId?:string;
  personalityInstructions?:string;
  name: string;
  gender: "feminine" | "masculine" | "neutral";
  avatar: "nora" | "orion" | "prisme";
  theme: "light" | "night" | "sage" | "graphite" | "system";
  personality: "professional" | "warm" | "direct" | "creative";
  length: "short" | "balanced" | "detailed";
  initiative: "discreet" | "proactive";
  animations: boolean;
  step: number;
  completed: boolean;
}
export interface AssistantProfile {
  effectivePolicies?:import("./policies.ts").RuntimePolicies;
  /** Derived response metadata, never a second persisted source of identity. */
  personalityDefault?: string;
  presentationInstructions?: string;
  settings: AssistantSettings;
  version: number;
}
export interface AssistantProfileRepository {
  get(): Promise<AssistantProfile | null>;
  save(
    settings: AssistantSettings,
    expectedVersion: number,
  ): Promise<AssistantProfile>;
}
