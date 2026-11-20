import { lookup } from "node:dns";
import type { LookupFunction } from "node:net";
import { isIP } from "node:net";
import { Agent, fetch as requestPage } from "undici";
import ipaddr from "ipaddr.js";
import { loadBuffer } from "cheerio";
import type { Tool } from "../../../contracts/tools.ts";
import type { Json } from "../../../contracts/json.ts";

export function isPublicAddress(address: string): boolean {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}
export function publicPageUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Adresse de page invalide.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (isIP(host) && !isPublicAddress(host)) ||
    host === "localhost" ||
    host.endsWith(".localhost")
  )
    throw new Error(
      "La lecture web concerne les pages publiques HTTP/HTTPS. Utilise les outils serveur pour une ressource privée.",
    );
  url.hash = "";
  return url;
}
/** Validate the addresses at socket lookup time, including after redirects. */
const lookupPublic: LookupFunction = (host, options, callback) => {
  lookup(host, { all: true }, (error, addresses) => {
    if (error) {
      callback(error, "", 0);
      return;
    }
    if (
      !addresses.length ||
      addresses.some((item) => !isPublicAddress(item.address))
    ) {
      callback(
        new Error("Adresse réseau privée refusée pour la lecture web."),
        "",
        0,
      );
      return;
    }
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  });
};
interface PageResponse {
  body?: { cancel(): Promise<unknown> } | null;
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}
type PageFetch = (
  url: URL,
  options: { signal: AbortSignal; redirect: "manual" },
) => Promise<PageResponse>;
export function createWebSearch(options: {
  endpoint: string;
  timeoutMs: number;
  fetchBackend?: typeof fetch;
  fetchPage?: PageFetch;
}) {
  const backend = new URL(options.endpoint),
    dispatcher = new Agent({ connect: { lookup: lookupPublic } });
  const pageFetch: PageFetch =
    options.fetchPage ??
    ((url, init) => requestPage(url, { ...init, dispatcher }));
  const signal = (parent?: AbortSignal) =>
    parent
      ? AbortSignal.any([parent, AbortSignal.timeout(options.timeoutMs)])
      : AbortSignal.timeout(options.timeoutMs);
  const tool = (
    name: string,
    title: string,
    description: string,
    properties: Record<string, Json>,
    required: string[],
    execute: Tool["execute"],
  ): Tool => ({
    name,
    title,
    description,
    permission: "external.read",
    parameters: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    },
    execute,
  });
  const tools: Tool[] = [
    tool(
      "web_search",
      "Rechercher sur le web",
      "Recherche web auto-hébergée via SearXNG. Aucun abonnement, crédit ou quota commercial. Retourne tous les résultats de la page demandée et les incidents des moteurs. Utilise page pour poursuivre ; les moteurs peuvent imposer CAPTCHA, blocages ou pagination.",
      {
        query: { type: "string", minLength: 1 },
        page: { type: "integer", minimum: 1 },
        language: { type: "string" },
        engines: { type: "array", items: { type: "string" } },
        time_range: { type: "string", enum: ["day", "week", "month", "year"] },
      },
      ["query"],
      async (args, context) => {
        const input = args as Record<string, Json>;
        if (typeof input.query !== "string" || !input.query.trim())
          throw new Error("Requête de recherche requise.");
        if (
          input.page !== undefined &&
          (!Number.isSafeInteger(input.page) || Number(input.page) < 1)
        )
          throw new Error("Page de recherche invalide.");
        const url = new URL("/search", backend);
        url.searchParams.set("q", input.query);
        url.searchParams.set("format", "json");
        if (input.page !== undefined)
          url.searchParams.set("pageno", String(input.page));
        if (typeof input.language === "string")
          url.searchParams.set("language", input.language);
        if (typeof input.time_range === "string")
          url.searchParams.set("time_range", input.time_range);
        if (Array.isArray(input.engines))
          url.searchParams.set("engines", input.engines.join(","));
        const response = await (options.fetchBackend ?? fetch)(url, {
          signal: signal(context.signal),
          redirect: "error",
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error("Recherche locale indisponible. Aucun repli payant.");
        }
        const data = await response.json();
        if (!Array.isArray(data.results))
          throw new Error("Réponse de recherche locale incompatible.");
        const results = data.results.map((result: Record<string, unknown>) => ({
          title: result.title,
          url: result.url,
          snippet: result.content,
          engines: result.engines,
          ...(result.publishedDate
            ? { publishedAt: result.publishedDate }
            : {}),
        }));
        return JSON.stringify({
          query: input.query,
          page: input.page ?? 1,
          results,
          suggestions: data.suggestions ?? [],
          engineIssues: data.unresponsive_engines ?? [],
          note: "Aucun quota commercial Heart. Résultats dépendants des moteurs interrogés ; utiliser page pour poursuivre.",
        });
      },
    ),
    tool(
      "web_fetch",
      "Lire une page web",
      "Lire une page publique HTML ou texte, sans navigateur ni JavaScript. Aucun plafond de texte par défaut. max_characters facultatif limite explicitement le résultat ; truncated indique une coupe. Les sites protégés, PDF et contenus nécessitant JavaScript peuvent ne pas être lisibles.",
      {
        url: { type: "string", minLength: 1 },
        max_characters: { type: "integer", minimum: 1 },
      },
      ["url"],
      async (args, context) => {
        const input = args as Record<string, Json>;
        if (typeof input.url !== "string")
          throw new Error("Adresse de page requise.");
        if (
          input.max_characters !== undefined &&
          (!Number.isSafeInteger(input.max_characters) ||
            Number(input.max_characters) < 1)
        )
          throw new Error("Longueur de lecture invalide.");
        const requestSignal = signal(context.signal),
          seen = new Set<string>();
        let url = publicPageUrl(input.url);
        for (;;) {
          if (seen.has(url.href))
            throw new Error("Boucle de redirection sur cette page.");
          seen.add(url.href);
          const response = await pageFetch(url, {
            signal: requestSignal,
            redirect: "manual",
          });
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            const next = response.headers.get("location");
            await response.body?.cancel();
            if (!next) throw new Error("Redirection de page invalide.");
            url = publicPageUrl(new URL(next, url).href);
            continue;
          }
          if (response.status < 200 || response.status >= 300) {
            await response.body?.cancel();
            throw new Error(
              `Lecture refusée ou indisponible (HTTP ${response.status}). Aucun contournement ou repli payant.`,
            );
          }
          const type = response.headers.get("content-type") ?? "";
          if (!/^text\/|^application\/(json|xml|xhtml\+xml)/i.test(type)) {
            await response.body?.cancel();
            throw new Error(
              "Ce format nécessite un outil de lecture adapté ; seules les pages HTML et texte sont lues ici.",
            );
          }
          const bytes = Buffer.from(await response.arrayBuffer());
          let title = "",
            content = "";
          if (/html/i.test(type)) {
            const $ = loadBuffer(bytes);
            title = $("title").first().text().trim();
            $("script,style,noscript,nav,footer,form,aside,svg").remove();
            $("a[href]").each((_i, element) => {
              const link = $(element);
              try {
                const target = new URL(link.attr("href")!, url);
                if (
                  ["http:", "https:"].includes(target.protocol) &&
                  link.text().trim()
                )
                  link.text(`[${link.text().trim()}](${target.href})`);
              } catch {}
            });
            let main = $("main").first();
            if (!main.length) main = $("article").first();
            if (!main.length) main = $("body");
            main.find("h1,h2,h3,h4,p,div,li,tr,pre,br").each((_i, element) => {
              $(element).prepend("\n").append("\n");
            });
            content = main
              .text()
              .replace(/[ \t]+\n/g, "\n")
              .replace(/\n{3,}/g, "\n\n")
              .trim();
          } else content = bytes.toString("utf8");
          if (!content.trim())
            throw new Error(
              "Aucun texte lisible sans JavaScript sur cette page.",
            );
          const totalCharacters = content.length;
          if (typeof input.max_characters === "number")
            content = content.slice(0, input.max_characters);
          return JSON.stringify({
            url: url.href,
            title,
            content,
            totalCharacters,
            truncated: content.length < totalCharacters,
            javascriptExecuted: false,
          });
        }
      },
    ),
  ];
  return { tools, close: () => dispatcher.close() };
}
