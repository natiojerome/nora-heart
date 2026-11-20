import { Client, type Pool, type PoolClient } from "pg";
import {
  TaskError,
  type Task,
  type TaskRun,
  type TaskRepository,
  type TaskRunStatus,
} from "../../../contracts/tasks.ts";
const open = "('queued','running','waiting','interrupted')",
  terminal =
    "('waiting','succeeded','failed','interrupted','skipped','cancelled')";
const task = (r: any): Task => ({
  ...r.data,
  version: r.version,
  nextAt: r.next_at?.toISOString() ?? null,
  active: r.active,
});
const run = (r: any): TaskRun => ({
  ...r.data,
  id: r.id,
  sequence: String(r.sequence),
  revision: r.revision,
  status: r.status,
  seen: r.seen,
});
export class PostgresTasks implements TaskRepository {
  constructor(private readonly pool: Pool) {}
  private async tx<T>(fn: (c: PoolClient) => Promise<T>) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const value = await fn(c);
      await c.query("COMMIT");
      return value;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async list(options: { after?: string; limit?: number } = {}) {
    return (
      await this.pool.query("SELECT * FROM harness.tasks WHERE ($1::text IS NULL OR id>$1) ORDER BY id LIMIT $2", [options.after ?? null, options.limit ?? null])
    ).rows.map(task);
  }
  async get(id: string) {
    const r = (
      await this.pool.query("SELECT * FROM harness.tasks WHERE id=$1", [id])
    ).rows[0];
    return r ? task(r) : null;
  }
  async save(value: Task, expected: number) {
    return this.tx(async (c) => {
      const current = (
        await c.query("SELECT * FROM harness.tasks WHERE id=$1 FOR UPDATE", [
          value.id,
        ])
      ).rows[0];
      if ((current?.version ?? 0) !== expected)
        throw new TaskError("Tâche modifiée ailleurs. Recharge sa fiche.");
      if (current)
        await c.query(
          "UPDATE harness.tasks SET version=$2,conversation_id=$3,data=$4,next_at=$5,active=$6 WHERE id=$1",
          [
            value.id,
            value.version,
            value.conversationId,
            value,
            value.nextAt,
            value.active,
          ],
        );
      else
        await c.query(
          "INSERT INTO harness.tasks(id,version,conversation_id,data,next_at,active) VALUES($1,$2,$3,$4,$5,$6)",
          [
            value.id,
            value.version,
            value.conversationId,
            value,
            value.nextAt,
            value.active,
          ],
        );
      await c.query(
        "UPDATE harness.task_runs SET status='cancelled',revision=revision+1,seen=true,data=data||$2::jsonb WHERE task_id=$1 AND status='queued'",
        [
          value.id,
          JSON.stringify({
            status: "cancelled",
            detail:
              "Occurrence annulée après modification ou pause de la tâche.",
            finishedAt: value.updatedAt,
          }),
        ],
      );
      return value;
    });
  }
  async due(now: string) {
    return (
      await this.pool.query(
        `SELECT t.* FROM harness.tasks t WHERE active AND next_at<=$1 AND NOT EXISTS(SELECT 1 FROM harness.task_runs r WHERE r.task_id=t.id AND r.status IN ${open}) ORDER BY next_at,id`,
        [now],
      )
    ).rows.map(task);
  }
  private async insert(c: PoolClient, r: TaskRun) {
    return run(
      (
        await c.query(
          "INSERT INTO harness.task_runs(id,task_id,data,due_at,status,revision,scheduled,notify,seen) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
          [
            r.id,
            r.task.id,
            r,
            r.dueAt,
            r.status,
            r.revision,
            r.scheduled,
            r.task.notify,
            r.seen,
          ],
        )
      ).rows[0],
    );
  }
  async schedule(t: Task, r: TaskRun, nextAt: string | null) {
    return this.tx(async (c) => {
      const updated = await c.query(
        `UPDATE harness.tasks t SET next_at=$3,active=$3::timestamptz IS NOT NULL WHERE id=$1 AND version=$2 AND active AND next_at=$4 AND NOT EXISTS(SELECT 1 FROM harness.task_runs r WHERE r.task_id=t.id AND r.status IN ${open}) RETURNING id`,
        [t.id, t.version, nextAt, t.nextAt],
      );
      if (!updated.rowCount) return false;
      await this.insert(c, r);
      return true;
    });
  }
  async enqueue(taskId: string, version: number, id: string, at: string) {
    return this.tx(async (c) => {
      const t = (
        await c.query("SELECT * FROM harness.tasks WHERE id=$1 FOR UPDATE", [
          taskId,
        ])
      ).rows[0];
      if (!t) throw new TaskError("Tâche introuvable.");
      const prior = (
        await c.query("SELECT * FROM harness.task_runs WHERE id=$1", [id])
      ).rows[0];
      if (prior) {
        if (prior.task_id !== taskId)
          throw new TaskError("Identifiant d’exécution déjà utilisé.");
        return run(prior);
      }
      if (t.version !== version)
        throw new TaskError("Tâche modifiée ailleurs. Recharge sa fiche.");
      if (
        (
          await c.query(
            `SELECT 1 FROM harness.task_runs WHERE task_id=$1 AND status IN ${open}`,
            [taskId],
          )
        ).rowCount
      )
        throw new TaskError(
          "Cette tâche a déjà une exécution en attente ou à vérifier.",
        );
      const value = task(t);
      return this.insert(c, {
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
    const row = (await this.pool.query("SELECT * FROM harness.task_runs WHERE id=$1", [id])).rows[0];
    return row ? run(row) : null;
  }
  async queued(limit: number, after?: string) {
    return (
      await this.pool.query(
        "SELECT * FROM harness.task_runs WHERE status='queued' AND ($2::bigint IS NULL OR sequence>$2) ORDER BY sequence LIMIT NULLIF($1,0)",
        [limit, after ?? null],
      )
    ).rows.map(run);
  }
  async open() {
    return (
      await this.pool.query(
        `SELECT * FROM harness.task_runs WHERE status IN ${open} ORDER BY sequence`,
      )
    ).rows.map(run);
  }
  async latest(taskIds?: string[]) {
    if (taskIds && !taskIds.length) return [];
    return (
      await this.pool.query(
        "SELECT r.* FROM harness.task_runs r JOIN(SELECT task_id,max(sequence) seq FROM harness.task_runs WHERE ($1::text[] IS NULL OR task_id=ANY($1::text[])) GROUP BY task_id) q ON r.sequence=q.seq",
        [taskIds ?? null],
      )
    ).rows.map(run);
  }
  async runs(id: string, before?: string, limit = 20) {
    return (
      await this.pool.query(
        "SELECT * FROM harness.task_runs WHERE task_id=$1 AND ($2::bigint IS NULL OR sequence<$2) ORDER BY sequence DESC LIMIT $3",
        [id, before ?? null, limit],
      )
    ).rows.map(run);
  }
  async claim(r: TaskRun, owner: string, at: string) {
    const value = {
      ...r,
      status: "running",
      owner,
      startedAt: at,
      detail: "Travail en cours.",
    };
    const out = await this.pool.query(
      "UPDATE harness.task_runs SET status='running',revision=revision+1,data=$3 WHERE id=$1 AND revision=$2 AND status='queued' RETURNING *",
      [r.id, r.revision, value],
    );
    return out.rows[0] ? run(out.rows[0]) : null;
  }
  async transition(
    r: TaskRun,
    next: Pick<TaskRun, "status" | "detail"> &
      Partial<Pick<TaskRun, "finishedAt">>,
  ) {
    return !!(
      await this.pool.query(
        "UPDATE harness.task_runs SET status=$3,revision=revision+1,data=$4,seen=false WHERE id=$1 AND revision=$2",
        [r.id, r.revision, next.status, { ...r, ...next }],
      )
    ).rowCount;
  }
  async acknowledge(id: string, status: TaskRunStatus) {
    await this.pool.query(
      "UPDATE harness.task_runs SET seen=true WHERE id=$1 AND status=$2",
      [id, status],
    );
  }
  async unread() {
    return Number(
      (
        await this.pool.query(
          `SELECT count(*) n FROM harness.task_runs WHERE notify AND NOT seen AND status IN ${terminal}`,
        )
      ).rows[0].n,
    );
  }
  async lease() {
    const client = new Client(this.pool.options);
    let alive = true;
    client.on("error", () => {
      alive = false;
    });
    await client.connect();
    try {
      if (
        !(await client.query("SELECT pg_try_advisory_lock(170210,3) ok"))
          .rows[0].ok
      ) {
        await client.end();
        return null;
      }
    } catch (e) {
      await client.end();
      throw e;
    }
    let closed = false;
    return {
      alive: () => alive && !closed,
      async release() {
        if (!closed) {
          closed = true;
          alive = false;
          await client.end().catch(() => {});
        }
      },
    };
  }
}
