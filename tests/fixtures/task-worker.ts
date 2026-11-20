import path from "node:path";
import { TestLab } from "../../src/app/test-lab.ts";
import { openWebConversations } from "../../src/app/web-conversations.ts";
const file = process.env.HEART_TASK_TEST_SQLITE!;
if (!file || !file.startsWith("/tmp/heart-tasks-"))
  throw Error("Disposable fixture required");
const root = path.dirname(file),
  lab = new TestLab({
    directory: root + "/worker-lab",
    authDirectory: root + "/worker-auth",
  });
await lab.prepare();
lab.model = () => ({
  id: "crash-fake",
  async generate(request) {
    if (request.messages.at(-1)?.role === "tool") {
      process.stdout.write("EFFECT_WRITTEN\n");
      return new Promise<never>(() => {});
    }
    return {
      content: "",
      toolCalls: [
        {
          id: "effect",
          name: "files.create",
          arguments: { path: "effect.txt", content: "once" },
        },
      ],
    };
  },
});
const app = await openWebConversations(
  { driver: "sqlite", file },
  root + "/state",
  lab,
);
app.scheduler.start();
