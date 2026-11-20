import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Engine } from "../src/core/engine.ts";
import { JsonlSessions } from "../src/modules/storage/json/index.ts";
import type { CompletionReview } from "../src/contracts/completion-review.ts";
import type { ModelProvider } from "../src/contracts/models.ts";
import type { Tool } from "../src/contracts/tools.ts";

async function fixture(
  action: (sessions: JsonlSessions, workspace: string) => Promise<void>,
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "heart-final-review-"));
  try {
    await action(new JsonlSessions(root + "/state"), root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("completion review cannot bypass permissions, runs once and leaves no premature final answer", async () =>
  fixture(async (sessions, workspace) => {
    let effects = 0,
      reviews = 0,
      calls = 0;
    const tool: Tool = {
      name: "private.effect",
      permission: "files.write",
      description: "Test effect",
      parameters: { type: "object" },
      async execute() {
        effects++;
        return "done";
      },
    };
    const review: CompletionReview = {
      name: "fixture",
      failureMessage: "Final review unavailable.",
      async review() {
        reviews++;
        return {
          response: {
            content: "Checking an effect.",
            toolCalls: [{ id: "effect", name: tool.name, arguments: {} }],
          },
          audit: { status: "decided" },
        };
      },
    };
    const provider: ModelProvider = {
      id: "fake",
      async generate(request) {
        calls++;
        const last = request.messages.at(-1);
        if (last?.role === "tool") assert.equal(last.error, true);
        return {
          content:
            last?.role === "tool"
              ? "Permission refusée."
              : "Draft must not be published.",
          toolCalls: [],
        };
      },
    };
    const result = await new Engine(sessions, [tool], undefined, review).run({
      sessionId: "one",
      provider,
      prompt: "Test",
      displayName: "Test",
      workspace,
      permissions: new Set(),
    });
    assert.equal(result.text, "Permission refusée.");
    assert.equal(effects, 0);
    assert.equal(reviews, 1);
    assert.equal(calls, 2);
    const events = await sessions.read("one");
    assert(
      !events.some(
        (e) =>
          e.type === "message" &&
          (e.data as any).content === "Draft must not be published.",
      ),
    );
    assert(
      events.some((e) => e.type === "tool.finished" && (e.data as any).error),
    );
  }));

test("cancelling during final review cannot publish a success or execute proposed actions", async () =>
  fixture(async (sessions, workspace) => {
    const controller = new AbortController();
    let effects = 0;
    const tool: Tool = {
      name: "test.effect",
      permission: "memory.write",
      description: "Effect",
      parameters: { type: "object" },
      async execute() {
        effects++;
        return "done";
      },
    };
    const review: CompletionReview = {
      name: "fixture",
      failureMessage: "Final review unavailable.",
      async review() {
        controller.abort();
        return {
          response: {
            content: "",
            toolCalls: [{ id: "effect", name: tool.name, arguments: {} }],
          },
          audit: { status: "decided" },
        };
      },
    };
    const provider: ModelProvider = {
      id: "fake",
      async generate() {
        return { content: "Initial answer", toolCalls: [] };
      },
    };
    await assert.rejects(
      new Engine(sessions, [tool], undefined, review).run({
        sessionId: "one",
        provider,
        prompt: "Test",
        displayName: "Test",
        workspace,
        permissions: new Set(["memory.write"]),
        signal: controller.signal,
      }),
    );
    const events = await sessions.read("one");
    assert.equal(effects, 0);
    assert.equal(events.at(-1)?.type, "run.failed");
    assert(!events.some((e) => e.type === "run.completed"));
  }));
