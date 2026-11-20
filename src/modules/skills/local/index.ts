import { createHash } from "node:crypto";
import { open, readFile, readdir, realpath, stat } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";
import {
  SkillError,
  type SkillCatalog,
  type SkillSummary,
  type SkillDocument,
} from "../../../contracts/skills.ts";

type Registration = { id: string; path: string; defaultEnabled?: boolean };
type Cached = {
  signature: string;
  summary: SkillSummary;
  instructions: string;
};
const uuid = (v: unknown): v is string =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const inside = (root: string, file: string) => file.startsWith(root + path.sep);
/** Explicit trusted registrations, no scan of another installation or user home. */
export class LocalSkills implements SkillCatalog {
  private cache = new Map<string, Cached>();
  constructor(private readonly manifest: string) {}
  private async registrations(): Promise<Registration[]> {
    let data: unknown;
    try {
      data = JSON.parse(await readFile(this.manifest, "utf8"));
    } catch {
      throw new SkillError("Catalogue de skills illisible.");
    }
    if (
      !Array.isArray(data) ||
      data.some(
        (r) =>
          !r ||
          !uuid(r.id) ||
          typeof r.path !== "string" ||
          !r.path.trim() ||
          (r.defaultEnabled !== undefined &&
            typeof r.defaultEnabled !== "boolean"),
      ) ||
      new Set(data.map((r) => r.id)).size !== data.length
    )
      throw new SkillError("Catalogue de skills invalide.");
    const ids = new Set(data.map((r) => r.id));
    for (const id of this.cache.keys()) if (!ids.has(id)) this.cache.delete(id);
    return data;
  }
  private directory(r: Registration) {
    return path.resolve(path.dirname(this.manifest), r.path);
  }
  private async contents(r: Registration): Promise<Cached> {
    const root = await realpath(this.directory(r)),
      file = await realpath(path.join(root, "SKILL.md"));
    if (!inside(root, file)) throw new SkillError("Ressource hors du skill.");
    const info = await stat(file, { bigint: true });
    if (!info.isFile()) throw new SkillError("Fichier de skill invalide.");
    const signature = [
        file,
        info.ino,
        info.size,
        info.mtimeNs,
        info.ctimeNs,
      ].join(":"),
      cached = this.cache.get(r.id);
    if (cached?.signature === signature)
      return {
        ...cached,
        summary: {
          ...cached.summary,
          defaultEnabled: r.defaultEnabled ?? false,
        },
      };
    const source = await readFile(file, "utf8"),
      match = source.match(
        /^\uFEFF?---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)([\s\S]*)$/,
      );
    if (!match) throw new SkillError("Frontmatter YAML manquant.");
    const yaml = parseDocument(match[1]);
    if (yaml.errors.length) throw new SkillError("Frontmatter YAML invalide.");
    let metadata: unknown;
    try {
      metadata = yaml.toJS();
    } catch {
      throw new SkillError("Frontmatter YAML invalide.");
    }
    const fields = metadata as Record<string, unknown>;
    if (
      !fields ||
      typeof fields.name !== "string" ||
      !fields.name.trim() ||
      typeof fields.description !== "string" ||
      !fields.description.trim() ||
      !match[2].trim()
    )
      throw new SkillError("Nom, description et instructions requis.");
    // Optional frontmatter is preserved in the source, never translated into permissions.
    const value = {
      signature,
      instructions: source,
      summary: {
        id: r.id,
        name: fields.name,
        ...(fields.metadata &&
        typeof fields.metadata === "object" &&
        typeof (fields.metadata as Record<string, unknown>)["display-name"] ===
          "string"
          ? {
              displayName: (fields.metadata as Record<string, string>)[
                "display-name"
              ],
            }
          : {}),
        description: fields.description,
        revision: createHash("sha256").update(source).digest("hex"),
        defaultEnabled: r.defaultEnabled ?? false,
      },
    };
    this.cache.set(r.id, value);
    return value;
  }
  async list(): Promise<SkillSummary[]> {
    const result: SkillSummary[] = [];
    for (const r of await this.registrations()) {
      try {
        result.push(structuredClone((await this.contents(r)).summary));
      } catch (e) {
        result.push({
          id: r.id,
          name: path.basename(this.directory(r)),
          description: "",
          revision: "",
          defaultEnabled: false,
          problem:
            e instanceof SkillError
              ? e.message
              : "Fichier SKILL.md inaccessible.",
        });
      }
    }
    return result;
  }
  private async current(id: string, revision: string) {
    const r = (await this.registrations()).find((r) => r.id === id);
    if (!r) throw new SkillError("Skill introuvable.");
    let content: Cached;
    try {
      content = await this.contents(r);
    } catch (e) {
      throw e instanceof SkillError
        ? e
        : new SkillError("Fichier SKILL.md inaccessible.");
    }
    if (content.summary.revision !== revision)
      throw new SkillError(
        "Skill modifié. Recharge le catalogue avant de continuer.",
      );
    return { r, content };
  }
  async load(id: string, revision: string): Promise<SkillDocument> {
    const { r, content } = await this.current(id, revision),
      root = await realpath(this.directory(r)),
      resources: string[] = [],
      pending = [""];
    while (pending.length) {
      const prefix = pending.pop()!;
      for (const item of await readdir(path.join(root, prefix), {
        withFileTypes: true,
      })) {
        if (
          item.isSymbolicLink() ||
          item.name === ".git" ||
          item.name === "node_modules"
        )
          continue;
        const relative = path.posix.join(prefix, item.name);
        if (item.isDirectory()) pending.push(relative);
        else if (item.isFile() && relative !== "SKILL.md")
          resources.push(relative);
      }
    }
    return {
      id,
      name: content.summary.name,
      revision,
      instructions: content.instructions,
      resources: resources.sort(),
    };
  }
  async read(id: string, revision: string, relative: string) {
    const { r } = await this.current(id, revision);
    if (
      typeof relative !== "string" ||
      !relative ||
      relative.includes("\0") ||
      path.isAbsolute(relative) ||
      relative.split(/[\\/]/).includes("..")
    )
      throw new SkillError("Chemin de ressource invalide.");
    const root = await realpath(this.directory(r));
    let file: string;
    try {
      file = await realpath(path.resolve(root, relative));
    } catch {
      throw new SkillError("Ressource introuvable.");
    }
    if (!inside(root, file)) throw new SkillError("Ressource hors du skill.");
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw new SkillError("Ressource non régulière.");
      const data = await handle.readFile(),
        utf8 = data.toString("utf8"),
        text = !data.includes(0) && Buffer.from(utf8).equals(data);
      return {
        id,
        path: relative,
        encoding: text ? ("utf8" as const) : ("base64" as const),
        content: text ? utf8 : data.toString("base64"),
      };
    } finally {
      await handle.close();
    }
  }
}
