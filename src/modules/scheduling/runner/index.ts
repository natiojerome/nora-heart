import { randomUUID } from "node:crypto";
import {
  TaskBusy,
  type TaskRepository,
  type TaskCalendar,
  type TaskExecution,
  type SchedulerLease,
  type TaskRun,
} from "../../../contracts/tasks.ts";
export class Scheduler {
  private lease: SchedulerLease | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private ticking: Promise<void> | null = null;
  private stopping = false;
  private started = false;
  private error: string | null = null;
  private active = new Map<string, Promise<void>>();
  private startedAt: string;
  private queueAfter: string | undefined;
  readonly intervalMs: number;
  readonly concurrency: number;
  constructor(
    private readonly repository: TaskRepository,
    private readonly calendar: TaskCalendar,
    private readonly execution: TaskExecution,
    private readonly options: {
      now?: () => string;
      intervalMs?: number;
      concurrency?: number;
      available?: () => Promise<boolean>;
    } = {},
  ) {
    this.intervalMs = options.intervalMs ?? 5000;
    this.concurrency = options.concurrency ?? 2;
    if (
      !Number.isSafeInteger(this.intervalMs) ||
      this.intervalMs < 1 ||
      this.intervalMs > 2147483647 ||
      !Number.isSafeInteger(this.concurrency) ||
      this.concurrency < 0
    )
      throw Error("Configuration du planificateur invalide.");
    this.startedAt = this.now();
  }
  private now() {
    return this.options.now?.() ?? new Date().toISOString();
  }
  state() {
    return {
      running: !this.stopping && !!this.lease?.alive(),
      active: this.active.size,
      ticking: !!this.ticking,
      error: this.error,
      intervalMs: this.intervalMs,
      concurrency: this.concurrency,
    };
  }
  start() {
    if (this.started || this.stopping) return;
    this.started = true;
    const loop = async () => {
      try {
        await this.tick();
      } catch {
        /* State stays durable; no raw provider/database error logged. */
      }
      if (!this.stopping) this.timer = setTimeout(loop, this.intervalMs);
    };
    void loop();
  }
  stop() {
    this.stopping = true;
    clearTimeout(this.timer);
    this.timer = undefined;
  }
  async close() {
    this.stop();
    await this.ticking?.catch(() => {});
    await Promise.allSettled(this.active.values());
    await this.lease?.release();
    this.lease = null;
  }
  tick(): Promise<void> {
    if (this.ticking) return this.ticking;
    const task = this.poll().then(
      () => {
        this.error = null;
      },
      (error) => {
        this.error = "Planification indisponible. Vérifier le service.";
        throw error;
      },
    );
    this.ticking = task;
    void task
      .finally(() => {
        if (this.ticking === task) this.ticking = null;
      })
      .catch(() => {});
    return task;
  }
  async drain() {
    await Promise.allSettled(this.active.values());
  }
  private async poll() {
    if (
      this.stopping ||
      (this.options.available && !(await this.options.available()))
    )
      return;
    if (!this.lease?.alive()) {
      await this.lease?.release();
      this.lease = await this.repository.lease();
      if (!this.lease) return;
    }
    const now = this.now();
    const open = await this.repository.open();
    this.execution.retain?.(new Set([...open.map(run=>run.id),...this.active.keys()]));
    for (const run of open) {
      if (this.active.has(run.id)) continue;
      const result = await this.execution.inspect(run);
      if (result && result.status !== run.status)
        await this.repository.transition(run, {
          ...result,
          ...(!["queued", "running", "waiting", "interrupted"].includes(
            result.status,
          )
            ? { finishedAt: now }
            : {}),
        });
      else if (run.status === "running" && !result)
        await this.repository.transition(run, {
          status: "interrupted",
          detail:
            "Réservation interrompue. Vérifier la conversation avant toute nouvelle exécution.",
        });
    }
    for (const task of await this.repository.due(now)) {
      const due = task.nextAt!,
        following = this.calendar.next(task.schedule, due),
        missed =
          due < this.startedAt || (following !== null && following <= now),
        skip = task.missed === "skip" && missed;
      const nextAt = this.calendar.next(task.schedule, now),
        run: TaskRun = {
          id: randomUUID(),
          sequence: "0",
          revision: 1,
          task: {
            id: task.id,
            title: task.title,
            prompt: task.prompt,
            conversationId: task.conversationId,
            notify: task.notify,
            timezone: task.schedule.timezone,
          },
          dueAt: due,
          createdAt: now,
          scheduled: true,
          status: skip ? "skipped" : "queued",
          detail: skip
            ? "Échéance manquée ignorée selon le réglage de la tâche."
            : "En attente de la conversation.",
          seen: false,
          ...(skip ? { finishedAt: now } : {}),
        };
      await this.repository.schedule(task, run, nextAt);
    }
    const slots = this.concurrency
      ? Math.max(0, this.concurrency - this.active.size)
      : 0;
    if (this.concurrency && !slots) return;
    let candidates = await this.repository.queued(slots, this.queueAfter);
    if (!candidates.length && this.queueAfter) {
      this.queueAfter = undefined;
      candidates = await this.repository.queued(slots);
    }
    for (const candidate of candidates) {
      if (this.stopping || !this.lease.alive()) break;
      this.queueAfter = candidate.sequence;
      const run = await this.repository.claim(candidate, "scheduler", now);
      if (!run) continue;
      const promise = this.execute(run);
      this.active.set(run.id, promise);
      void promise.finally(() => this.active.delete(run.id)).catch(() => {});
    }
  }
  private async execute(run: TaskRun) {
    try {
      await this.execution.execute(run);
      const result = await this.execution.inspect(run);
      await this.repository.transition(run, {
        status: result?.status ?? "interrupted",
        detail: result?.detail ?? "Résultat à vérifier dans la conversation.",
        ...(!result || ["waiting", "interrupted"].includes(result.status)
          ? {}
          : { finishedAt: this.now() }),
      });
    } catch (error) {
      if (error instanceof TaskBusy)
        await this.repository.transition(run, {
          status: "queued",
          detail: "Conversation occupée ; la tâche attend son tour.",
        });
      else {
        const result = await this.execution.inspect(run).catch(() => null);
        await this.repository.transition(run, {
          status: result?.status ?? "failed",
          detail:
            result?.detail ??
            "Exécution impossible. Vérifier la conversation et ses réglages.",
          finishedAt: this.now(),
        });
      }
    }
  }
}
