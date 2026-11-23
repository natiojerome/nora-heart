export interface CommandSnapshot {
  id: string;
  command: string;
  cwd: string;
  startedAt: string;
  status: "running" | "completed" | "interrupted";
  exitCode: number | null;
  signal: string | null;
  /** Native host execution independent of Heart; stdin is not attached. */
  independent?: boolean;
}
export interface CommandInput {
  command: string;
  cwd?: string;
  network?: boolean;
  timeoutMs?: number;
  /** Explicit temporary stdin session; never use for a deployed project. */
  interactive?: boolean;
}
export interface CommandOutput {
  command: CommandSnapshot;
  output: string;
  offset: number;
  nextOffset: number;
  more: boolean;
}
export interface ExecutionService {
  start(
    workspace: string,
    input: CommandInput,
    signal?: AbortSignal,
  ): Promise<CommandSnapshot>;
  read(
    workspace: string,
    id: string,
    offset?: number,
    length?: number,
  ): Promise<CommandOutput>;
  write(
    workspace: string,
    id: string,
    input: string,
    close?: boolean,
  ): Promise<void>;
  stop(workspace: string, id: string): Promise<CommandSnapshot>;
  list(workspace: string): Promise<CommandSnapshot[]>;
}
