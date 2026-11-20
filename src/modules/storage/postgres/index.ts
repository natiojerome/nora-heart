import {PostgresTasks} from "./tasks.ts";
import {validateWindow} from "../../../contracts/history.ts";
import type {SqlStorageConnection} from "../../../contracts/sql-storage.ts";
import type {ExternalToolConnection,ExternalToolRepository} from '../../../contracts/external-tools.ts';
import type { FileAccess } from "../../../contracts/files.ts";
import { PostgresChatAssets } from "./chat-assets.ts";
import type { ChatAssetsRepository } from "../../../contracts/chat-assets.ts";
import type { AssistantProfile, AssistantProfileRepository, AssistantSettings } from "../../../contracts/assistant.ts";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { Client, Pool } from "pg";
import { RecoveryError } from "../../../contracts/recovery.ts";
import type { PoolClient } from "pg";
import type { Event, SessionStore, StorageConnection } from "../../../contracts/storage.ts";
import type { Conversation, ConversationRepository, ModelSelection } from "../../../contracts/conversations.ts";
import type { MemoryRecord, MemoryFilter, StructuredMemoryRepository } from "../../../contracts/structured-memory.ts";
import type { Project, ProjectRepository } from "../../../contracts/projects.ts";
import type { Memory, MemoryRepository } from "../../../contracts/memory.ts";

const migrationFiles = ["001_initial.sql", "002_conversations.sql", "003_structured_memory.sql", "004_assistant_profile.sql", "005_chat_assets.sql", "006_file_access.sql", "007_development.sql", "008_yolo.sql", "009_context_usage.sql", "010_interactions.sql", "011_run_progress.sql", "012_external_tools.sql", "013_runtime_ownership.sql", "014_tasks.sql", "015_remote_projects.sql"];
const latestVersion = migrationFiles.length;

export function createPostgresPool(connectionString: string): Pool {
  if (!connectionString) throw new Error("Connexion PostgreSQL manquante.");
  const pool = new Pool({
    connectionString,
    max: 4,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10_000,
    options: "-c statement_timeout=10000 -c lock_timeout=5000",
    application_name: "personal-harness",
  });
  // Never log connection strings or the PostgreSQL error detail (may contain data).
  pool.on("error", () => console.error("Connexion PostgreSQL inactive interrompue."));
  return pool;
}

async function transaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let destroyed = false;
  try {
    await client.query("BEGIN");
    const value = await operation(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    try { await client.query("ROLLBACK"); }
    catch { destroyed = true; client.release(true); throw error; }
    throw error;
  } finally {
    // A destroyed client must not be released twice.
    if (!destroyed) client.release();
  }
}

export async function migratePostgres(pool: Pool): Promise<void> {
  const migrations = await Promise.all(migrationFiles.map(async (file, index) => {
    const sql = await readFile(new URL(`./migrations/${file}`, import.meta.url), "utf8");
    return { version: index + 1, sql, checksum: createHash("sha256").update(sql).digest("hex") };
  }));
  await transaction(pool, async client => {
    const shared=await client.query<{ok:boolean}>("SELECT pg_try_advisory_xact_lock_shared(170210, 2) AS ok");
    if(!shared.rows[0].ok)throw new RecoveryError('Stockage en maintenance. Réessaie après la sauvegarde.');
    // Database-scoped transaction lock, independent of product name or filesystem path.
    await client.query("SELECT pg_advisory_xact_lock(170210, 1)");
    await client.query("CREATE SCHEMA IF NOT EXISTS harness");
    await client.query(`CREATE TABLE IF NOT EXISTS harness.migrations (
      version integer PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const applied = await client.query<{ version: number; checksum: string }>(
      "SELECT version, checksum FROM harness.migrations ORDER BY version"
    );
    if (applied.rows.some((row, index) => row.version !== index + 1 || row.version > latestVersion)) {
      throw new Error("Version de stockage inconnue : utiliser un runtime compatible.");
    }
    for (const migration of migrations) {
      const previous = applied.rows.find(row => row.version === migration.version);
      if (previous && previous.checksum !== migration.checksum) throw new Error("Migration appliquée modifiée : checksum incompatible.");
      if (previous) continue;
      await client.query(migration.sql);
      if (migration.version === 1) await client.query("INSERT INTO harness.instance (id) VALUES ($1)", [randomUUID()]);
      await client.query("INSERT INTO harness.migrations (version, checksum) VALUES ($1, $2)", [migration.version, migration.checksum]);
    }
  });
}

export async function postgresInstanceId(pool: Pool): Promise<string> {
  const migrations = await pool.query<{ version: number }>("SELECT version FROM harness.migrations ORDER BY version");
  if (migrations.rows.length !== latestVersion || migrations.rows.some((row, index) => row.version !== index + 1)) {
    throw new Error("Schéma PostgreSQL incompatible : vérifier les migrations.");
  }
  const result = await pool.query<{ id: string }>("SELECT id FROM harness.instance WHERE singleton = true");
  if (!result.rows[0]) throw new Error("Instance PostgreSQL non initialisée.");
  return result.rows[0].id;
}

interface EventRow {
  id: string;
  session_id: string;
  run_id: string;
  occurred_at: Date;
  type: Event["type"];
  data: Event["data"];
}

function mapEvent(row: EventRow): Event {
  return { id: row.id, at: row.occurred_at.toISOString(), runId: row.run_id, type: row.type, data: row.data };
}

function validateSessionId(id: string): void {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error("Identifiant de session invalide.");
}

export class PostgresSessions implements SessionStore {
  constructor(private readonly pool: Pool, private readonly ownerId: string | null = null) {}

  /** One dedicated connection for the runtime, independent of conversation count. */
  static async open(pool: Pool): Promise<{sessions: PostgresSessions; close:()=>Promise<void>}> {
    const ownerId = randomUUID();
    const lease = new Client(pool.options);
    let alive = true;
    lease.on('error',()=>{alive=false;});
    await lease.connect();
    try {
      const shared=await lease.query<{ok:boolean}>("SELECT pg_try_advisory_lock_shared(170210, 2) AS ok");
      if(!shared.rows[0].ok)throw new RecoveryError('Stockage en maintenance. Réessaie après la sauvegarde.');
      await lease.query("SELECT pg_advisory_lock(hashtextextended($1, 170211))",[ownerId]);
    }
    catch(error) { await lease.end(); throw error; }
    const sessions = new PostgresSessions(pool,ownerId);
    sessions.ownerAlive = () => alive;
    let closed=false;
    return {sessions,close:async()=>{if(closed)return;closed=true;alive=false;await lease.end();}};
  }
  private ownerAlive = () => true;
  async recoveryClaim(sessionId:string):Promise<string|null>{
    validateSessionId(sessionId);
    return (await this.pool.query<{active_run:string|null}>("SELECT active_run FROM harness.sessions WHERE id=$1",[sessionId])).rows[0]?.active_run??null;
  }
  async reconcile(sessionId:string,lastEventId:string|null,events:Event[]):Promise<void> {
    validateSessionId(sessionId);
    await transaction(this.pool,async client=>{
      const row=(await client.query<{active_run:string|null;runtime_owner:string|null}>("SELECT active_run,runtime_owner FROM harness.sessions WHERE id=$1 FOR UPDATE",[sessionId])).rows[0];
      const tail=(await client.query<{id:string}>("SELECT id FROM harness.events WHERE session_id=$1 ORDER BY sequence DESC LIMIT 1",[sessionId])).rows[0]?.id??null;
      if(tail!==lastEventId)throw new RecoveryError('Le fil a changé. Actualise avant de réconcilier.');
      if(row?.active_run){
        if(!row.runtime_owner)throw new RecoveryError('Ancien verrou sans propriétaire vérifiable. Intervention opérateur nécessaire.');
        const available=(await client.query<{ok:boolean}>("SELECT pg_try_advisory_xact_lock(hashtextextended($1, 170211)) AS ok",[row.runtime_owner])).rows[0].ok;
        if(!available)throw new RecoveryError('Le moteur propriétaire est encore actif. Arrête le travail depuis ce moteur.');
      }
      if(!events.length)throw new RecoveryError('Aucune interruption à réconcilier.');
      for(const event of events)await this.insert(client,sessionId,event);
      // Fencing persisted for every old run, including runs already marked failed.
      for(const runId of new Set(events.map(event=>event.runId)))await client.query("INSERT INTO harness.reconciled_runs(session_id,run_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[sessionId,runId]);
      await client.query("UPDATE harness.sessions SET active_run=NULL,runtime_owner=NULL WHERE id=$1",[sessionId]);
    });
  }
  private async insert(client:PoolClient,sessionId:string,event:Event):Promise<void>{
    const normalized:Event={...event,at:new Date(event.at).toISOString()};
    const existing=await client.query<EventRow>("SELECT * FROM harness.events WHERE id=$1",[event.id]);
    if(existing.rows[0]){
      if(existing.rows[0].session_id!==sessionId||!isDeepStrictEqual(mapEvent(existing.rows[0]),normalized))throw new Error("Identifiant d’événement réutilisé avec un contenu différent.");
      return;
    }
    const sequence=await client.query<{next_sequence:string}>("UPDATE harness.sessions SET next_sequence=next_sequence+1 WHERE id=$1 RETURNING next_sequence",[sessionId]);
    await client.query("INSERT INTO harness.events(id,session_id,sequence,run_id,occurred_at,type,data) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb)",[event.id,sessionId,sequence.rows[0].next_sequence,event.runId,normalized.at,event.type,JSON.stringify(event.data)]);
  }

  async claim(sessionId: string, runId: string): Promise<void> {
    validateSessionId(sessionId);
    if(!this.ownerAlive())throw new Error("Connexion de propriété interrompue. Redémarre le moteur.");
    await transaction(this.pool, async client => {
      await client.query("INSERT INTO harness.sessions (id) VALUES ($1) ON CONFLICT DO NOTHING", [sessionId]);
      const result = await client.query(`UPDATE harness.sessions AS s SET active_run = $2, runtime_owner = $3 WHERE s.id = $1 AND (
        s.active_run IS NULL OR EXISTS (
          SELECT 1 FROM harness.events e WHERE e.session_id=s.id AND e.run_id=s.active_run::text
          AND (e.type='interaction.requested' OR
            (e.type='interaction.resolved' AND e.data->'response'->>'status'='cancelled'))
        )
      ) RETURNING id`, [sessionId, runId, this.ownerId]);
      if (!result.rowCount) throw new Error("Cette session travaille déjà ou nécessite une réconciliation.");
    });
  }

  async release(sessionId: string, runId: string): Promise<void> {
    await this.pool.query("UPDATE harness.sessions SET active_run = NULL, runtime_owner = NULL WHERE id = $1 AND active_run = $2", [sessionId, runId]);
  }

  async read(sessionId: string): Promise<Event[]> {
    validateSessionId(sessionId);
    const result = await this.pool.query<EventRow>(
      "SELECT * FROM harness.events WHERE session_id = $1 ORDER BY sequence", [sessionId]
    );
    return result.rows.map(mapEvent);
  }

  async page(sessionId:string,input:import("../../../contracts/history.ts").EventWindow) {
    validateSessionId(sessionId);const limit=validateWindow(input),cursor=input.before??input.after;
    let sequence:string|undefined;
    if(cursor!=null){
      sequence=(await this.pool.query<{sequence:string}>("SELECT sequence FROM harness.events WHERE session_id=$1 AND id=$2",[sessionId,cursor])).rows[0]?.sequence;
      if(sequence===undefined)throw new Error('Curseur introuvable dans ce fil.');
    }
    const forward=input.after!==undefined;
    const result=await this.pool.query<EventRow>(`SELECT * FROM harness.events WHERE session_id=$1 ${sequence!==undefined?`AND sequence ${forward?'>':'<'} $3`:''} ORDER BY sequence ${forward?'ASC':'DESC'} LIMIT $2`,[sessionId,limit+1,...(sequence!==undefined?[sequence]:[])]);
    const events=result.rows.slice(0,limit).map(mapEvent);if(!forward)events.reverse();
    return {events,before:events[0]?.id??null,after:events.at(-1)?.id??null,hasMore:result.rows.length>limit};
  }

  async append(sessionId: string, event: Event): Promise<void> {
    return this.appendBatch(sessionId,[event]);
  }
  async appendBatch(sessionId: string, events: Event[]): Promise<void> {
    validateSessionId(sessionId);
    await transaction(this.pool, async client => {
      await client.query("INSERT INTO harness.sessions (id) VALUES ($1) ON CONFLICT DO NOTHING", [sessionId]);
      await client.query("SELECT id FROM harness.sessions WHERE id = $1 FOR UPDATE", [sessionId]);
      if(!this.ownerAlive())throw new RecoveryError('Connexion de propriété interrompue. Redémarre le moteur.');
      for(const event of events){
        if((await client.query("SELECT 1 FROM harness.reconciled_runs WHERE session_id=$1 AND run_id=$2",[sessionId,event.runId])).rowCount)throw new RecoveryError('Ce travail a été réconcilié. Écriture tardive refusée.');
        await this.insert(client,sessionId,event);
      }
    });
  }
}

export class PostgresMemoryRepository implements MemoryRepository {
  constructor(private readonly pool: Pool) {}

  async save(value: Memory): Promise<Memory> {
    const at = new Date().toISOString();
    const record = await new PostgresStructuredMemory(this.pool).create({ ...value,
      title: value.content.slice(0,160), kind: "fact", scope: "personal", projectId: null,
      status: "active", version: 1, source: { type: "legacy" }, createdAt: at, updatedAt: at });
    return { id: record.id, content: record.content };
  }

  async find(terms: readonly string[], limit: number): Promise<Memory[]> {
    // Literal terms, not SQL patterns or a semantic/vector search.
    const result = await this.pool.query<Memory>(`SELECT id, content FROM harness.memories
      WHERE status = 'active' AND scope = 'personal' AND NOT EXISTS (
        SELECT 1 FROM unnest($1::text[]) AS term
        WHERE strpos(lower(content), lower(term)) = 0
      ) ORDER BY sequence DESC LIMIT $2`, [terms, limit]);
    return result.rows.reverse();
  }
}

export async function openPostgresStorage(connectionString: string): Promise<SqlStorageConnection> {
  const pool = createPostgresPool(connectionString);
  try {
    const instanceId = await postgresInstanceId(pool);
    const runtime = await PostgresSessions.open(pool);
    let closed=false;
    return {
      tasks:new PostgresTasks(pool),
      externalTools: new PostgresExternalTools(pool),
      chatAssets: new PostgresChatAssets(pool),
      assistant: new PostgresAssistant(pool),
      sessions: runtime.sessions,
      conversations: new PostgresConversations(pool),
      structuredMemories: new PostgresStructuredMemory(pool),
      projects: new PostgresProjects(pool),
      memories: new PostgresMemoryRepository(pool),
      instanceId,
      close: async () => {if(closed)return;closed=true;try{await runtime.close();}finally{await pool.end();}},
    };
  } catch (cause) {
    await pool.end();
    if ((cause as { code?: string }).code === "42P01") throw new Error("Stockage non initialisé : lancer pnpm db:migrate.");
    throw cause;
  }
}

interface ConversationRow { id: string; title: string; created_at: Date; updated_at: Date; selection: ModelSelection | null; project_id: string | null; file_access: FileAccess; network_access:boolean; max_steps:number; work_status?:NonNullable<Conversation["work"]>["status"]|null; work_at?:Date|null; page_time?:string }
function conversation(row: ConversationRow): Conversation {
  return { ...(row.page_time?{position:{at:row.page_time,id:row.id}}:{}),id: row.id, title: row.title, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), selection: row.selection, projectId: row.project_id, fileAccess: row.file_access, networkAccess:row.network_access, maxSteps:row.max_steps,...(row.work_status?{work:{status:row.work_status as NonNullable<Conversation["work"]>["status"],...(row.work_at?{at:row.work_at.toISOString()}:{})}}:{}) };
}
export class PostgresConversations implements ConversationRepository {
  async setExecutionPolicy(id:string,network:boolean,maxSteps:number):Promise<void>{
    const result=await this.pool.query("UPDATE harness.conversations SET network_access=$2,max_steps=$3,updated_at=now() WHERE id=$1 AND NOT EXISTS (SELECT 1 FROM harness.sessions WHERE id=$1 AND active_run IS NOT NULL) RETURNING id",[id,network,maxSteps]);
    if(!result.rowCount)throw new Error("Cette conversation travaille déjà ou est introuvable.");
  }

  async setFileAccess(id: string, access: FileAccess): Promise<void> {
    const result=await this.pool.query("UPDATE harness.conversations SET file_access=$2,updated_at=now() WHERE id=$1 AND NOT EXISTS (SELECT 1 FROM harness.sessions WHERE id=$1 AND active_run IS NOT NULL) RETURNING id",[id,access]);
    if(!result.rowCount)throw new Error("Cette conversation travaille déjà ou est introuvable.");
  }
  constructor(private readonly pool: Pool) {}
  async create(value: Conversation): Promise<void> {
    await transaction(this.pool, async client => {
      await client.query("INSERT INTO harness.sessions (id) VALUES ($1)", [value.id]);
      await client.query("INSERT INTO harness.conversations (id, title, created_at, updated_at, selection, project_id, file_access, network_access, max_steps) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)",
        [value.id, value.title, value.createdAt, value.updatedAt, JSON.stringify(value.selection), value.projectId ?? null, value.fileAccess ?? "read", value.networkAccess ?? false, value.maxSteps ?? 0]);
    });
  }
  async get(id: string): Promise<Conversation | null> {
    const result = await this.pool.query<ConversationRow>("SELECT c.*,CASE WHEN s.active_run IS NOT NULL THEN 'interrupted' ELSE NULL END AS work_status FROM harness.conversations c JOIN harness.sessions s ON s.id=c.id WHERE c.id=$1", [id]);
    return result.rows[0] ? conversation(result.rows[0]) : null;
  }
  async list(options:{before?:import("../../../contracts/conversations.ts").ConversationPosition;limit?:number;projectId?:string;query?:string}={}): Promise<Conversation[]> {
    const limit=validateWindow({limit:options.limit??100});
    const result = await this.pool.query<ConversationRow>(`SELECT c.*, c.updated_at::text AS page_time, CASE WHEN s.active_run IS NOT NULL THEN 'interrupted'
      WHEN e.type='interaction.requested' THEN 'waiting'
      WHEN e.type='run.completed' THEN 'completed'
      WHEN e.type='run.failed' THEN CASE WHEN e.data->>'cancelled'='true' THEN 'cancelled' ELSE 'failed' END
      WHEN e.type='interaction.resolved' AND e.data->'response'->>'status'='cancelled' THEN 'cancelled'
      ELSE 'idle' END AS work_status, e.occurred_at AS work_at
      FROM harness.conversations c JOIN harness.sessions s ON s.id=c.id
      LEFT JOIN LATERAL (SELECT type,data,occurred_at FROM harness.events
        WHERE session_id=c.id AND type IN ('run.completed','run.failed','interaction.requested','interaction.resolved')
        ORDER BY sequence DESC LIMIT 1) e ON true
      WHERE ($2::timestamptz IS NULL OR (c.updated_at,c.id)<($2::timestamptz,$5::text))
        AND ($3::text IS NULL OR ($3='none' AND c.project_id IS NULL) OR c.project_id=CASE WHEN $3='none' THEN NULL ELSE $3::uuid END)
        AND ($4::text IS NULL OR strpos(lower(c.title),lower($4))>0)
      ORDER BY c.updated_at DESC,c.id DESC LIMIT $1`,[limit,options.before?.at??null,options.projectId??null,options.query??null,options.before?.id??null]);
    return result.rows.map(conversation);
  }
  async select(id: string, selection: ModelSelection, expected?:ModelSelection|null): Promise<void> {
    const result = await this.pool.query("UPDATE harness.conversations SET selection = $2::jsonb, updated_at = now() WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM harness.sessions WHERE id=$1 AND active_run IS NOT NULL)"+(expected!==undefined?" AND COALESCE(selection,'null'::jsonb) IS NOT DISTINCT FROM $3::jsonb":"")+" RETURNING id", [id, JSON.stringify(selection),...(expected!==undefined?[JSON.stringify(expected)]:[])]);
    if (!result.rowCount) throw new Error("Modèle du fil modifié ailleurs ou conversation occupée. Rouvre ses réglages.");
  }
}

export class PostgresProjects implements ProjectRepository {
  constructor(private readonly pool: Pool) {}
  async create(value: Project): Promise<Project> { await this.pool.query("INSERT INTO harness.projects (id,title) VALUES ($1,$2)", [value.id, value.title]); return value; }
  async get(id: string): Promise<Project | null> { return (await this.pool.query<Project>("SELECT id,title FROM harness.projects WHERE id=$1",[id])).rows[0] ?? null; }
  async list(): Promise<Project[]> { return (await this.pool.query<Project>("SELECT id,title FROM harness.projects ORDER BY title,id LIMIT 200")).rows; }
}
interface MemoryRow {
  id: string; title: string; content: string; kind: MemoryRecord["kind"]; scope: MemoryRecord["scope"];
  project_id: string | null; status: MemoryRecord["status"]; version: number; source: MemoryRecord["source"];
  created_at: Date; updated_at: Date;
}
function mapMemory(row: MemoryRow): MemoryRecord {
  return { id: row.id, title: row.title, content: row.content, kind: row.kind, scope: row.scope,
    projectId: row.project_id, status: row.status, version: row.version, source: row.source,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
}
async function saveRevision(client: PoolClient, value: MemoryRecord) {
  await client.query("INSERT INTO harness.memory_revisions (memory_id,version,snapshot) VALUES ($1,$2,$3::jsonb) ON CONFLICT DO NOTHING", [value.id,value.version,JSON.stringify(value)]);
}
export class PostgresStructuredMemory implements StructuredMemoryRepository {
  constructor(private readonly pool: Pool) {}
  async create(value: MemoryRecord): Promise<MemoryRecord> {
    return transaction(this.pool, async client => {
      const hash = createHash("sha256").update(value.content).digest("hex");
      const result = await client.query<MemoryRow>(`INSERT INTO harness.memories
        (id,title,content,content_hash,kind,scope,project_id,status,version,source,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)
        ON CONFLICT (scope,(coalesce(project_id,'00000000-0000-0000-0000-000000000000'::uuid)),content_hash) WHERE status='active'
        DO UPDATE SET content=harness.memories.content RETURNING *`,
        [value.id,value.title,value.content,hash,value.kind,value.scope,value.projectId,value.status,value.version,JSON.stringify(value.source),value.createdAt,value.updatedAt]);
      const record = mapMemory(result.rows[0]);
      if (record.content !== value.content) throw new Error("Collision de contenu mémoire : enregistrement refusé.");
      await saveRevision(client, record);
      return record;
    });
  }
  async get(id: string): Promise<MemoryRecord | null> {
    const result = await this.pool.query<MemoryRow>("SELECT * FROM harness.memories WHERE id=$1",[id]);
    return result.rows[0] ? mapMemory(result.rows[0]) : null;
  }
  async list(filter: MemoryFilter): Promise<MemoryRecord[]> {
    const result = await this.pool.query<MemoryRow>(`SELECT * FROM harness.memories
      WHERE ($1::boolean OR status='active')
      AND ($2::boolean OR scope='personal' OR project_id=$3::uuid)
      AND ($4::text[] IS NULL OR EXISTS (SELECT 1 FROM unnest($4::text[]) term WHERE strpos(lower(title || ' ' || content),term)>0))
      ORDER BY updated_at DESC,id LIMIT NULLIF($5,0)`, [!!filter.includeForgotten,filter.projectId === undefined,filter.projectId ?? null,filter.terms ?? null,filter.limit]);
    return result.rows.map(mapMemory);
  }
  async replace(value: MemoryRecord, expectedVersion: number): Promise<MemoryRecord> {
    try {
      return await transaction(this.pool, async client => {
        const hash = createHash("sha256").update(value.content).digest("hex");
        const result = await client.query<MemoryRow>(`UPDATE harness.memories SET title=$3,content=$4,content_hash=$5,kind=$6,
          scope=$7,project_id=$8,status=$9,version=version+1,source=$10::jsonb,updated_at=$11
          WHERE id=$1 AND version=$2 RETURNING *`,[value.id,expectedVersion,value.title,value.content,hash,value.kind,value.scope,value.projectId,value.status,JSON.stringify(value.source),value.updatedAt]);
        if (!result.rows[0]) throw new Error("Souvenir modifié depuis sa lecture. Actualiser avant de réessayer.");
        const record = mapMemory(result.rows[0]);
        await saveRevision(client, record);
        return record;
      });
    } catch (error) {
      if ((error as {code?: string}).code === "23505") throw new Error("Un souvenir actif identique existe déjà dans cette portée.");
      throw error;
    }
  }
  async revisions(id: string): Promise<MemoryRecord[]> {
    const result = await this.pool.query<{ snapshot: MemoryRecord }>("SELECT snapshot FROM harness.memory_revisions WHERE memory_id=$1 ORDER BY version",[id]);
    return result.rows.map(row => row.snapshot);
  }
}

class PostgresAssistant implements AssistantProfileRepository {
  constructor(private readonly pool: Pool) {}
  async get(): Promise<AssistantProfile|null> {
    const result=await this.pool.query<AssistantProfile>('SELECT settings,version FROM harness.assistant_profile WHERE instance_id=(SELECT id FROM harness.instance WHERE singleton)');
    return result.rows[0]??null;
  }
  async save(settings: AssistantSettings, expectedVersion: number): Promise<AssistantProfile> {
    const result=expectedVersion===0
      ? await this.pool.query<AssistantProfile>(`INSERT INTO harness.assistant_profile (instance_id,settings,version) SELECT id,$1::jsonb,1 FROM harness.instance WHERE singleton ON CONFLICT DO NOTHING RETURNING settings,version`,[JSON.stringify(settings)])
      : await this.pool.query<AssistantProfile>(`UPDATE harness.assistant_profile SET settings=$1::jsonb,version=version+1,updated_at=now() WHERE instance_id=(SELECT id FROM harness.instance WHERE singleton) AND version=$2 RETURNING settings,version`,[JSON.stringify(settings),expectedVersion]);
    if(!result.rows[0])throw new Error('Profil modifié ailleurs. Actualise avant de réessayer.');
    return result.rows[0];
  }
}

export class PostgresExternalTools implements ExternalToolRepository {
  constructor(private readonly pool:Pool){}
  async list():Promise<ExternalToolConnection[]>{return(await this.pool.query('SELECT config FROM harness.external_tools ORDER BY id')).rows.map(row=>row.config);}
  async get(id:string):Promise<ExternalToolConnection|null>{return(await this.pool.query('SELECT config FROM harness.external_tools WHERE id=$1',[id])).rows[0]?.config??null;}
  async save(value:ExternalToolConnection,expectedVersion:number):Promise<ExternalToolConnection>{
    const next={...value,version:expectedVersion+1};
    const result=expectedVersion===0
      ?await this.pool.query('INSERT INTO harness.external_tools(id,version,config) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING config',[next.id,next.version,JSON.stringify(next)])
      :await this.pool.query('UPDATE harness.external_tools SET version=$2,config=$3 WHERE id=$1 AND version=$4 RETURNING config',[next.id,next.version,JSON.stringify(next),expectedVersion]);
    if(!result.rowCount)throw new Error('MCP : connexion modifiée ailleurs. Actualise avant de réessayer.');
    return result.rows[0].config;
  }
}
