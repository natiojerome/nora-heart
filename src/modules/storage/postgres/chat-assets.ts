import type { Pool } from "pg";
import type {
  ChatAttachment,
  ChatAssetsRepository,
  QuickPrompt,
} from "../../../contracts/chat-assets.ts";

export class PostgresChatAssets implements ChatAssetsRepository {
  constructor(private readonly pool: Pool) {}
  async prompts() {
    return (
      await this.pool.query<{ data: QuickPrompt }>(
        "SELECT data FROM harness.quick_prompts ORDER BY data->>'title',id LIMIT 100",
      )
    ).rows.map((row) => row.data);
  }
  async savePrompt(value: QuickPrompt, expectedVersion: number) {
    const result =
      expectedVersion === 0
        ? await this.pool.query(
            "INSERT INTO harness.quick_prompts (id,data,version) SELECT $1,$2::jsonb,1 WHERE (SELECT count(*) FROM harness.quick_prompts)<100 ON CONFLICT DO NOTHING RETURNING id",
            [value.id, JSON.stringify(value)],
          )
        : await this.pool.query(
            "UPDATE harness.quick_prompts SET data=$3::jsonb,version=version+1 WHERE id=$1 AND version=$2 RETURNING id",
            [value.id, expectedVersion, JSON.stringify(value)],
          );
    if (!result.rowCount)
      throw new Error(
        "Prompt modifié ailleurs ou limite de 100 prompts atteinte. Actualise la liste.",
      );
    return value;
  }
  async deletePrompt(id: string, version: number) {
    const result = await this.pool.query(
      "DELETE FROM harness.quick_prompts WHERE id=$1 AND version=$2 RETURNING id",
      [id, version],
    );
    if (!result.rowCount)
      throw new Error("Prompt modifié ailleurs. Actualise la liste.");
  }
  async attachments(conversationId: string) {
    return (
      await this.pool.query<{ metadata: ChatAttachment; used: boolean }>(
        "SELECT metadata,used FROM harness.chat_attachments WHERE conversation_id=$1 ORDER BY metadata->>'createdAt',id",
        [conversationId],
      )
    ).rows.map((row) => ({ ...row.metadata, used: row.used }));
  }
  async attachment(conversationId: string, id: string) {
    const row = (
      await this.pool.query<{
        metadata: ChatAttachment;
        data: Buffer;
        used: boolean;
      }>(
        "SELECT metadata,data,used FROM harness.chat_attachments WHERE conversation_id=$1 AND id=$2",
        [conversationId, id],
      )
    ).rows[0];
    return row
      ? { file: { ...row.metadata, used: row.used }, bytes: row.data }
      : null;
  }
  async putAttachment(value: ChatAttachment, bytes: Uint8Array) {
    await this.pool.query(
      "INSERT INTO harness.chat_attachments (id,conversation_id,metadata,data) VALUES ($1,$2,$3::jsonb,$4)",
      [
        value.id,
        value.conversationId,
        JSON.stringify(value),
        Buffer.from(bytes),
      ],
    );
  }
  async claimAttachments(conversationId: string, ids: string[]) {
    if (!ids.length) return;
    // One statement is atomic: a pending delete cannot remove a claimed file.
    const result = await this.pool.query(
      "WITH selected AS MATERIALIZED (SELECT id FROM harness.chat_attachments WHERE conversation_id=$1 AND id=ANY($2::uuid[]) FOR UPDATE) UPDATE harness.chat_attachments SET used=true WHERE id IN (SELECT id FROM selected) AND (SELECT count(*) FROM selected)=cardinality($2::uuid[]) RETURNING id",
      [conversationId, ids],
    );
    if (result.rowCount !== ids.length)
      throw new Error("Une pièce jointe est introuvable. Actualise la liste.");
  }
  async deleteAttachment(conversationId: string, id: string) {
    const result = await this.pool.query(
      "DELETE FROM harness.chat_attachments WHERE conversation_id=$1 AND id=$2 AND used=false RETURNING id",
      [conversationId, id],
    );
    if (!result.rowCount)
      throw new Error(
        "Fichier déjà utilisé ou introuvable. Son historique est conservé.",
      );
  }
}
