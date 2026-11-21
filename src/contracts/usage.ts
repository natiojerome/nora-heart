import type {ModelSelection} from './conversations.ts';
export interface ContextUsage {inputTokens:number;contextWindow:number;reserveTokens:number;estimated:true;}
export interface QuotaWindow {
  limitId:string;limitName:string;windowDurationMins:number;usedPercent:number;
  remainingPercent:number;resetsAt:string;
}
export interface AccountQuotaSnapshot {
  version:1;accountFingerprint:string;observedAt:string;windows:QuotaWindow[];
  status:'available'|'unavailable';
}
export interface ProviderUsage {
  provider:ModelSelection['provider'];modelId:string;status:'available'|'unavailable'|'not_applicable'|'unconfigured';observedAt:string;
  spend?:{scope:'key';currency:'USD';total?:number;daily?:number;weekly?:number;monthly?:number};
  balance?:{remaining:number;currency:'USD';scope:'account'|'budget'|'key';label?:string};
  balanceDetails?:{label:string;remaining:number;unit:string;resetsAt?:string}[];
  rateLimits?:{requestsPerMinute?:number;tokensPerMinute?:number};
  reset?:{at?:string;interval?:string|null;scope:'budget'|'key'};
  dailyRequests?:{remaining:number;limit:number};
  quota?:{scope:'account';windows:QuotaWindow[];appLimitAvailable:false};
  source:string;message:string;dashboardUrl?:string;
}
