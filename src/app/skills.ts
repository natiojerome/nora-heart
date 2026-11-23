import {
  SkillError,
  type SkillCatalog,
  type SkillSummary,
  type SkillOverrides,
  type SkillDocument,
} from "../contracts/skills.ts";
import type { ContextManager, ContextOptions } from "../contracts/context.ts";
import type { ModelRequest } from "../contracts/models.ts";
import type { Assistant } from "./assistant.ts";

export function validateSkillOverrides(value: unknown): SkillOverrides {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.entries(value).some(
      ([id, v]) =>
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          id,
        ) || typeof v !== "boolean",
    )
  )
    throw new SkillError("Réglages de skills invalides.");
  return { ...(value as SkillOverrides) };
}
export class Skills {
  constructor(
    private readonly catalog: SkillCatalog,
    private readonly assistant: Assistant,
  ) {}
  async list() {
    const [profile, items] = await Promise.all([
      this.assistant.get(),
      this.catalog.list(),
    ]);
    return {
      profile,
      version: profile.version,
      skills: items.map((s) => ({
        ...s,
        enabled:
          !s.problem &&
          (profile.settings.skillOverrides?.[s.id] ?? s.defaultEnabled),
      })),
    };
  }
  async get(id: string) {
    const items = await this.catalog.list(),
      skill = items.find((s) => s.id === id);
    if (!skill || skill.problem)
      throw new SkillError(skill?.problem ?? "Skill introuvable.");
    return this.catalog.load(id, skill.revision);
  }
  async set(body: Record<string, unknown>) {
    const items = await this.catalog.list(),
      skill = items.find((s) => s.id === body.id);
    if (!skill || skill.problem)
      throw new SkillError(skill?.problem ?? "Skill introuvable.");
    if (body.revision !== skill.revision)
      throw new SkillError(
        "Skill modifié. Recharge le catalogue avant de continuer.",
      );
    await this.assistant.saveSkill(body, skill.defaultEnabled);
    return this.list();
  }
  async capture(overrides: SkillOverrides = {}) {
    const known = await this.catalog.list();
    return new SkillRun(
      this.catalog,
      known.filter((s) => !s.problem && (overrides[s.id] ?? s.defaultEnabled)),
      known,
    );
  }
}
/** Per-run guidance, fed by the ordinary tool journal; no second persistent conversation. */
export class SkillRun {
  private loaded = new Map<string, SkillDocument>();
  constructor(
    private readonly catalog: SkillCatalog,
    readonly entries: SkillSummary[],
    private readonly known: SkillSummary[] = entries,
  ) {}
  private require(id: string, revision: string) {
    if (!this.entries.some((s) => s.id === id && s.revision === revision))
      throw new SkillError("Skill désactivé ou indisponible.");
  }
  async load(id: string, revision: string) {
    this.require(id, revision);
    const value = await this.catalog.load(id, revision);
    this.loaded.set(id, value);
    return value;
  }
  async read(id: string, revision: string, path: string) {
    this.require(id, revision);
    return this.catalog.read(id, revision, path);
  }
  async explicit(prompt: string) {
    const names = [...prompt.matchAll(/(?:^|\s)\$([\p{L}\p{N}-]+)/gu)].map(
      (m) => m[1],
    );
    for (const name of new Set(names)) {
      // $PATH, amounts and ordinary shell examples are not skill invocations.
      if (!this.known.some((s) => s.name === name || s.id === name)) continue;
      const matches = this.entries.filter(
        (s) => s.name === name || s.id === name,
      );
      if (matches.length !== 1)
        throw new SkillError(
          matches.length
            ? "Nom de skill ambigu. Utilise son identifiant."
            : "Skill demandé désactivé ou introuvable.",
        );
      const skill = matches[0];
      await this.load(skill.id, skill.revision);
    }
  }
  instructions(supportsTools = true) {
    if (!this.entries.length) return "";
    return (
      "\nSkills actuellement activés (remplacent les anciens catalogues ; aucun droit supplémentaire). " +
      (supportsTools
        ? "Seulement si le besoin correspond à sa description, appeler skills.load avant de suivre le skill ; références via skills.read. Un sujet voisin ne suffit pas."
        : "Ce modèle ne possède pas d’outils : demander une invocation explicite $nom si le skill nécessaire n’est pas chargé.") +
      " Les anciens skills désactivés ne sont plus des consignes actives.\n" +
      JSON.stringify(
        this.entries.map(({ id, name, description }) => ({
          id,
          name,
          description,
        })),
      )
    );
  }
  context(inner: ContextManager): ContextManager {
    return { prepare: (options) => this.prepare(inner, options) };
  }
  private async prepare(
    inner: ContextManager,
    options: ContextOptions,
  ): Promise<ModelRequest> {
    // Explicit invocations live in the canonical user history, including covered segments.
    for (const message of options.request.messages)
      if (message.role === "user") {
        for (const match of message.content.matchAll(
          /(?:^|\s)\$([\p{L}\p{N}-]+)/gu,
        )) {
          const matches = this.entries.filter(
            (s) => s.name === match[1] || s.id === match[1],
          );
          if (matches.length === 1 && !this.loaded.has(matches[0].id))
            await this.load(matches[0].id, matches[0].revision);
        }
      }
    const loaded = new Map(this.loaded);
    const project = (message: import("../contracts/messages.ts").Message) => {
      if (
        message.role !== "tool" ||
        message.error ||
        message.name !== "skills.load"
      )
        return message;
      let data: SkillDocument;
      try {
        data = JSON.parse(message.content);
      } catch {
        return message;
      }
      if (
        !data ||
        typeof data.id !== "string" ||
        typeof data.instructions !== "string"
      )
        return message;
      const active = this.entries.some(
        (s) => s.id === data.id && s.revision === data.revision,
      );
      if (active && !loaded.has(data.id)) loaded.set(data.id, data);
      // Preserve the canonical event, but send only one copy of each instruction body.
      return {
        ...message,
        content: JSON.stringify({
          id: data.id,
          name: data.name,
          revision: data.revision,
          loaded: active,
          notice: active
            ? "Instructions actives jointes au contexte."
            : "Anciennes instructions inactives.",
        }),
      };
    };
    const messages = options.request.messages.map(project);
    const summaryMessages = options.summaryMessages?.map(project);
    const guidance = [...loaded.values()]
      .map(
        (s) =>
          "\nSkill actif " +
          JSON.stringify({ id: s.id, name: s.name, revision: s.revision }) +
          " (ne modifie pas les droits ni la demande) :\n" +
          s.instructions,
      )
      .join("");
    return inner.prepare({
      ...options,
      ...(summaryMessages ? { summaryMessages } : {}),
      request: {
        ...options.request,
        messages,
        instructions: options.request.instructions + guidance,
      },
    });
  }
}
