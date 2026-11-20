import { randomUUID } from "node:crypto";
import type {
  AttachmentRef,
  ChatAssetsRepository,
  ChatAttachment,
  QuickPrompt,
} from "../contracts/chat-assets.ts";
import type { ModelProvider } from "../contracts/models.ts";
export class ChatInputError extends Error {}
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export class ChatAssets {
  constructor(private readonly repository: ChatAssetsRepository) {}
  prompts() {
    return this.repository.prompts();
  }
  async savePrompt(body: Record<string, unknown>) {
    const version = Number(body.version ?? 0);
    if (
      !Number.isInteger(version) ||
      version < 0 ||
      (body.id !== undefined && !uuid(body.id))
    )
      throw new ChatInputError("Version de prompt invalide.");
    const value: QuickPrompt = {
      id: typeof body.id === "string" ? body.id : randomUUID(),
      title: String(body.title ?? "").trim(),
      description: String(body.description ?? "").trim(),
      content: String(body.content ?? "").trim(),
      context: body.context as QuickPrompt["context"],
      version: version + 1,
      updatedAt: new Date().toISOString(),
    };
    if (
      !value.title ||
      value.title.length > 80 ||
      value.description.length > 160 ||
      !value.content ||
      value.content.length > 10000 ||
      !["all", "general", "project"].includes(value.context)
    )
      throw new ChatInputError("Prompt invalide : titre, contenu ou portée.");
    return this.repository.savePrompt(value, version);
  }
  async deletePrompt(id: unknown, version: unknown) {
    if (!uuid(id) || !Number.isInteger(version) || Number(version) < 1)
      throw new ChatInputError("Version de prompt invalide.");
    await this.repository.deletePrompt(id, Number(version));
  }
  attachments(conversationId: string) {
    return this.repository.attachments(conversationId);
  }
  async upload(conversationId: string, body: Record<string, unknown>) {
    const name =
      typeof body.name === "string" ? body.name.normalize("NFC").trim() : "";
    const mediaType =
      typeof body.mediaType === "string" ? body.mediaType.toLowerCase() : "";
    if (!name || name.length > 180 || /[\x00-\x1f/\\]/.test(name))
      throw new ChatInputError("Nom de fichier invalide.");
    if (
      typeof body.data !== "string" ||
      !body.data ||
      body.data.length > 12 * 1024 * 1024
    )
      throw new ChatInputError("Contenu de fichier invalide.");
    const bytes = Buffer.from(body.data, "base64");
    if (bytes.toString("base64") !== body.data)
      throw new ChatInputError("Contenu de fichier invalide.");
    if (!bytes.length || bytes.length > 8 * 1024 * 1024)
      throw new ChatInputError("Un fichier accepte au maximum 8 Mio.");
    if (mediaType === "image/png") {
      if (
        !bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      )
        throw new ChatInputError("Image PNG invalide.");
    } else if (mediaType === "image/jpeg") {
      if (bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255)
        throw new ChatInputError("Image JPEG invalide.");
    } else if (mediaType === "image/webp") {
      if (
        bytes.toString("ascii", 0, 4) !== "RIFF" ||
        bytes.toString("ascii", 8, 12) !== "WEBP"
      )
        throw new ChatInputError("Image WebP invalide.");
    } else if (mediaType === "application/pdf") {
      if (bytes.toString("ascii", 0, 5) !== "%PDF-")
        throw new ChatInputError("Document PDF invalide.");
    } else if (
      mediaType.startsWith("text/") ||
      ["application/json", "application/xml", "application/yaml"].includes(
        mediaType,
      )
    ) {
      if (bytes.length > 1024 * 1024)
        throw new ChatInputError("Un fichier texte accepte au maximum 1 Mio.");
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        if (text.includes("\0")) throw new Error();
      } catch {
        throw new ChatInputError("Fichier texte UTF-8 requis.");
      }
    } else
      throw new ChatInputError(
        "Formats acceptés : texte UTF-8, PNG, JPEG, WebP et PDF.",
      );
    const files = await this.attachments(conversationId);
    if (files.length >= 100)
      throw new ChatInputError(
        "Limite de 100 fichiers dans cette conversation.",
      );
    const file: ChatAttachment = {
      id: randomUUID(),
      conversationId,
      name,
      mediaType,
      size: bytes.length,
      createdAt: new Date().toISOString(),
      used: false,
    };
    await this.repository.putAttachment(file, bytes);
    return file;
  }
  async read(conversationId: string, id: string) {
    if (!uuid(id)) throw new ChatInputError("Fichier introuvable.");
    const item = await this.repository.attachment(conversationId, id);
    if (!item) throw new ChatInputError("Fichier introuvable.");
    return item;
  }
  async remove(conversationId: string, id: string) {
    if (!uuid(id)) throw new ChatInputError("Fichier introuvable.");
    await this.repository.deleteAttachment(conversationId, id);
  }
  async references(
    conversationId: string,
    ids: unknown,
  ): Promise<AttachmentRef[]> {
    if (ids === undefined) return [];
    if (
      !Array.isArray(ids) ||
      ids.length > 5 ||
      ids.some((id) => !uuid(id)) ||
      new Set(ids).size !== ids.length
    )
      throw new ChatInputError(
        "Un message accepte au maximum 5 pièces jointes distinctes.",
      );
    const files = await Promise.all(
      ids.map((id) => this.read(conversationId, id)),
    );
    if (files.reduce((sum, item) => sum + item.file.size, 0) > 20 * 1024 * 1024)
      throw new ChatInputError("Les pièces jointes dépassent 20 Mio.");
    return files.map(({ file }) => ({
      id: file.id,
      name: file.name,
      mediaType: file.mediaType,
      size: file.size,
    }));
  }
  claim(conversationId: string, ids: string[]) {
    return this.repository.claimAttachments(conversationId, ids);
  }
  provider(provider: ModelProvider, conversationId: string): ModelProvider {
    const cache = new Map<string, Promise<AttachmentRef>>();
    let loaded = 0;
    return {
      id: provider.id,
      supportsTools: provider.supportsTools,
      generate: async (request) => {
        const messages = await Promise.all(
          request.messages.map(async (message) => {
            if (message.role !== "user" || !message.attachments?.length)
              return message;
            const attachments = await Promise.all(
              message.attachments.map((ref) => {
                let item = cache.get(ref.id);
                if (!item) {
                  item = this.read(conversationId, ref.id).then(({ bytes }) => {
                    loaded += bytes.length;
                    if (loaded > 32 * 1024 * 1024)
                      throw new ChatInputError(
                        "Trop de fichiers dans le contexte courant (32 Mio). Choisir une nouvelle conversation.",
                      );
                    return {
                      ...ref,
                      data: Buffer.from(bytes).toString("base64"),
                    };
                  });
                  cache.set(ref.id, item);
                }
                return item;
              }),
            );
            return { ...message, attachments };
          }),
        );
        request.signal?.throwIfAborted();
        return provider.generate({ ...request, messages });
      },
    };
  }
}
