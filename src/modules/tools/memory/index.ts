import type { Json } from "../../../contracts/json.ts";
import type { MemoryService } from "../../../contracts/memory.ts";
import type { Tool } from "../../../contracts/tools.ts";

function textArgument(args: Json, key: string): string {
  if (!args || typeof args !== "object" || Array.isArray(args) || typeof args[key] !== "string") {
    throw new Error(`Argument ${key} manquant ou invalide.`);
  }
  return args[key];
}

function schema(properties: Record<string, Json>, required: string[]): Record<string, Json> {
  return { type: "object", properties, required, additionalProperties: false };
}

export function memoryTools(memory: MemoryService): Tool[] {
  return [
    {
      name: "memory.remember", permission: "memory.write", description: "Conserver un fait durable, hors secrets.",
      parameters: schema({ content: { type: "string" } }, ["content"]),
      async execute(args) { return JSON.stringify(await memory.remember(textArgument(args, "content"))); },
    },
    {
      name: "memory.search", permission: "memory.read", description: "Rechercher des souvenirs par mots (recherche textuelle explicite).",
      parameters: schema({ query: { type: "string" } }, ["query"]),
      async execute(args) { return JSON.stringify(await memory.search(textArgument(args, "query"))); },
    },
  ];
}
