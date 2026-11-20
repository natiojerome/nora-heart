import type { Event, SessionStore } from "../contracts/storage.ts";
import type {
  Interaction,
  InputRequest,
  InputResponse,
} from "../contracts/interactions.ts";
import type { ContextUsage } from "../contracts/usage.ts";
import { eventPage, type EventWindow } from "../contracts/history.ts";
import { RecoveryTracker } from "../core/recovery.ts";

/** Disposable owner-view projection, rebuilt from the journal after restart.
 * Only metadata and forms are retained; message/file/tool result bodies are not cached.
 */
export class ConversationView {
  cursor: string | null = null;
  revision = 0;
  workEvent: Event | null = null;
  messageCount = 0;
  segments = 1;
  contextUsage:
    | (ContextUsage & {
        at: string;
        model?: { provider: string; modelId: string };
      })
    | null = null;
  inventory: Event | null = null;
  interactions = new Map<string, Interaction>();
  recovery = new RecoveryTracker();
  private updating: Promise<void> | null = null;
  constructor(
    private readonly sessions: SessionStore,
    private readonly id: string,
  ) {}
  private add(event: Event) {
    this.revision++;
    if (
      [
        "run.completed",
        "run.failed",
        "interaction.requested",
        "interaction.resolved",
      ].includes(event.type)
    )
      this.workEvent = event;
    this.cursor = event.id;
    this.recovery.add(event);
    const data = event.data as Record<string, any>;
    if (
      event.type === "message" &&
      ["user", "assistant"].includes(data.role) &&
      !data.toolCalls?.length
    )
      this.messageCount++;
    if (event.type === "context.checkpoint") this.segments++;
    if (event.type === "context.usage")
      this.contextUsage = { ...data, at: event.at } as ContextUsage & {
        at: string;
      };
    if (event.type === "run.started") this.inventory = event;
    if (event.type === "interaction.requested")
      this.interactions.set(event.id, {
        id: event.id,
        callId: data.callId,
        toolName: data.toolName,
        request: data.request as InputRequest,
        at: event.at,
        status: "pending",
      });
    if (event.type === "interaction.resolved") {
      const item = this.interactions.get(data.requestId);
      if (item) {
        item.status = (data.response as InputResponse).status;
        item.response = data.response;
        item.respondedAt = event.at;
      }
    }
  }
  async update() {
    if (this.updating) return this.updating;
    this.updating = this.scan().finally(() => {
      this.updating = null;
    });
    return this.updating;
  }
  private async scan() {
    if (!this.sessions.page) {
      const events = await this.sessions.read(this.id);
      const start = this.cursor
        ? events.findIndex((e) => e.id === this.cursor) + 1
        : 0;
      for (const event of events.slice(start)) this.add(event);
      return;
    }
    let more = true;
    while (more) {
      const page = await this.sessions.page(this.id, {
        after: this.cursor,
        limit: 500,
      });
      for (const event of page.events) this.add(event);
      more = page.hasMore;
    }
  }
  page(input: EventWindow) {
    return this.sessions.page
      ? this.sessions.page(this.id, input)
      : this.sessions.read(this.id).then((events) => eventPage(events, input));
  }
}
