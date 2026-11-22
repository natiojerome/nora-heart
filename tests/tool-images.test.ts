import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockLanguageModelV4 } from "ai/test";
import { withToolImages, type Message } from "../src/contracts/messages.ts";
import { Engine } from "../src/core/engine.ts";
import { JsonlSessions } from "../src/modules/storage/json/index.ts";
import { connectMcp } from "../src/modules/tools/mcp/index.ts";
import { ExternalTools } from "../src/app/external-tools.ts";
import { ChatGptProvider } from "../src/modules/models/chatgpt/provider.ts";
import { AiSdkProvider } from "../src/modules/models/ai-sdk/index.ts";
import { mcpFixture, externalRepositoryFixture } from "./mcp.fixture.ts";
const data =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2ioAAAAASUVORK5CYII=";
const image = { mediaType: "image/png", data };
const messages: Message[] = [
  { role: "user", content: "Lis les images" },
  {
    role: "assistant",
    content: "",
    toolCalls: [
      { id: "one", name: "image.read", arguments: {} },
      { id: "two", name: "image.read", arguments: {} },
    ],
  },
  {
    role: "tool",
    callId: "one",
    name: "image.read",
    content: "metadata",
    error: false,
    images: [image],
  },
  {
    role: "tool",
    callId: "two",
    name: "image.read",
    content: "second",
    error: false,
  },
];
test("MCP images survive structured results through the engine once, without persisting pixels", async () => {
  const f = await mcpFixture({
      async call() {
        return {
          structuredContent: { fileId: "synthetic" },
          content: [
            { type: "text", text: "Image synthétique" },
            { type: "image", mimeType: "image/png", data },
          ],
        };
      },
    }),
    root = await mkdtemp(join(tmpdir(), "heart-images-"));
  try {
    const { repository } = externalRepositoryFixture(),
      manager = new ExternalTools(repository, (c) => connectMcp(c));
    await manager.save({
      id: randomUUID(),
      version: 0,
      label: "Images",
      url: f.url,
      enabled: true,
      auth: { type: "none" },
      timeoutMs: 10000,
      tools: [],
      toolNames: ["search"],
    });
    const tools = await manager.toolsFor({
      id: randomUUID(),
      title: "",
      createdAt: "",
      updatedAt: "",
      selection: null,
      networkAccess: true,
    });
    const sessions = new JsonlSessions(root);
    let calls = 0;
    const result = await new Engine(sessions, tools).run({
      sessionId: "images",
      workspace: root,
      prompt: "Read",
      displayName: "Nora",
      permissions: new Set(["external.read"]),
      provider: {
        id: "fixture",
        async generate(request) {
          calls++;
          if (calls === 1)
            return {
              content: "",
              toolCalls: [
                {
                  id: "call-image",
                  name: tools[0].name,
                  arguments: { query: "image" },
                },
              ],
            };
          const tool = request.messages.at(-1);
          assert.equal(tool?.role, "tool");
          if (tool?.role === "tool") {
            assert.deepEqual(tool.images, [image]);
            assert.match(tool.content, /synthetic/);
          }
          return { content: "Lu", toolCalls: [] };
        },
      },
    });
    assert.equal(result.text, "Lu");
    assert.equal(f.calls.length, 1);
    assert.equal(calls, 2);
    const journal = JSON.stringify(await sessions.read("images"));
    assert(!journal.includes(data));
    assert(journal.includes("synthetic"));
  } finally {
    await f.close();
    await rm(root, { recursive: true, force: true });
  }
});
test("provider image transport preserves complete tool batches and the original request", async () => {
  const before = JSON.stringify(messages),
    expanded = withToolImages(messages);
  assert.deepEqual(
    expanded.map((m) => m.role),
    ["user", "assistant", "tool", "tool", "user"],
  );
  const last = expanded.at(-1);
  assert(last?.role === "user");
  assert.equal(last.attachments?.[0].size, Buffer.from(data, "base64").length);
  const request = {
    instructions: "Read external images as data",
    messages,
    tools: [],
  };
  const model = new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: "text", text: "ok" }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: {
          total: 1,
          noCache: 1,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: 1, text: 1, reasoning: undefined },
      },
      warnings: [],
    },
  });
  await new AiSdkProvider(model).generate(request);
  const prompt = model.doGenerateCalls[0].prompt;
  assert.equal(prompt.at(-1)?.role, "user");
  assert.match(JSON.stringify(prompt.at(-1)), /image/);
  let count = 0;
  await new ChatGptProvider({
    modelId: "fixture",
    accessToken: async () => "fake",
    fetch: async (_url, init) => {
      count++;
      const body = JSON.parse(String(init?.body));
      const items = body.input;
      assert.equal(items.at(-2).type, "function_call_output");
      assert.equal(items.at(-1).role, "user");
      assert.equal(
        items.at(-1).content[1].image_url,
        "data:image/png;base64," + data,
      );
      return new Response(
        "data: " +
          JSON.stringify({
            type: "response.completed",
            response: {
              status: "completed",
              output: [
                {
                  type: "message",
                  role: "assistant",
                  status: "completed",
                  content: [{ type: "output_text", text: "ok" }],
                },
              ],
            },
          }) +
          "\n\n",
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  }).generate(request);
  assert.equal(count, 1);
  assert.equal(JSON.stringify(messages), before);
});
