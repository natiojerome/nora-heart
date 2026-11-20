import { appendFile } from "node:fs/promises";
import { openPostgresStorage } from "../../src/modules/storage/postgres/index.ts";
import {openSqliteStorage} from "../../src/modules/storage/sqlite/index.ts";
import { Engine } from "../../src/core/engine.ts";
import type { ModelProvider } from "../../src/contracts/models.ts";
const sqlite=process.env.HEART_TEST_SQLITE_FILE;
const url=process.env.HARNESS_TEST_DATABASE_URL;
if(!sqlite&&(!url||!new URL(url).pathname.endsWith('_test')))throw new Error('Disposable test database required');
const store=sqlite?await openSqliteStorage(sqlite):await openPostgresStorage(url!);
const provider: ModelProvider = {
  id: "crash-fixture",
  async generate() {
    return {
      content: "",
      toolCalls: [
        { id: "known", name: "effect", arguments: { stage: "known" } },
        { id: "crash", name: "effect", arguments: { stage: "crash" } },
        { id: "later", name: "effect", arguments: { stage: "later" } },
      ],
    };
  },
};
const engine = new Engine(store.sessions, [
  {
    name: "effect",
    description: "Isolated crash fixture",
    permission: "files.write",
    parameters: { type: "object", properties: {} },
    async execute(args) {
      await appendFile(
        process.env.HEART_TEST_EFFECT_FILE!,
        JSON.stringify(args) + "\n",
      );
      if ((args as { stage: string }).stage === "crash") {
        console.log("EFFECT_WRITTEN");
        await new Promise(() => {
          setInterval(() => {}, 1000);
        });
      }
      return "known result";
    },
  },
]);
await engine.run({
  sessionId: process.env.HEART_TEST_SESSION!,
  prompt: "fixture",
  provider,
  displayName: "Fixture",
  workspace: ".",
  permissions: new Set(["files.write"]),
  maxSteps: 3,
});
await store.close();
