import {fileURLToPath} from "node:url";
import {loadInstallation} from '../app/installation.ts';
import {webStorageConfig,projectsRootDirectory} from "../app/config.ts";
import { openWebConversations } from "../app/web-conversations.ts";
import { TestLab } from "../app/test-lab.ts";
import { WebAccess } from "../app/web-access.ts";
import { createWebServer } from "./web/server.ts";

const required = (name: string) => { const value = process.env[name]; if (!value) throw new Error(`Variable ${name} requise.`); return value; };
try {
  if(process.env.HARNESS_INSTALL_CONFIG_FILE){const saved=await loadInstallation(process.env.HARNESS_INSTALL_CONFIG_FILE);Object.assign(process.env,saved.env);process.env.HARNESS_INSTALL_REVISION=saved.revision??'';}
  const access = new WebAccess({ secret: required("HARNESS_WEB_SESSION_SECRET"), password: process.env.HARNESS_WEB_PASSWORD,
    inviteFile: process.env.HARNESS_WEB_INVITE_FILE });
  const lab = new TestLab({ directory: required("HARNESS_WEB_STATE_DIR"), authDirectory: required("HARNESS_CHATGPT_AUTH_DIR"),
    quotaSnapshotFile:process.env.HARNESS_QUOTA_SNAPSHOT_FILE,
    quotaMaxAgeMs:process.env.HARNESS_QUOTA_MAX_AGE_MS?Number(process.env.HARNESS_QUOTA_MAX_AGE_MS):undefined,
    veniceWeb: process.env.HARNESS_VENICE_WEB_ENABLED === "1",
    apiKeys: { openai: process.env.HARNESS_OPENAI_API_KEY, anthropic: process.env.HARNESS_ANTHROPIC_API_KEY, openrouter:process.env.HARNESS_OPENROUTER_API_KEY, venice:process.env.HARNESS_VENICE_API_KEY } });
  await lab.prepare();
  const storageConfig=webStorageConfig(process.env);
  const persistent = storageConfig
    ? await openWebConversations(storageConfig, required("HARNESS_WEB_STATE_DIR"), lab, undefined, projectsRootDirectory(process.env,fileURLToPath(new URL("../../",import.meta.url)))) : undefined;
  const server = createWebServer({ maintenanceFile:process.env.HARNESS_MAINTENANCE_FILE??"/var/lib/personal-harness/maintenance", origin: required("HARNESS_WEB_ORIGIN"), access, lab, accountLogin:persistent?.accountLogin, accountRequired:persistent?.accountRequired, installation:persistent?.installation,restart:process.env.HARNESS_INSTALL_CONFIG_FILE?()=>{setTimeout(()=>process.kill(process.pid,"SIGTERM"),250);}:undefined, conversations: persistent?.conversations, projectsWorkspace:persistent?.projectsWorkspace,projectManagement:persistent?.projectManagement, assistant: persistent?.assistant, skills:persistent?.skills, tasks:persistent?.tasks, scheduler:persistent?.scheduler, externalTools:persistent?.externalTools, memoryConfigured:persistent?.memoryConfigured, memories: persistent?.memories });
  const port = Number(process.env.PORT ?? 4215);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Port web invalide.");
  server.listen(port, process.env.HARNESS_WEB_HOST ?? "127.0.0.1", () => console.log(`Laboratoire web démarré sur le port ${port}.`));
  if(process.env.HARNESS_SCHEDULER_ENABLED!=='0')persistent?.scheduler.start();
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await lab.close(); server.closeAllConnections(); server.close(); await persistent?.close();
  };
  process.once("SIGTERM", () => { void stop(); });
  process.once("SIGINT", () => { void stop(); });
} catch {
  console.error("Démarrage web impossible. Vérifier les variables et les dossiers privés."); process.exitCode = 1;
}
