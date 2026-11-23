import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { HostExecutionClient } from "../src/modules/tools/terminal/index.ts";
test(
  "native project outlives worker termination and model cancellation, then remains controllable after restart",
  { timeout: 30000 },
  async () => {
    assert.equal(
      process.getuid?.(),
      0,
      "Opt-in native systemd test requires root",
    );
    const root = await mkdtemp(path.join(os.tmpdir(), "heart-independent-")),
      threads = path.join(root, "threads"),
      workspace = path.join(threads, randomUUID()),
      project = path.join(root, "project");
    await mkdir(workspace, { recursive: true });
    await mkdir(project);
    const heartbeat = path.join(project, "heartbeat"),
      socket = path.join(root, "worker.sock");
    let worker: ChildProcess | undefined, id: string | undefined;
    const client = new HostExecutionClient(socket);
    async function startWorker() {
      worker = spawn(
        process.execPath,
        ["--import", "tsx", path.resolve("src/interfaces/host-terminal.ts")],
        {
          stdio: "ignore",
          env: {
            PATH: process.env.PATH,
            HARNESS_HOST_SOCKET: socket,
            HARNESS_HOST_STATE_DIR: path.join(root, "commands"),
            HARNESS_HOST_WORKSPACES: threads,
            HARNESS_HOST_HOME: path.join(root, "home"),
          },
        },
      );
      for (let i = 0; i < 100; i++) {
        try {
          await client.list(workspace);
          return;
        } catch {
          await wait(30);
        }
      }
      throw Error("Worker unavailable");
    }
    async function stopWorker() {
      if (!worker || worker.exitCode !== null) return;
      const child = worker;
      const done = new Promise<void>((resolve) =>
        child.once("exit", () => resolve()),
      );
      child.kill("SIGTERM");
      await Promise.race([
        done,
        wait(5000).then(() => {
          throw Error("Worker failed to exit independently");
        }),
      ]);
    }
    try {
      await writeFile(
        path.join(project, "run.sh"),
        "#!/bin/sh\nwhile :; do echo tick >> heartbeat; echo running; sleep 0.05; done\n",
      );
      await startWorker();
      const controller = new AbortController();
      const command = await client.start(
        workspace,
        { cwd: project, command: "sh run.sh" },
        controller.signal,
      );
      id = command.id;
      assert.equal(command.independent, true);
      for (let i = 0; i < 100; i++) {
        if (await readFile(heartbeat, "utf8").catch(() => "")) break;
        await wait(30);
      }
      const unit = "heart-yolo-" + id + ".service";
      assert.equal(
        execFileSync("systemctl", ["show", unit, "-p", "PartOf", "--value"], {
          encoding: "utf8",
        }).trim(),
        "",
      );
      const spec = execFileSync(
        "systemctl",
        ["show", unit, "-p", "ExecStart", "--value"],
        { encoding: "utf8" },
      );
      assert(!spec.includes(path.resolve("src")));
      assert(!spec.includes(path.resolve(".tools")));
      controller.abort();
      await stopWorker();
      const before = await readFile(heartbeat, "utf8");
      await wait(180);
      assert(
        (await readFile(heartbeat, "utf8")).length > before.length,
        "Project must run without any Heart worker",
      );
      await startWorker();
      const output = await client.read(workspace, id);
      assert.equal(output.command.status, "running");
      assert.match(output.output, /running/);
      await assert.rejects(
        client.write(workspace, id, "anything"),
        /indisponible/,
      );
      assert.equal((await client.stop(workspace, id)).status, "interrupted");
      const stopped = await readFile(heartbeat, "utf8");
      await wait(150);
      assert.equal(await readFile(heartbeat, "utf8"), stopped);
    } finally {
      if (id) {
        try {
          execFileSync("systemctl", ["stop", "heart-yolo-" + id + ".service"], {
            stdio: "ignore",
          });
        } catch {}
        try {
          execFileSync(
            "systemctl",
            ["reset-failed", "heart-yolo-" + id + ".service"],
            { stdio: "ignore" },
          );
        } catch {}
      }
      await stopWorker();
      await rm(root, { recursive: true, force: true });
    }
  },
);
