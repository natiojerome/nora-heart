import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Event } from "../src/contracts/storage.ts";
import type { Json } from "../src/contracts/json.ts";
import { recoveryPlan, recoveryEvents } from "../src/core/recovery.ts";

function e(type: Event["type"], data: unknown = {}, runId = "r"): Event {
  return {
    id: randomUUID(),
    at: new Date().toISOString(),
    runId,
    type,
    data: data as Json,
  };
}
function interrupted() {
  return [
    e("run.started"),
    e("message", {
      role: "assistant",
      content: "",
      toolCalls: ["done", "lost", "unknown", "skipped"].map((id) => ({
        id,
        name: "write",
        arguments: {},
      })),
    }),
    e("tool.started", { callId: "done" }),
    e("tool.finished", { callId: "done" }),
    e("message", {
      role: "tool",
      callId: "done",
      name: "write",
      content: "saved",
      error: false,
    }),
    e("tool.started", { callId: "lost" }),
    e("tool.finished", { callId: "lost" }),
    e("tool.started", { callId: "unknown" }),
  ];
}

test("recovery preserves actual results and distinguishes unstarted, lost and uncertain calls", () => {
  const events = interrupted(),
    plan = recoveryPlan(events);
  assert.deepEqual(
    plan.calls.map((c) => [c.callId, c.state]),
    [
      ["lost", "result-missing"],
      ["unknown", "uncertain"],
      ["skipped", "not-started"],
    ],
  );
  assert.throws(() => recoveryEvents(plan, false, ""), /Vérifie/);
  const repair = recoveryEvents(
    plan,
    true,
    "Commande vérifiée : sortie inconnue.",
  );
  assert.equal(repair.filter((e) => e.type === "tool.finished").length, 0);
  assert.equal(repair.filter((e) => e.type === "message").length, 3);
  const after = recoveryPlan([...events, ...repair]);
  assert.deepEqual(after.runs, []);
  assert.deepEqual(after.calls, []);
  assert.equal(
    events[4].data && JSON.stringify(events[4].data).includes("saved"),
    true,
  );
});
test("recovery without action can close without an ambiguity acknowledgement", () => {
  const events = [e("run.started")],
    repair = recoveryEvents(recoveryPlan(events), false, "");
  assert.equal(repair.length, 1);
  assert.equal(repair[0].type, "run.failed");
});
test("an already failed run with missing results still requires reconciliation", () => {
  const events = [...interrupted(), e("run.failed")];
  assert.equal(recoveryPlan(events).runs.length, 0);
  assert.equal(
    recoveryEvents(recoveryPlan(events), true, "").at(-1)?.type,
    "run.failed",
  );
});
test("completed histories produce no repair", () => {
  assert.deepEqual(
    recoveryEvents(
      recoveryPlan([e("run.started"), e("run.completed")]),
      false,
      "",
    ),
    [],
  );
});

test("a crashed claim before the first event is visible and can be closed without replay", () => {
  const plan = recoveryPlan([], "claimed-before-log");
  assert.deepEqual(plan.runs, ["claimed-before-log"]);
  assert.equal(plan.lastEventId, null);
  assert.throws(() => recoveryEvents(plan, false, ""), /Vérifie/);
  assert.equal(recoveryEvents(plan, true, "")[0].runId, "claimed-before-log");
});
