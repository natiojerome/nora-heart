import type { Json } from "../../../contracts/json.ts";
import type { StructuredMemoryService, MemoryInput } from "../../../contracts/structured-memory.ts";
import type { Tool } from "../../../contracts/tools.ts";

export function structuredMemoryTools(memory: StructuredMemoryService, projectId: string | null): Tool[] {
  const input = (args: Json): Record<string, Json> => {
    if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error("Arguments mémoire invalides.");
    return args;
  };
  const fields: Record<string, Json> = { title: { type: "string", maxLength: 160 }, content: { type: "string", maxLength: 4000 },
    kind: { type: "string", enum: ["fact", "preference", "constraint", "decision"] }, scope: { type: "string", enum: projectId ? ["personal", "project"] : ["personal"] } };
  const record = (args: Record<string, Json>): MemoryInput => ({ title: args.title as string, content: args.content as string,
    kind: args.kind as MemoryInput["kind"], scope: args.scope as MemoryInput["scope"], projectId: args.scope === "project" ? projectId : null });
  const schema = (properties: Record<string, Json>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
  const reference = { id: { type: "string" }, version: { type: "integer", minimum: 1 } };
  const action = (name: string, permission: Tool["permission"], description: string, properties: Record<string, Json>, execute: (args: Record<string, Json>) => Promise<unknown>): Tool => ({
    name, permission, description, parameters: schema(properties), async execute(args) { return JSON.stringify(await execute(input(args))); },
  });
  return [
    action("memory.remember", "memory.write", "Retenir spontanément un fait utile déclaré (métier, proche, préférence, contrainte), selon la politique mémoire. Vérifier les doublons ; personal pour les faits généraux, project pour le projet.", fields,
      args => memory.rememberRecord(record(args))),
    action("memory.search", "memory.read", "Chercher les souvenirs actifs personnels et du projet. query vide = liste accessible selon les limites choisies ; memory.get fournit le détail.", { query: { type: "string" } }, async args => (await memory.search(args.query as string)).map(record => ({
        id: record.id, title: record.title, kind: record.kind, scope: record.scope, projectId: record.projectId, version: record.version,
        ...(record.content.length <= 700 ? { content: record.content } : { detailsAvailable: true }),
      }))),
    action("memory.get", "memory.read", "Lire un souvenir actif avec sa version avant correction ou oubli.", { id: { type: "string" } }, async args => {
      const record = await memory.get(args.id as string);
      if (record.status !== "active") throw new Error("Souvenir introuvable.");
      return record;
    }),
    action("memory.update", "memory.write", "Corriger un souvenir quand l’utilisateur précise ou change un fait durable. Lire sa version actuelle ; ne pas remplacer une modification concurrente ni réécrire un fait inchangé.", { ...reference, ...fields },
      args => memory.update(args.id as string, args.version as number, record(args))),
    action("memory.forget", "memory.write", memory.supportsRestore===false?"Oublier sur demande explicite : suppression distante du souvenir et de ses révisions actives, sans restauration via cet outil. Les anciennes sauvegardes suivent leur rétention.":"Retirer un souvenir de la mémoire active uniquement sur demande d’oubli de l’utilisateur. Historique conservé, oubli réversible.", reference,
      args => memory.setStatus(args.id as string, args.version as number, "forgotten")),
    action("memory.restore", "memory.write", "Restaurer un souvenir oublié sur demande de l’utilisateur, avec sa version actuelle.", reference,
      args => memory.setStatus(args.id as string, args.version as number, "active")),
  ].filter(tool=>memory.supportsRestore!==false||tool.name!=="memory.restore");
}
