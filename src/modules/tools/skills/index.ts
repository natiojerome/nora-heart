import type { SkillReader, SkillSummary } from "../../../contracts/skills.ts";
import type { Tool } from "../../../contracts/tools.ts";
import type { Json } from "../../../contracts/json.ts";
export function skillTools(
  reader: SkillReader,
  skills: SkillSummary[],
): Tool[] {
  if (!skills.length) return [];
  const properties = { id: { type: "string", enum: skills.map((s) => s.id) } };
  const tool = (
    name: string,
    description: string,
    resource: boolean,
  ): Tool => ({
    name,
    title: resource ? "Lire une référence de skill" : "Charger un skill",
    permission: "skills.read",
    description,
    parameters: {
      type: "object",
      properties: {
        ...properties,
        ...(resource ? { path: { type: "string" } } : {}),
      },
      required: resource ? ["id", "path"] : ["id"],
      additionalProperties: false,
    },
    async execute(args: Json) {
      const value = args as Record<string, Json>,
        skill = skills.find((s) => s.id === value.id);
      if (!skill) throw new Error("Skill indisponible.");
      return JSON.stringify(
        resource
          ? await reader.read(skill.id, skill.revision, value.path as string)
          : await reader.load(skill.id, skill.revision),
      );
    },
  });
  return [
    tool(
      "skills.load",
      "Lire les instructions complètes d’un skill activé avant de l’utiliser. Le catalogue fournit son identifiant. Aucun droit supplémentaire.",
      false,
    ),
    tool(
      "skills.read",
      "Lire une ressource relative du skill activé. Aucun script exécuté ; utiliser les outils ordinaires et leurs permissions pour toute action.",
      true,
    ),
  ];
}
