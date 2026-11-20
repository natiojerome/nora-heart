import {pageSize} from "../../../contracts/history.ts";
import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type {
  Conversation,
  ConversationRepository,
} from "../../../contracts/conversations.ts";
import type { ProjectRepository } from "../../../contracts/projects.ts";
import type {
  AssistantProfileRepository,
  AssistantSettings,
} from "../../../contracts/assistant.ts";
import type {
  MemoryRecord,
  StructuredMemoryRepository,
} from "../../../contracts/structured-memory.ts";
import type {
  ExternalToolConnection,
  ExternalToolRepository,
} from "../../../contracts/external-tools.ts";
import type {
  ChatAttachment,
  ChatAssetsRepository,
  QuickPrompt,
} from "../../../contracts/chat-assets.ts";
import type { MemoryRepository } from "../../../contracts/memory.ts";
import { all, one, run, transaction, json, type Row } from "./database.ts";

function selection(row: Row) {
  return row.selection === null
    ? null
    : json<Conversation["selection"]>(row.selection);
}
function conversation(row: Row): Conversation {
  return {
    position:{at:String(row.updated_at),id:String(row.id)},
    id: String(row.id),
    title: String(row.title),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    selection: selection(row),
    projectId: row.project_id as string | null,
    fileAccess: row.file_access as Conversation["fileAccess"],
    networkAccess: !!row.network_access,
    maxSteps: Number(row.max_steps),
    ...(row.work_status
      ? {
          work: {
            status: row.work_status as NonNullable<
              Conversation["work"]
            >["status"],
            ...(row.work_at ? { at: String(row.work_at) } : {}),
          },
        }
      : {}),
  };
}
export function conversations(db: DatabaseSync): ConversationRepository {
  function update(id: string, fn: (row: Row) => void, error: string) {
    transaction(db, () => {
      const row = one(
        db,
        "SELECT c.*,s.active_run FROM conversations c JOIN sessions s ON c.id=s.id WHERE c.id=?",
        id,
      );
      if (!row || row.active_run) throw new Error(error);
      fn(row);
    });
  }
  return {
    async create(value) {
      transaction(db, () => {
        run(db, "INSERT INTO sessions(id) VALUES(?)", value.id);
        run(
          db,
          "INSERT INTO conversations(id,title,created_at,updated_at,selection,project_id,file_access,network_access,max_steps) VALUES(?,?,?,?,?,?,?,?,?)",
          value.id,
          value.title,
          new Date(value.createdAt).toISOString(),
          new Date(value.updatedAt).toISOString(),
          JSON.stringify(value.selection),
          value.projectId ?? null,
          value.fileAccess ?? "read",
          Number(value.networkAccess ?? false),
          value.maxSteps ?? 0,
        );
      });
    },
    async get(id) {
      const row = one(
        db,
        "SELECT c.*,CASE WHEN s.active_run IS NOT NULL THEN 'interrupted' END work_status FROM conversations c JOIN sessions s ON c.id=s.id WHERE c.id=?",
        id,
      );
      return row ? conversation(row) : null;
    },
    async list(options={}) {
      const limit=pageSize(options.limit,100);
      return all(
        db,
        `SELECT c.*,CASE WHEN s.active_run IS NOT NULL THEN 'interrupted' WHEN e.type='interaction.requested' THEN 'waiting' WHEN e.type='run.completed' THEN 'completed' WHEN e.type='run.failed' THEN CASE WHEN json_extract(e.data,'$.cancelled')=1 THEN 'cancelled' ELSE 'failed' END WHEN e.type='interaction.resolved' AND json_extract(e.data,'$.response.status')='cancelled' THEN 'cancelled' ELSE 'idle' END work_status,e.occurred_at work_at FROM conversations c JOIN sessions s ON c.id=s.id LEFT JOIN events e ON e.id=(SELECT id FROM events WHERE session_id=c.id AND type IN('run.completed','run.failed','interaction.requested','interaction.resolved') ORDER BY sequence DESC LIMIT 1) WHERE (? IS NULL OR (c.updated_at,c.id)<(?,?)) AND (? IS NULL OR (?='none' AND c.project_id IS NULL) OR c.project_id=?) AND (? IS NULL OR instr(heart_lower(c.title),heart_lower(?))>0) ORDER BY c.updated_at DESC,c.id DESC LIMIT ?`,
        options.before?.at??null,options.before?.at??null,options.before?.id??null,options.projectId??null,options.projectId??null,options.projectId??null,options.query??null,options.query??null,limit,
      ).map(conversation);
    },
    async select(id, value, expected) {
      const error =
        "Modèle du fil modifié ailleurs ou conversation occupée. Rouvre ses réglages.";
      update(
        id,
        (row) => {
          if (
            expected !== undefined &&
            !isDeepStrictEqual(selection(row), json(JSON.stringify(expected)))
          )
            throw new Error(error);
          run(
            db,
            "UPDATE conversations SET selection=?,updated_at=? WHERE id=?",
            JSON.stringify(value),
            new Date().toISOString(),
            id,
          );
        },
        error,
      );
    },
    async setFileAccess(id, value) {
      update(
        id,
        () => {
          run(
            db,
            "UPDATE conversations SET file_access=?,updated_at=? WHERE id=?",
            value,
            new Date().toISOString(),
            id,
          );
        },
        "Cette conversation travaille déjà ou est introuvable.",
      );
    },
    async setExecutionPolicy(id, network, steps) {
      update(
        id,
        () => {
          run(
            db,
            "UPDATE conversations SET network_access=?,max_steps=?,updated_at=? WHERE id=?",
            Number(network),
            steps,
            new Date().toISOString(),
            id,
          );
        },
        "Cette conversation travaille déjà ou est introuvable.",
      );
    },
  };
}
export function projects(db: DatabaseSync): ProjectRepository {
  return {
    async create(value) {
      run(
        db,
        "INSERT INTO projects(id,title) VALUES(?,?)",
        value.id,
        value.title,
      );
      return value;
    },
    async get(id) {
      const value = one(db, "SELECT id,title FROM projects WHERE id=?", id);
      return value
        ? { id: String(value.id), title: String(value.title) }
        : null;
    },
    async list() {
      return all(
        db,
        "SELECT id,title FROM projects ORDER BY title,id LIMIT 200",
      ).map((row) => ({ id: String(row.id), title: String(row.title) }));
    },
  };
}
function memory(row: Row): MemoryRecord {
  return {
    id: String(row.id),
    title: String(row.title),
    content: String(row.content),
    kind: row.kind as MemoryRecord["kind"],
    scope: row.scope as MemoryRecord["scope"],
    projectId: row.project_id as string | null,
    status: row.status as MemoryRecord["status"],
    version: Number(row.version),
    source: json(row.source),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
export function structuredMemories(
  db: DatabaseSync,
): StructuredMemoryRepository {
  function revision(record: MemoryRecord) {
    run(
      db,
      "INSERT INTO memory_revisions(memory_id,version,snapshot) VALUES(?,?,?) ON CONFLICT DO NOTHING",
      record.id,
      record.version,
      JSON.stringify(record),
    );
  }
  return {
    async create(value) {
      return transaction(db, () => {
        const row = one(
          db,
          `INSERT INTO memories(id,title,content,content_hash,kind,scope,project_id,status,version,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(scope,coalesce(project_id,'00000000-0000-0000-0000-000000000000'),content_hash) WHERE status='active' DO UPDATE SET content=memories.content RETURNING *`,
          value.id,
          value.title,
          value.content,
          createHash("sha256").update(value.content).digest("hex"),
          value.kind,
          value.scope,
          value.projectId,
          value.status,
          value.version,
          JSON.stringify(value.source),
          new Date(value.createdAt).toISOString(),
          new Date(value.updatedAt).toISOString(),
        )!;
        const record = memory(row);
        if (record.content !== value.content)
          throw new Error(
            "Collision de contenu mémoire : enregistrement refusé.",
          );
        revision(record);
        return record;
      });
    },
    async get(id) {
      const row = one(db, "SELECT * FROM memories WHERE id=?", id);
      return row ? memory(row) : null;
    },
    async list(filter) {
      const terms = filter.terms;
      const scope =
        filter.projectId === undefined
          ? "1"
          : "(scope='personal' OR project_id=?)";
      const search = terms?.length
        ? "(" +
          terms
            .map(() => "instr(heart_lower(title||' '||content),?)>0")
            .join(" OR ") +
          ")"
        : terms
          ? "0"
          : "1";
      return all(
        db,
        `SELECT * FROM memories WHERE (? OR status='active') AND ${scope} AND ${search} ORDER BY updated_at DESC,id LIMIT ?`,
        Number(!!filter.includeForgotten),
        ...(filter.projectId === undefined ? [] : [filter.projectId ?? null]),
        ...(terms ?? []),
        filter.limit===0?-1:filter.limit,
      ).map(memory);
    },
    async replace(value, expected) {
      try {
        return transaction(db, () => {
          const row = one(
            db,
            "UPDATE memories SET title=?,content=?,content_hash=?,kind=?,scope=?,project_id=?,status=?,version=version+1,source=?,updated_at=? WHERE id=? AND version=? RETURNING *",
            value.title,
            value.content,
            createHash("sha256").update(value.content).digest("hex"),
            value.kind,
            value.scope,
            value.projectId,
            value.status,
            JSON.stringify(value.source),
            new Date(value.updatedAt).toISOString(),
            value.id,
            expected,
          );
          if (!row)
            throw new Error(
              "Souvenir modifié depuis sa lecture. Actualiser avant de réessayer.",
            );
          const record = memory(row);
          revision(record);
          return record;
        });
      } catch (error) {
        if (
          String((error as Error).message).includes("UNIQUE constraint failed")
        )
          throw new Error(
            "Un souvenir actif identique existe déjà dans cette portée.",
          );
        throw error;
      }
    },
    async revisions(id) {
      return all(
        db,
        "SELECT snapshot FROM memory_revisions WHERE memory_id=? ORDER BY version",
        id,
      ).map((row) => json<MemoryRecord>(row.snapshot));
    },
  };
}
export function memories(
  db: DatabaseSync,
  structured: StructuredMemoryRepository,
): MemoryRepository {
  return {
    async save(value) {
      const at = new Date().toISOString(),
        record = await structured.create({
          ...value,
          title: value.content.slice(0, 160),
          kind: "fact",
          scope: "personal",
          projectId: null,
          status: "active",
          version: 1,
          source: { type: "legacy" },
          createdAt: at,
          updatedAt: at,
        });
      return { id: record.id, content: record.content };
    },
    async find(terms, limit) {
      return all(
        db,
        "SELECT id,content FROM memories WHERE status='active' AND scope='personal'" +
          (terms.length
            ? " AND " +
              terms
                .map(() => "instr(heart_lower(content),heart_lower(?))>0")
                .join(" AND ")
            : "") +
          " ORDER BY sequence DESC LIMIT ?",
        ...terms,
        limit,
      )
        .reverse()
        .map((row) => ({ id: String(row.id), content: String(row.content) }));
    },
  };
}
export function assistant(db: DatabaseSync): AssistantProfileRepository {
  return {
    async get() {
      const row = one(
        db,
        "SELECT settings,version FROM assistant_profile WHERE singleton=1",
      );
      return row
        ? {
            settings: json<AssistantSettings>(row.settings),
            version: Number(row.version),
          }
        : null;
    },
    async save(settings, expected) {
      const row =
        expected === 0
          ? one(
              db,
              "INSERT INTO assistant_profile(singleton,settings,version) VALUES(1,?,1) ON CONFLICT DO NOTHING RETURNING settings,version",
              JSON.stringify(settings),
            )
          : one(
              db,
              "UPDATE assistant_profile SET settings=?,version=version+1 WHERE singleton=1 AND version=? RETURNING settings,version",
              JSON.stringify(settings),
              expected,
            );
      if (!row)
        throw new Error(
          "Profil modifié ailleurs. Actualise avant de réessayer.",
        );
      return {
        settings: json<AssistantSettings>(row.settings),
        version: Number(row.version),
      };
    },
  };
}
export function externalTools(db: DatabaseSync): ExternalToolRepository {
  return {
    async list() {
      return all(db, "SELECT config FROM external_tools ORDER BY id").map(
        (row) => json<ExternalToolConnection>(row.config),
      );
    },
    async get(id) {
      const row = one(db, "SELECT config FROM external_tools WHERE id=?", id);
      return row ? json<ExternalToolConnection>(row.config) : null;
    },
    async save(value, expected) {
      const next = { ...value, version: expected + 1 },
        row =
          expected === 0
            ? one(
                db,
                "INSERT INTO external_tools(id,version,config) VALUES(?,?,?) ON CONFLICT DO NOTHING RETURNING config",
                next.id,
                next.version,
                JSON.stringify(next),
              )
            : one(
                db,
                "UPDATE external_tools SET version=?,config=? WHERE id=? AND version=? RETURNING config",
                next.version,
                JSON.stringify(next),
                next.id,
                expected,
              );
      if (!row)
        throw new Error(
          "MCP : connexion modifiée ailleurs. Actualise avant de réessayer.",
        );
      return json<ExternalToolConnection>(row.config);
    },
  };
}
export function chatAssets(db: DatabaseSync): ChatAssetsRepository {
  return {
    async prompts() {
      return all(
        db,
        "SELECT data FROM quick_prompts ORDER BY json_extract(data,'$.title'),id LIMIT 100",
      ).map((row) => json<QuickPrompt>(row.data));
    },
    async savePrompt(value, expected) {
      const count =
        expected === 0
          ? run(
              db,
              "INSERT INTO quick_prompts(id,data,version) SELECT ?,?,1 WHERE(SELECT count(*) FROM quick_prompts)<100 ON CONFLICT DO NOTHING",
              value.id,
              JSON.stringify(value),
            )
          : run(
              db,
              "UPDATE quick_prompts SET data=?,version=version+1 WHERE id=? AND version=?",
              JSON.stringify(value),
              value.id,
              expected,
            );
      if (!count)
        throw new Error(
          "Prompt modifié ailleurs ou limite de 100 prompts atteinte. Actualise la liste.",
        );
      return json<QuickPrompt>(JSON.stringify(value));
    },
    async deletePrompt(id, version) {
      if (
        !run(
          db,
          "DELETE FROM quick_prompts WHERE id=? AND version=?",
          id,
          version,
        )
      )
        throw new Error("Prompt modifié ailleurs. Actualise la liste.");
    },
    async attachments(id) {
      return all(
        db,
        "SELECT metadata,used FROM chat_attachments WHERE conversation_id=? ORDER BY json_extract(metadata,'$.createdAt'),id",
        id,
      ).map((row) => ({
        ...json<ChatAttachment>(row.metadata),
        used: !!row.used,
      }));
    },
    async attachment(conversationId, id) {
      const row = one(
        db,
        "SELECT metadata,data,used FROM chat_attachments WHERE conversation_id=? AND id=?",
        conversationId,
        id,
      );
      return row
        ? {
            file: { ...json<ChatAttachment>(row.metadata), used: !!row.used },
            bytes: row.data as Uint8Array,
          }
        : null;
    },
    async putAttachment(value, bytes) {
      run(
        db,
        "INSERT INTO chat_attachments(id,conversation_id,metadata,data) VALUES(?,?,?,?)",
        value.id,
        value.conversationId,
        JSON.stringify(value),
        bytes,
      );
    },
    async claimAttachments(conversationId, ids) {
      if (!ids.length) return;
      transaction(db, () => {
        if (
          new Set(ids).size !== ids.length ||
          ids.some(
            (id) =>
              !one(
                db,
                "SELECT 1 FROM chat_attachments WHERE conversation_id=? AND id=?",
                conversationId,
                id,
              ),
          )
        )
          throw new Error(
            "Une pièce jointe est introuvable. Actualise la liste.",
          );
        for (const id of ids)
          run(
            db,
            "UPDATE chat_attachments SET used=1 WHERE conversation_id=? AND id=?",
            conversationId,
            id,
          );
      });
    },
    async deleteAttachment(conversationId, id) {
      if (
        !run(
          db,
          "DELETE FROM chat_attachments WHERE conversation_id=? AND id=? AND used=0",
          conversationId,
          id,
        )
      )
        throw new Error(
          "Fichier déjà utilisé ou introuvable. Son historique est conservé.",
        );
    },
  };
}
