/** Evidence from the journal, never a claim that an external side effect succeeded. */
export interface RecoveryCall {
  runId: string;
  callId: string;
  name: string;
  state: "not-started" | "result-missing" | "uncertain";
}
export interface RecoveryPlan {
  lastEventId: string | null;
  runs: string[];
  calls: RecoveryCall[];
  pendingInput: boolean;
  unloggedClaim: boolean;
}
export class RecoveryError extends Error {}
