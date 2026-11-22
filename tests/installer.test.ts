import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
test("installer administration preserves private files, sanitizes failures and exposes usable help", async () => {
  await promisify(execFile)("python3", ["tests/test-installer.py"], {
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
  });
});
test("scheduled wallet backup skips cleanly before Vault setup without loading a key or calling a server", async () => {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "node_modules/tsx/dist/cli.mjs",
      "src/interfaces/wallets.ts",
      "backup-if-configured",
    ],
    {
      env: {
        PATH: process.env.PATH,
        HARNESS_INSTALL_CONFIG_FILE:
          "/tmp/nonexistent-heart-installation-" + process.pid + ".json",
      },
    },
  );
  const result = JSON.parse(stdout);
  if (result.skipped !== true) throw Error("Expected unconfigured backup skip");
});
