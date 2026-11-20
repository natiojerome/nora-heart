import { DatabaseSync } from "node:sqlite";
import {
  TaskError,
  type Task,
  type TaskRun,
  type TaskRepository,
  type TaskRunStatus,
} from "../../../contracts/tasks.ts";
import { one, all, run, transaction, privateFile } from "./database.ts";
const open = "('queued','running','waiting','interrupted')",
  terminal =
    "('waiting','succeeded','failed','interrupted','skipped','cancelled')";
const task = (r: any): Task => ({
  ...JSON.parse(r.data),
  version: r.version,
  nextAt: r.next_at ?? null,
  active: !!r.active,
});
const execution = (r: any): TaskRun => ({
  ...JSON.parse(r.data),
  id: r.id,
  sequence: String(r.sequence),
  revision: r.revision,
  status: r.status,
  seen: !!r.seen,
});
export class SqliteTasks implements TaskRepository {
  private readonly db: DatabaseSync;
  private readonly file: string;
  constructor(db: DatabaseSync, file: string) {
    this.db = db;
    this.file = file;
  }
  async list(options: { after?: string; limit?: number } = {}) {
    return all(this.db, "SELECT * FROM tasks WHERE (? IS NULL OR id>?) ORDER BY id LIMIT ?", options.after ?? null, options.after ?? null, options.limit ?? -1).map(task);
  }
  async get(id: string) {
    const r = one(this.db, "SELECT * FROM tasks WHERE id=?", id);
    return r ? task(r) : null;
  }
  async save(value: Task, expected: number) {
    return transaction(this.db, () => {
      const current = one(this.db, "SELECT * FROM tasks WHERE id=?", value.id);
      if ((current?.version ?? 0) !== expected)
        throw new TaskError("Tâche modifiée ailleurs. Recharge sa fiche.");
      if (current)
        run(
          this.db,
          "UPDATE tasks SET version=?,conversation_id=?,data=?,next_at=?,active=? WHERE id=?",
          value.version,
          value.conversationId,
          JSON.stringify(value),
          value.nextAt,
          +value.active,
          value.id,
        );
      else
        run(
          this.db,
          "INSERT INTO tasks(id,version,conversation_id,data,next_at,active) VALUES(?,?,?,?,?,?)",
          value.id,
          value.version,
          value.conversationId,
          JSON.stringify(value),
          value.nextAt,
          +value.active,
        );
      run(
        this.db,
        "UPDATE task_runs SET status='cancelled',revision=revision+1,seen=1,data=json_patch(data,?) WHERE task_id=? AND status='queued'",
        JSON.stringify({
          status: "cancelled",
          detail: "Occurrence annulée après modification ou pause de la tâche.",
          finishedAt: value.updatedAt,
        }),
        value.id,
      );
      return value;
    });
  }
  async due(now: string) {
    return all(
      this.db,
      `SELECT t.* FROM tasks t WHERE active=1 AND next_at<=? AND NOT EXISTS(SELECT 1 FROM task_runs r WHERE r.task_id=t.id AND r.status IN ${open}) ORDER BY next_at,id`,
      now,
    ).map(task);
  }
  private insert(r: TaskRun) {
    run(
      this.db,
      "INSERT INTO task_runs(id,task_id,data,due_at,status,revision,scheduled,notify,seen) VALUES(?,?,?,?,?,?,?,?,?)",
      r.id,
      r.task.id,
      JSON.stringify(r),
      r.dueAt,
      r.status,
      r.revision,
      +r.scheduled,
      +r.task.notify,
      +r.seen,
    );
    return execution(one(this.db, "SELECT * FROM task_runs WHERE id=?", r.id)!);
  }
  async schedule(t: Task, r: TaskRun, nextAt: string | null) {
    return transaction(this.db, () => {
      const updated = run(
        this.db,
        `UPDATE tasks SET next_at=?,active=? WHERE id=? AND version=? AND active=1 AND next_at=? AND NOT EXISTS(SELECT 1 FROM task_runs r WHERE r.task_id=tasks.id AND r.status IN ${open})`,
        nextAt,
        +(nextAt !== null),
        t.id,
        t.version,
        t.nextAt,
      );
      if (!updated) return false;
      this.insert(r);
      return true;
    });
  }
  async enqueue(taskId: string, version: number, id: string, at: string) {
    return transaction(this.db, () => {
      const t = one(this.db, "SELECT * FROM tasks WHERE id=?", taskId);
      if (!t) throw new TaskError("Tâche introuvable.");
      const prior = one(this.db, "SELECT * FROM task_runs WHERE id=?", id);
      if (prior) {
        if (prior.task_id !== taskId)
          throw new TaskError("Identifiant d’exécution déjà utilisé.");
        return execution(prior);
      }
      if (t.version !== version)
        throw new TaskError("Tâche modifiée ailleurs. Recharge sa fiche.");
      if (
        one(
          this.db,
          `SELECT 1 FROM task_runs WHERE task_id=? AND status IN ${open}`,
          taskId,
        )
      )
        throw new TaskError(
          "Cette tâche a déjà une exécution en attente ou à vérifier.",
        );
      const value = task(t);
      return this.insert({
        id,
        sequence: "0",
        revision: 1,
        task: {
          id: value.id,
          title: value.title,
          prompt: value.prompt,
          conversationId: value.conversationId,
          notify: value.notify,
          timezone: value.schedule.timezone,
        },
        dueAt: at,
        createdAt: at,
        scheduled: false,
        status: "queued",
        detail: "Exécution manuelle en attente.",
        seen: false,
      });
    });
  }
  async getRun(id: string) {
    const row = one(this.db, "SELECT * FROM task_runs WHERE id=?", id);
    return row ? execution(row) : null;
  }
  async queued(limit: number, after?: string) {
    return all(
      this.db,
      "SELECT * FROM task_runs WHERE status='queued' AND (? IS NULL OR sequence>?) ORDER BY sequence LIMIT ?",
      after ?? null,
      after ?? null,
      limit || -1,
    ).map(execution);
  }
  async open() {
    return all(
      this.db,
      `SELECT * FROM task_runs WHERE status IN ${open} ORDER BY sequence`,
    ).map(execution);
  }
  async latest(taskIds?: string[]) {
    if (taskIds && !taskIds.length) return [];
    return all(
      this.db,
      "SELECT r.* FROM task_runs r JOIN(SELECT task_id,max(sequence) seq FROM task_runs" + (taskIds ? ` WHERE task_id IN (${taskIds.map(() => "?").join(",")})` : "") + " GROUP BY task_id) q ON r.sequence=q.seq",
      ...(taskIds ?? []),
    ).map(execution);
  }
  async runs(id: string, before?: string, limit = 20) {
    return all(
      this.db,
      "SELECT * FROM task_runs WHERE task_id=? AND (? IS NULL OR sequence<?) ORDER BY sequence DESC LIMIT ?",
      id,
      before ?? null,
      before ?? null,
      limit,
    ).map(execution);
  }
  async claim(r: TaskRun, owner: string, at: string) {
    const value = {
      ...r,
      status: "running",
      owner,
      startedAt: at,
      detail: "Travail en cours.",
    };
    const updated = run(
      this.db,
      "UPDATE task_runs SET status='running',revision=revision+1,data=? WHERE id=? AND revision=? AND status='queued'",
      JSON.stringify(value),
      r.id,
      r.revision,
    );
    return updated
      ? execution(one(this.db, "SELECT * FROM task_runs WHERE id=?", r.id)!)
      : null;
  }
  async transition(
    r: TaskRun,
    next: Pick<TaskRun, "status" | "detail"> &
      Partial<Pick<TaskRun, "finishedAt">>,
  ) {
    return !!run(
      this.db,
      "UPDATE task_runs SET status=?,revision=revision+1,data=?,seen=0 WHERE id=? AND revision=?",
      next.status,
      JSON.stringify({ ...r, ...next }),
      r.id,
      r.revision,
    );
  }
  async acknowledge(id: string, status: TaskRunStatus) {
    run(
      this.db,
      "UPDATE task_runs SET seen=1 WHERE id=? AND status=?",
      id,
      status,
    );
  }
  async unread() {
    return Number(
      one(
        this.db,
        `SELECT count(*) n FROM task_runs WHERE notify=1 AND seen=0 AND status IN ${terminal}`,
      )!.n,
    );
  }
  async lease() {
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(
        privateFile(this.file + ".runtime/scheduler.sqlite", true),
        { timeout: 0 },
      );
      db.exec(
        "CREATE TABLE IF NOT EXISTS anchor(id INTEGER PRIMARY KEY); BEGIN EXCLUSIVE",
      );
    } catch (e) {
      db?.close();
      if ([5, 6].includes((e as { errcode: number }).errcode)) return null;
      throw e;
    }
    let closed = false;
    return {
      alive: () => !closed,
      async release() {
        if (!closed) {
          closed = true;
          db!.close();
        }
      },
    };
  }
}
