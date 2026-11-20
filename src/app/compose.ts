import {taskTools} from "../modules/tools/tasks/index.ts";
import {Calendar} from "../modules/scheduling/calendar/index.ts";
import {Scheduler} from "../modules/scheduling/runner/index.ts";
import {fileURLToPath} from "node:url";
import {LocalSkills} from "../modules/skills/local/index.ts";
import { mkdir } from "node:fs/promises";
import type { MemoryService } from "../contracts/memory.ts";
import type { Tool } from "../contracts/tools.ts";
import type { ModelProvider } from "../contracts/models.ts";
import type { StorageConnection } from "../contracts/storage.ts";
import { Engine } from "../core/engine.ts";
import { StructuredMemory } from "../modules/memory/structured/index.ts";
import { structuredMemoryTools } from "../modules/tools/memory-structured/index.ts";
import { BasicMemory } from "../modules/memory/basic/index.ts";
import { DemoProvider } from "../modules/models/demo/index.ts";
import { createAiSdkProvider } from "../modules/models/ai-sdk/index.ts";
import { openJsonStorage } from "../modules/storage/json/index.ts";
import {
  createPostgresPool,
  migratePostgres,
  openPostgresStorage,
} from "../modules/storage/postgres/index.ts";
import { fileTools } from "../modules/tools/files/index.ts";
import { memoryTools } from "../modules/tools/memory/index.ts";
import type { SqlStorageConnection } from "../contracts/sql-storage.ts";
import type { SqlStorageConfig } from "./config.ts";
import type { Config } from "./config.ts";
import { postgresConnection } from "./config.ts";
import { chatGptConnection } from "./chatgpt.ts";

// Explicit registration, not dynamic discovery. Add a module's public import
// and its factory here; core and other implementations do not change.
const memoryModules: Record<
  string,
  (storage: StorageConnection) => { memory: MemoryService; tools: Tool[] }
> = {
  basic: (storage) => {
    const memory = new BasicMemory(storage.memories);
    return { memory, tools: memoryTools(memory) };
  },
  structured: (storage) => {
    if (!storage.structuredMemories)
      throw new Error(
        "Le module structured requiert un repository mémoire structuré.",
      );
    const memory = new StructuredMemory(storage.structuredMemories, {
      projectId: null,
      source: { type: "manual" },
    });
    return { memory, tools: structuredMemoryTools(memory, null) };
  },
};
const modelModules: Record<
  string,
  (config: Config) => ModelProvider | Promise<ModelProvider>
> = {
  demo: () => new DemoProvider(),
  "ai-sdk": (config) => {
    if (!config.model) throw new Error("Configuration modèle manquante.");
    const apiKey = process.env[config.model.apiKeyEnv];
    if (!apiKey?.trim())
      throw new Error(`Variable ${config.model.apiKeyEnv} manquante.`);
    return createAiSdkProvider({ ...config.model, apiKey });
  },
  chatgpt: async (config) => {
    const { auth, model } = chatGptConnection(config);
    if (!(await auth.status()).connected)
      throw new Error(
        "Compte ChatGPT non connecté ; lancer pnpm chatgpt --action login.",
      );
    return model;
  },
};

export interface Application {
  engine: Engine;
  model: ModelProvider;
  instanceId: string;
  close(): Promise<void>;
}

export async function compose(config: Config): Promise<Application> {
  // Reject unknown selections before opening a connection or creating files.
  if (!Object.hasOwn(memoryModules, config.modules.memory))
    throw new Error("Module mémoire inconnu.");
  if (!Object.hasOwn(modelModules, config.modules.model))
    throw new Error("Module modèle inconnu.");
  if (
    config.modules.memory === "structured" &&
    config.storage.driver === "json"
  )
    throw new Error(
      "Le stockage JSON de démonstration ne fournit pas de mémoire structurée.",
    );
  const model = await modelModules[config.modules.model](config);
  const storage: StorageConnection =
    config.storage.driver === "json"
      ? await openJsonStorage(config.storage.directory)
      : await openSqlStorage(config.storage);
  try {
    const selectedMemory = memoryModules[config.modules.memory](storage);
    await mkdir(config.workspace, { recursive: true });
    return {
      engine: new Engine(storage.sessions, [
        ...fileTools(),
        ...selectedMemory.tools,
      ]),
      model,
      instanceId: storage.instanceId,
      close: () => storage.close(),
    };
  } catch (cause) {
    await storage.close();
    throw cause;
  }
}

export async function migrateStorage(config: Config): Promise<void> {
  if (config.storage.driver === "sqlite") {
    const { migrateSqlite } =
      await import("../modules/storage/sqlite/index.ts");
    await migrateSqlite(config.storage.file);
    return;
  }
  const pool = createPostgresPool(postgresConnection(config.storage));
  try {
    await migratePostgres(pool);
  } finally {
    await pool.end();
  }
}

export async function openSqlStorage(
  config: SqlStorageConfig,
): Promise<SqlStorageConnection> {
  if (config.driver === "postgres")
    return openPostgresStorage(postgresConnection(config));
  if (config.driver === "sqlite") {
    const { openSqliteStorage } =
      await import("../modules/storage/sqlite/index.ts");
    return openSqliteStorage(config.file);
  }
  throw new Error("Module de stockage SQL inconnu.");
}

export async function backupSqlite(
  config: Config,
  destination: string,
): Promise<void> {
  if (config.storage.driver !== "sqlite")
    throw new Error(
      "Cette commande est réservée au module SQLite ; PostgreSQL utilise sa sauvegarde native.",
    );
  const { backupSqliteStorage } =
    await import("../modules/storage/sqlite/index.ts");
  await backupSqliteStorage(config.storage.file, destination);
}

export function openSkillCatalog(manifest=process.env.HARNESS_SKILLS_CATALOG??fileURLToPath(new URL('../../skills/catalog.json',import.meta.url))){return new LocalSkills(manifest);}

export function taskCalendar(){return new Calendar();}
export function taskScheduler(repository:import('../contracts/tasks.ts').TaskRepository,calendar:import('../contracts/tasks.ts').TaskCalendar,execution:import('../contracts/tasks.ts').TaskExecution,options?:ConstructorParameters<typeof Scheduler>[3]){return new Scheduler(repository,calendar,execution,options);}

export function tasksTools(service:import("../contracts/tasks.ts").TaskService,conversationId:string){return taskTools(service,conversationId);}
