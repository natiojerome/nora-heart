import type { Event } from "./storage.ts";
/** Immutable event identifiers are opaque cursors, scoped to one session. */
export interface EventWindow {
  before?: string;
  after?: string | null;
  limit?: number;
}
export interface EventPage {
  events: Event[];
  before: string | null;
  after: string | null;
  hasMore: boolean;
}
export function pageSize(value: number | undefined, fallback = 200): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error("Pagination invalide.");
  return value;
}
export function validateWindow(input: EventWindow): number {
  if (input.before !== undefined && input.after !== undefined)
    throw new Error("Pagination invalide.");
  for (const cursor of [input.before, input.after])
    if (cursor != null && !/^[a-zA-Z0-9_-]{1,100}$/.test(cursor))
      throw new Error("Pagination invalide.");
  return pageSize(input.limit);
}
/** Fallback for demo/custom stores. SQL adapters use indexed sequence queries. */
export function eventPage(events: Event[], input: EventWindow): EventPage {
  const limit = validateWindow(input),
    cursor = input.before ?? input.after;
  const index =
    cursor == null ? -1 : events.findIndex((event) => event.id === cursor);
  if (cursor != null && index < 0)
    throw new Error("Curseur introuvable dans ce fil.");
  const candidates =
    input.after !== undefined
      ? events.slice(index + 1)
      : events.slice(0, input.before !== undefined ? index : undefined);
  const page =
    input.after !== undefined
      ? candidates.slice(0, limit)
      : candidates.slice(-limit);
  return {
    events: page,
    before: page[0]?.id ?? null,
    after: page.at(-1)?.id ?? null,
    hasMore: candidates.length > limit,
  };
}
