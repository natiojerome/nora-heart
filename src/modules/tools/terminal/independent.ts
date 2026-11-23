import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";
import type { CommandInput } from "../../../contracts/execution.ts";
const run = promisify(execFile);

/** PID 1 owns execution and output. No Heart pipe, runtime, unit or watchdog is required. */
export async function startIndependent(
  id: string,
  cwd: string,
  directory: string,
  input: CommandInput,
) {
  const output = path.join(directory, "output.log"),
    result = path.join(directory, "exit-code");
  // This self-contained POSIX wrapper remains in systemd's unit, not in Heart's process.
  const wrapper =
    'result=$1; shift; "$@"; code=$?; printf "%s\\n" "$code" > "$result.tmp" && mv "$result.tmp" "$result"; exit "$code"';
  await run(
    "/usr/bin/systemd-run",
    [
      "--quiet",
      "--service-type=exec",
      "--expand-environment=no",
      `--unit=heart-yolo-${id}.service`,
      `--working-directory=${cwd}`,
      "--property=ExitType=cgroup",
      "--property=KillMode=control-group",
      `--property=Group=${process.getgid?.() ?? 0}`,
      "--property=UMask=0007",
      "--property=StandardInput=null",
      `--property=StandardOutput=append:${output}`,
      `--property=StandardError=append:${output}`,
      ...(input.timeoutMs
        ? [`--property=RuntimeMaxSec=${input.timeoutMs}ms`]
        : []),
      "--",
      "/bin/sh",
      "-c",
      wrapper,
      "project-command",
      result,
      "/usr/bin/env",
      "-i",
      `HOME=${os.homedir()}`,
      "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      "LANG=C.UTF-8",
      "TERM=dumb",
      "/bin/sh",
      "-c",
      input.command,
    ],
    { env: { PATH: "/usr/bin:/bin" }, timeout: 15000 },
  );
}
