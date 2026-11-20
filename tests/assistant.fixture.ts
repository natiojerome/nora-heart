import { Assistant } from "../src/app/assistant.ts";
import type {
  AssistantProfile,
  AssistantProfileRepository,
} from "../src/contracts/assistant.ts";
export function assistantFixture() {
  let value: AssistantProfile | null = null;
  const repository: AssistantProfileRepository = {
    async get() {
      return value ? structuredClone(value) : null;
    },
    async save(settings, version) {
      if ((value?.version ?? 0) !== version)
        throw new Error(
          "Profil modifié ailleurs. Actualise avant de réessayer.",
        );
      value = { settings: structuredClone(settings), version: version + 1 };
      return structuredClone(value);
    },
  };
  return new Assistant(repository);
}
