import type {
  ChatAssetsRepository,
  ChatAttachment,
  QuickPrompt,
} from "../src/contracts/chat-assets.ts";
import { ChatAssets } from "../src/app/chat-assets.ts";
export function chatAssetsFixture() {
  const prompts = new Map<string, QuickPrompt>();
  const files = new Map<string, { file: ChatAttachment; bytes: Uint8Array }>();
  const repository: ChatAssetsRepository = {
    async prompts() {
      return structuredClone([...prompts.values()]);
    },
    async savePrompt(value, expected) {
      if ((prompts.get(value.id)?.version ?? 0) !== expected)
        throw new Error("Prompt modifié ailleurs. Actualise la liste.");
      prompts.set(value.id, structuredClone(value));
      return structuredClone(value);
    },
    async deletePrompt(id, version) {
      if (prompts.get(id)?.version !== version)
        throw new Error("Prompt modifié ailleurs. Actualise la liste.");
      prompts.delete(id);
    },
    async attachments(id) {
      return structuredClone(
        [...files.values()]
          .filter((item) => item.file.conversationId === id)
          .map((item) => item.file),
      );
    },
    async attachment(id, fileId) {
      const item = files.get(fileId);
      return item?.file.conversationId === id ? structuredClone(item) : null;
    },
    async putAttachment(file, bytes) {
      files.set(file.id, structuredClone({ file, bytes }));
    },
    async claimAttachments(id, ids) {
      if (ids.some((fileId) => files.get(fileId)?.file.conversationId !== id))
        throw new Error(
          "Une pièce jointe est introuvable. Actualise la liste.",
        );
      for (const fileId of ids) files.get(fileId)!.file.used = true;
    },
    async deleteAttachment(id, fileId) {
      const item = files.get(fileId);
      if (item?.file.conversationId !== id || item.file.used)
        throw new Error(
          "Fichier déjà utilisé ou introuvable. Son historique est conservé.",
        );
      files.delete(fileId);
    },
  };
  return { assets: new ChatAssets(repository), repository };
}
