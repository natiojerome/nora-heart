import { readFile } from "node:fs/promises";
import path from "node:path";

export type SqlStorageConfig =
  | { driver: "sqlite"; file: string }
  | { driver: "postgres"; connectionStringEnv: string };

export type StorageConfig =
  SqlStorageConfig | { driver: "json"; directory: string };

export interface Config {
  displayName: string;
  workspace: string;
  maxSteps: number;
  storage: StorageConfig;
  modules: { memory: string; model: string };
  model?: {
    provider: "openai" | "anthropic" | "openrouter" | "venice";
    modelId: string;
    apiKeyEnv: string;
    maxOutputTokens: number;
  };
  chatgpt?: {
    modelId: string;
    profile: string;
    credentialsDirectoryEnv: string;
    timeoutMs: number;
  };
}

export async function loadConfig(file: string): Promise<Config> {
  const configFile = path.resolve(file);
  const raw: unknown = JSON.parse(await readFile(configFile, "utf8"));
  if (!raw || typeof raw !== "object")
    throw new Error("Configuration invalide.");
  const config = raw as Record<string, unknown>;
  for (const key of ["displayName", "workspaceDirectory"]) {
    if (typeof config[key] !== "string" || !config[key].trim())
      throw new Error(`Configuration ${key} invalide.`);
  }
  const maxSteps = config.maxSteps ?? 8;
  if (!Number.isSafeInteger(maxSteps) || (maxSteps as number) < 0) {
    throw new Error(
      "Configuration maxSteps invalide (entier positif, 0 pour continuer sans plafond de tours).",
    );
  }
  if (!config.storage || typeof config.storage !== "object")
    throw new Error(
      "Configuration storage manquante (postgres, sqlite ou json explicite).",
    );
  const source = config.storage as Record<string, unknown>;
  let storage: StorageConfig;
  if (source.driver === "postgres") {
    const name = source.connectionStringEnv;
    if (typeof name !== "string" || !/^[A-Z_][A-Z0-9_]*$/.test(name))
      throw new Error("Nom de variable de connexion PostgreSQL invalide.");
    storage = { driver: "postgres", connectionStringEnv: name };
  } else if (
    source.driver === "sqlite" &&
    typeof source.file === "string" &&
    source.file.trim() &&
    source.file !== ":memory:"
  ) {
    storage = {
      driver: "sqlite",
      file: path.resolve(path.dirname(configFile), source.file),
    };
  } else if (
    source.driver === "json" &&
    typeof source.directory === "string" &&
    source.directory.trim()
  ) {
    storage = {
      driver: "json",
      directory: path.resolve(path.dirname(configFile), source.directory),
    };
  } else throw new Error("Configuration du stockage invalide.");
  const modules = config.modules ?? { memory: "basic", model: "demo" };
  if (!modules || typeof modules !== "object" || Array.isArray(modules))
    throw new Error("Configuration modules invalide.");
  const names = modules as Record<string, unknown>;
  for (const key of ["memory", "model"]) {
    if (typeof names[key] !== "string" || !/^[a-z][a-z0-9-]*$/.test(names[key]))
      throw new Error(`Module ${key} invalide.`);
  }
  let model: Config["model"];
  if (names.model === "ai-sdk") {
    const options = config.model as Record<string, unknown> | undefined;
    if (
      !options ||
      (options.provider !== "openai" &&
        options.provider !== "anthropic" &&
        options.provider !== "openrouter" &&
        options.provider !== "venice") ||
      typeof options.modelId !== "string" ||
      !options.modelId.trim() ||
      typeof options.apiKeyEnv !== "string" ||
      !/^[A-Z_][A-Z0-9_]*$/.test(options.apiKeyEnv) ||
      !Number.isInteger(options.maxOutputTokens) ||
      (options.maxOutputTokens as number) < 1 ||
      (options.maxOutputTokens as number) > 65536 ||
      "apiKey" in options
    ) {
      throw new Error(
        "Configuration modèle AI SDK invalide ; utiliser une référence de clé et une limite explicite.",
      );
    }
    model = {
      provider: options.provider,
      modelId: options.modelId,
      apiKeyEnv: options.apiKeyEnv,
      maxOutputTokens: options.maxOutputTokens as number,
    };
  } else if (config.model !== undefined)
    throw new Error("Options modèle réservées au module ai-sdk.");
  let chatgpt: Config["chatgpt"];
  if (names.model === "chatgpt") {
    const options = config.chatgpt as Record<string, unknown> | undefined;
    if (
      !options ||
      typeof options.modelId !== "string" ||
      !options.modelId.trim() ||
      typeof options.profile !== "string" ||
      !/^[a-zA-Z0-9_-]{1,64}$/.test(options.profile) ||
      typeof options.credentialsDirectoryEnv !== "string" ||
      !/^[A-Z_][A-Z0-9_]*$/.test(options.credentialsDirectoryEnv) ||
      !Number.isInteger(options.timeoutMs) ||
      (options.timeoutMs as number) < 1000 ||
      (options.timeoutMs as number) > 600_000 ||
      Object.keys(options).some(
        (key) =>
          ![
            "modelId",
            "profile",
            "credentialsDirectoryEnv",
            "timeoutMs",
          ].includes(key),
      )
    ) {
      throw new Error(
        "Configuration ChatGPT invalide : modèle, profil, référence de dossier privé et délai requis.",
      );
    }
    chatgpt = {
      modelId: options.modelId,
      profile: options.profile,
      credentialsDirectoryEnv: options.credentialsDirectoryEnv,
      timeoutMs: options.timeoutMs as number,
    };
  } else if (config.chatgpt !== undefined)
    throw new Error("Options ChatGPT réservées au module chatgpt.");
  return {
    displayName: config.displayName as string,
    workspace: path.resolve(
      path.dirname(configFile),
      config.workspaceDirectory as string,
    ),
    maxSteps: maxSteps as number,
    storage,
    modules: { memory: names.memory as string, model: names.model as string },
    ...(model ? { model } : {}),
    ...(chatgpt ? { chatgpt } : {}),
  };
}

export function postgresConnection(config: StorageConfig): string {
  if (config.driver !== "postgres")
    throw new Error("Cette commande nécessite le stockage PostgreSQL.");
  const connection = process.env[config.connectionStringEnv];
  if (!connection)
    throw new Error(
      `Variable ${config.connectionStringEnv} manquante. Aucun repli automatique sur des fichiers.`,
    );
  return connection;
}

/** Explicit web selection; the existing PostgreSQL environment remains compatible. */
export function webStorageConfig(
  env: NodeJS.ProcessEnv,
): SqlStorageConfig | undefined {
  const driver =
    env.HARNESS_STORAGE_DRIVER ??
    (env.HARNESS_DATABASE_URL ? "postgres" : undefined);
  if (!driver) {
    if (env.HARNESS_SQLITE_PATH)
      throw new Error("Choisir explicitement HARNESS_STORAGE_DRIVER=sqlite.");
    return undefined;
  }
  if (driver === "postgres") {
    const config: SqlStorageConfig = {
      driver,
      connectionStringEnv: "HARNESS_DATABASE_URL",
    };
    if (!env.HARNESS_DATABASE_URL)
      throw new Error("Connexion PostgreSQL manquante.");
    return config;
  }
  if (
    driver === "sqlite" &&
    env.HARNESS_SQLITE_PATH &&
    path.isAbsolute(env.HARNESS_SQLITE_PATH)
  )
    return { driver, file: env.HARNESS_SQLITE_PATH };
  throw new Error("Configuration du stockage web invalide.");
}

/** Installation-relative default; an override must not depend on the process cwd. */
export function projectsRootDirectory(env: Record<string,string|undefined>, installationDirectory: string): string {
  const override = env.HARNESS_PROJECTS_ROOT;
  if(override !== undefined && (!override.trim() || !path.isAbsolute(override))) throw new Error("HARNESS_PROJECTS_ROOT doit être un chemin absolu.");
  return override ?? path.join(installationDirectory,"projects");
}
