export interface AttachmentRef {
  id: string;
  name: string;
  mediaType: string;
  size: number;
  // Resolved only at the model boundary, never persisted in the event journal.
  data?: string;
}
export interface ChatAttachment extends Omit<AttachmentRef, "data"> {
  conversationId: string;
  createdAt: string;
  used: boolean;
}
export interface QuickPrompt {
  id: string;
  title: string;
  description: string;
  content: string;
  context: "all" | "general" | "project";
  version: number;
  updatedAt: string;
}
export interface ChatAssetsRepository {
  prompts(): Promise<QuickPrompt[]>;
  savePrompt(value: QuickPrompt, expectedVersion: number): Promise<QuickPrompt>;
  deletePrompt(id: string, expectedVersion: number): Promise<void>;
  attachments(conversationId: string): Promise<ChatAttachment[]>;
  attachment(
    conversationId: string,
    id: string,
  ): Promise<{ file: ChatAttachment; bytes: Uint8Array } | null>;
  putAttachment(value: ChatAttachment, bytes: Uint8Array): Promise<void>;
  claimAttachments(conversationId: string, ids: string[]): Promise<void>;
  deleteAttachment(conversationId: string, id: string): Promise<void>;
}
