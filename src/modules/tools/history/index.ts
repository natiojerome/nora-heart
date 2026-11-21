import type { SessionStore } from "../../../contracts/storage.ts";
import type { Tool } from "../../../contracts/tools.ts";
import { eventPage } from "../../../contracts/history.ts";

/** Read the bound thread only; persisted private tool payloads remain redacted by the original journal. */
export function historyTools(
  sessions: SessionStore,
  sessionId: string,
): Tool[] {
  return [
    {
      name: "history.read",
      permission: "history.read",
      transient: true,
      description:
        "Relire les messages originaux de CE fil après compression. before remonte ; query cherche les mots-clés dans les pages antérieures. Poursuivre si hasMore. includeTools relit aussi les anciens outils. Aucun état courant certifié.",
      parameters: {
        type: "object",
        properties: {
          before: { type: "string" },
          limit: { type: "integer", minimum: 1 },
          query: { type: "string" },
          includeTools: { type: "boolean" },
        },
        additionalProperties: false,
      },
      async execute(input, context) {
        context.signal?.throwIfAborted();
        if (!input || typeof input !== "object" || Array.isArray(input))
          throw Error("Lecture historique invalide.");
        const { before, limit, query, includeTools } = input;
        if (
          (before !== undefined && typeof before !== "string") ||
          (limit !== undefined &&
            (typeof limit !== "number" ||
              !Number.isSafeInteger(limit) ||
              limit < 1)) ||
          (query !== undefined && typeof query !== "string") ||
          (includeTools !== undefined && typeof includeTools !== "boolean")
        )
          throw Error("Lecture historique invalide.");
        const window = { before: before || undefined, limit: limit ?? 20 };
        const snapshot = sessions.page
            ? undefined
            : await sessions.read(sessionId),
          seen = new Set<string>();
        const normalize = (value: string) =>
          value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase();
        const terms = normalize(query ?? "").match(/[\p{L}\p{N}_-]+/gu) ?? [];
        for (;;) {
          context.signal?.throwIfAborted();
          const page = sessions.page
            ? await sessions.page(sessionId, window)
            : eventPage(snapshot!, window);
          context.signal?.throwIfAborted();
          const messages = page.events.flatMap((event) => {
            const data = event.data;
            if (
              (context.runId !== undefined && event.runId === context.runId) ||
              event.type !== "message" ||
              !data ||
              typeof data !== "object" ||
              Array.isArray(data) ||
              ![
                "user",
                "assistant",
                ...(includeTools ? ["tool"] : []),
              ].includes(String(data.role))
            )
              return [];
            if (
              !includeTools &&
              (typeof data.content !== "string" || !data.content.trim())
            )
              return [];
            const text = normalize(
              includeTools ? JSON.stringify(data) : String(data.content),
            );
            if (!terms.every((term) => text.includes(term))) return [];
            return [
              {
                id: event.id,
                at: event.at,
                ...(includeTools
                  ? { message: data }
                  : { role: data.role, content: data.content }),
              },
            ];
          });
          if (messages.length || !page.hasMore)
            return JSON.stringify({
              historical: true,
              currentStateVerified: false,
              before: page.before,
              hasMore: page.hasMore,
              ...(page.hasMore
                ? {
                    continuation: {
                      tool: "history.read",
                      arguments: {
                        before: page.before,
                        limit: window.limit,
                        ...(query ? { query } : {}),
                        ...(includeTools ? { includeTools: true } : {}),
                      },
                    },
                  }
                : {}),
              messages,
            });
          if (!page.before || seen.has(page.before))
            throw Error("Pagination historique incohérente.");
          seen.add(page.before);
          window.before = page.before;
        }
      },
    },
  ];
}
