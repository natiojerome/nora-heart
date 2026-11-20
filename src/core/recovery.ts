import { randomUUID } from "node:crypto";
import type { Event } from "../contracts/storage.ts";
import type { Message } from "../contracts/messages.ts";
import type { Json } from "../contracts/json.ts";
import {
  RecoveryError,
  type RecoveryCall,
  type RecoveryPlan,
} from "../contracts/recovery.ts";

/** Incremental recovery evidence; does not retain message bodies or completed calls. */
export class RecoveryTracker {
  private runs = new Set<string>();
  private seen = new Set<string>();
  private calls = new Map<string, RecoveryCall>();
  private started = new Set<string>();
  private finished = new Set<string>();
  private pending = new Set<string>();
  private last: string | null = null;
  add(event: Event) {
    this.last = event.id;
    this.seen.add(event.runId);
    if (event.type === "run.started") this.runs.add(event.runId);
    if (
      ["run.completed", "run.failed", "interaction.requested"].includes(
        event.type,
      )
    )
      this.runs.delete(event.runId);
    const data = event.data as unknown as {
      callId?: string;
      requestId?: string;
    };
    const key = event.runId + ":" + data?.callId;
    if (event.type === "tool.started") this.started.add(key);
    if (event.type === "tool.finished") this.finished.add(key);
    if (event.type === "interaction.requested") this.pending.add(event.id);
    if (event.type === "interaction.resolved")
      this.pending.delete(data.requestId!);
    if (event.type !== "message") return;
    const message = event.data as unknown as Message;
    if (message.role === "assistant")
      for (const call of message.toolCalls)
        this.calls.set(event.runId + ":" + call.id, {
          runId: event.runId,
          callId: call.id,
          name: call.name,
          state: "not-started",
        });
    if (message.role === "tool")
      for (const [id, call] of this.calls)
        if (call.callId === message.callId) {
          this.calls.delete(id);
          this.started.delete(id);
          this.finished.delete(id);
        }
  }
  plan(activeRunId: string | null = null): RecoveryPlan {
    return {
      lastEventId: this.last,
      runs: [...new Set([...this.runs, ...(activeRunId ? [activeRunId] : [])])],
      calls: [...this.calls.entries()].map(([key, call]) => ({
        ...call,
        state: this.finished.has(key)
          ? "result-missing"
          : this.started.has(key)
            ? "uncertain"
            : "not-started",
      })),
      unloggedClaim: !!activeRunId && !this.seen.has(activeRunId),
      pendingInput: this.pending.size > 0,
    };
  }
}
export function recoveryPlan(
  events: Event[],
  activeRunId: string | null = null,
): RecoveryPlan {
  const tracker = new RecoveryTracker();
  for (const event of events) tracker.add(event);
  return tracker.plan(activeRunId);
}

export function recoveryEvents(
  plan: RecoveryPlan,
  acknowledgement: boolean,
  note: string,
): Event[] {
  if (plan.pendingInput)
    throw new RecoveryError(
      "Réponds au formulaire en attente avant de réconcilier.",
    );
  if (!plan.runs.length && !plan.calls.length) return [];
  if (
    (plan.unloggedClaim ||
      plan.calls.some((call) => call.state !== "not-started")) &&
    !acknowledgement
  )
    throw new RecoveryError(
      "Vérifie les effets possibles puis confirme leur prise en compte.",
    );
  const events: Event[] = [],
    at = new Date().toISOString();
  const add = (runId: string, type: Event["type"], data: unknown) =>
    events.push({ id: randomUUID(), at, runId, type, data: data as Json });
  for (const call of plan.calls) {
    // No fabricated tool.finished: the invocation result is unknown, not an execution receipt.
    add(call.runId, "message", {
      role: "tool",
      callId: call.callId,
      name: call.name,
      error: true,
      content: JSON.stringify({
        recovery: true,
        state: call.state,
        source: "journal",
        message:
          call.state === "not-started"
            ? "Appel jamais lancé."
            : "Résultat absent. Effet à vérifier avant toute nouvelle action ; ne pas rejouer cet appel.",
        ownerAcknowledged: acknowledgement,
        ...(note ? { ownerNote: note } : {}),
      }),
    });
  }
  for (const runId of new Set([
    ...plan.runs,
    ...plan.calls.map((call) => call.runId),
  ]))
    add(runId, "run.failed", {
      reconciled: true,
      error:
        "Interruption réconciliée par le propriétaire. Aucun outil rejoué.",
      ...(note ? { ownerNote: note } : {}),
    });
  return events;
}
