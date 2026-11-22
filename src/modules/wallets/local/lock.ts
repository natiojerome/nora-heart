import { spawn } from "node:child_process";
import { open } from "node:fs/promises";
import path from "node:path";

/** Cold-path OS lock. Pipe EOF releases it after a caller crash; no PID/TTL lease. */
export async function walletWriteLock<T>(
  directory: string,
  work: () => Promise<T>,
): Promise<T> {
  const file = path.join(directory, "wallets.lock");
  const handle = await open(file, "a", 0o600);
  await handle.close();
  const child = spawn(
    "flock",
    ["-x", file, "sh", "-c", "printf 1; cat >/dev/null"],
    { stdio: ["pipe", "pipe", "ignore"] },
  );
  const done = new Promise<void>((resolve, reject) => {
    child.once("error", () =>
      reject(Error("Wallet writer lock unavailable (flock required).")),
    );
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(Error("Wallet writer lock interrupted.")),
    );
  });
  // Register failure handling immediately, even before readiness.
  void done.catch(() => {});
  child.stdin.on("error", () => {});
  try {
    await Promise.race([
      new Promise<void>((resolve) =>
        child.stdout.once("data", () => resolve()),
      ),
      done.then(() => {
        throw Error("Wallet writer lock not acquired.");
      }),
    ]);
    return await work();
  } finally {
    child.stdin.end();
    await done;
  }
}
