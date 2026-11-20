import { randomUUID } from "node:crypto";
import type { ModelProvider, ModelRequest, ModelResponse } from "../../../contracts/models.ts";

// A deterministic test double, not a language model or a provider integration.
export class DemoProvider implements ModelProvider {
  id = "local-demo";
  async generate(request: ModelRequest): Promise<ModelResponse> {
    const last = request.messages.at(-1);
    if (last?.role === "tool") return { content: `Résultat de ${last.name} : ${last.content}`, toolCalls: [] };
    return { content: "Je consulte les fichiers du workspace.", toolCalls: [{ id: randomUUID(), name: "files.list", arguments: {} }] };
  }
}
