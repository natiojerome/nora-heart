export type TaskSchedule =
  | { kind: "once"; at: string; timezone: string }
  | {
      kind: "recurring";
      frequency: "daily" | "weekdays" | "weekly";
      time: string;
      timezone: string;
      weekday?: number;
    };
export interface Task {
  id: string;
  version: number;
  title: string;
  prompt: string;
  conversationId: string;
  schedule: TaskSchedule;
  missed: "catch_up" | "skip";
  notify: boolean;
  active: boolean;
  nextAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export type TaskRunStatus =
  | "queued"
  | "running"
  | "waiting"
  | "succeeded"
  | "failed"
  | "interrupted"
  | "skipped"
  | "cancelled";
export interface TaskRun {
  id: string;
  sequence: string;
  revision: number;
  task: Pick<Task, "id" | "title" | "prompt" | "conversationId" | "notify"> & {
    timezone?: string;
  };
  dueAt: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  scheduled: boolean;
  status: TaskRunStatus;
  detail: string;
  seen: boolean;
  owner?: string;
}
export interface SchedulerLease {
  alive(): boolean;
  release(): Promise<void>;
}
export interface TaskRepository {
  list(options?: { after?: string; limit?: number }): Promise<Task[]>;
  get(id: string): Promise<Task | null>;
  save(task: Task, expectedVersion: number): Promise<Task>;
  due(now: string): Promise<Task[]>;
  schedule(task: Task, run: TaskRun, nextAt: string | null): Promise<boolean>;
  enqueue(
    taskId: string,
    version: number,
    id: string,
    at: string,
  ): Promise<TaskRun>;
  queued(limit: number, after?: string): Promise<TaskRun[]>;
  getRun(id: string): Promise<TaskRun | null>;
  open(): Promise<TaskRun[]>;
  latest(taskIds?: string[]): Promise<TaskRun[]>;
  runs(taskId: string, before?: string, limit?: number): Promise<TaskRun[]>;
  claim(run: TaskRun, owner: string, at: string): Promise<TaskRun | null>;
  transition(
    run: TaskRun,
    next: Pick<TaskRun, "status" | "detail"> &
      Partial<Pick<TaskRun, "finishedAt">>,
  ): Promise<boolean>;
  acknowledge(id: string, status: TaskRunStatus): Promise<void>;
  unread(): Promise<number>;
  lease(): Promise<SchedulerLease | null>;
}
export interface TaskCalendar {
  validate(value: unknown): TaskSchedule;
  next(schedule: TaskSchedule, after: string): string | null;
}
export interface TaskExecution {
  /** Discard derived observations for occurrences no longer open. */
  retain?(ids: ReadonlySet<string>): void;
  execute(run: TaskRun): Promise<void>;
  inspect(
    run: TaskRun,
  ): Promise<{ status: TaskRunStatus; detail: string } | null>;
}
export class TaskError extends Error {}
export class TaskBusy extends Error {}

/** Application operations exposed to interfaces/tools, independent of storage or engine. */
export type TaskDraft = Pick<Task,"title"|"prompt"|"conversationId"|"schedule"|"missed"|"notify"|"active">;
export interface TaskService {
  list(options?:{after?:string;limit?:number}):Promise<{tasks:(Task&{lastRun:TaskRun|null})[];nextCursor:string|null;unread:number;observedAt:string}>;
  get(id:string,before?:string,limit?:number):Promise<{task:Task;runs:TaskRun[];nextCursor:string|null}>;
  create(body:TaskDraft,id:string):Promise<{task:Task}>;
  save(body:TaskDraft&{id:string;version:number}):Promise<{task:Task}>;
  active(id:string,body:{version:number;active:boolean}):Promise<{task:Task}>;
  runNow(id:string,body:{version:number;executionId:string}):Promise<{run:TaskRun}>;
  result(id:string,runId:string,after?:string,limit?:number):Promise<{run:TaskRun;messages:{id:string;at:string;content:string}[];nextCursor:string|null}>;
}
