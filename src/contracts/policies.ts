/** Owner-selected runtime policies, independent of providers, SDKs and storage. */
export interface MessagePolicy {
  maxCharacters: number;
}
export interface ToolPolicy {
  maxCallsPerBatch: number;
}
export interface ContextPolicy {
  compressionPercent: number;
  maxSummaryCalls: number;
  maxSummaryCharacters: number;
  recentTurns: number;
}
export interface MemoryPolicy {
  candidates: number;
  results: number;
  terms: number;
  injectedItems: number;
  injectedCharacters: number;
}
export interface RuntimePolicies {
  messages: MessagePolicy;
  tools: ToolPolicy;
  context: ContextPolicy;
  memory: MemoryPolicy;
}
export type PolicySection = keyof RuntimePolicies;
export type PolicyOverrides = {
  [K in PolicySection]?: Partial<RuntimePolicies[K]>;
};
export const defaultRuntimePolicies: Readonly<RuntimePolicies> = {
  messages: { maxCharacters: 0 },
  tools: { maxCallsPerBatch: 0 },
  context: {
    compressionPercent: 80,
    maxSummaryCalls: 0,
    maxSummaryCharacters: 0,
    recentTurns: 4,
  },
  memory: {
    candidates: 0,
    results: 12,
    terms: 16,
    injectedItems: 0,
    injectedCharacters: 0,
  },
};
