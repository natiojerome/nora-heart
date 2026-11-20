import type { Event, SessionStore } from "../contracts/storage.ts";
/** Disposable metadata only. Messages, instructions and tool results are never cached. */
export class TaskProgress {
  private cursor: string | null = null;
  private ids: Set<string>;
  private requests = new Set<string>();
  readonly pending = new Set<string>();
  seen = false;
  cancelled = false;
  last: Event["type"] | null = null;
  private updating: Promise<void> | null = null;
  constructor(
    private readonly sessions: SessionStore,
    private readonly conversationId: string,
    runId: string,
    private readonly onEvent?: (event: Event) => void,
  ) {
    this.ids = new Set([runId]);
  }
  private add(event: Event) {
    const data = event.data as {
      requestId?: string;
      response?: { status?: string };
    };
    if (
      event.type === "interaction.resolved" &&
      data.requestId &&
      this.requests.has(data.requestId)
    ) {
      this.ids.add(event.runId);
      this.pending.delete(data.requestId);
      this.cancelled = data.response?.status === "cancelled";
      // run.started precedes interaction.resolved in the atomic resume batch.
      if (!this.cancelled) this.last = "run.started";
    }
    if (this.ids.has(event.runId)) {
      this.seen = true;
      this.onEvent?.(event);
      if (event.type === "interaction.requested") {
        this.requests.add(event.id);
        this.pending.add(event.id);
      }
      if (["run.started", "run.completed", "run.failed"].includes(event.type))
        this.last = event.type;
    }
    this.cursor = event.id;
  }
  update() {
    if (this.updating) return this.updating;
    this.updating = this.scan().finally(() => {
      this.updating = null;
    });
    return this.updating;
  }
  private async scan() {
    if (!this.sessions.page) {
      const events = await this.sessions.read(this.conversationId),
        start = this.cursor
          ? events.findIndex((e) => e.id === this.cursor) + 1
          : 0;
      for (const event of events.slice(start)) this.add(event);
      return;
    }
    let more = true;
    while (more) {
      const page = await this.sessions.page(this.conversationId, {
        after: this.cursor,
        limit: 200,
      });
      for (const event of page.events) this.add(event);
      more = page.hasMore;
    }
  }
}
