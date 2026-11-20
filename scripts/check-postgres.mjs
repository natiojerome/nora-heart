import { randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";

// Dedicated disposable service: never reads an existing application's credentials.
const container = `harness-pg-test-${randomUUID()}`;
const directory = await mkdtemp(path.join(os.tmpdir(), "harness-pg-check-"));
const password = randomBytes(32).toString("hex");
const image = process.env.HARNESS_TEST_POSTGRES_IMAGE ?? "postgres:18.4-bookworm";
const containerEnv = { ...process.env, POSTGRES_PASSWORD: password, POSTGRES_USER: "harness", POSTGRES_DB: "harness_test" };
let created = false;
let pool;

function command(binary, args, options = {}) {
  const result = spawnSync(binary, args, { encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024, ...options });
  if (result.status !== 0) {
    // Do not print the environment, connection URL, SQL data, or full child errors.
    throw new Error(`${binary} a échoué (code ${result.status ?? "indisponible"}).`);
  }
  return result.stdout;
}

async function snapshot(client) {
  const result = await client.query(`SELECT
    (SELECT id::text FROM harness.instance) AS id,
    (SELECT count(*)::text FROM harness.events) AS events,
    (SELECT md5(COALESCE(jsonb_agg(to_jsonb(a) ORDER BY instance_id)::text, '[]')) FROM harness.assistant_profile a) AS assistant_digest,
    (SELECT count(*)::text FROM harness.memories) AS memories,
    (SELECT count(*)::text FROM harness.conversations) AS conversations,
    (SELECT md5(COALESCE(jsonb_agg(to_jsonb(r) ORDER BY memory_id, version)::text, '[]')) FROM harness.memory_revisions r) AS revision_digest,
    (SELECT md5(COALESCE(jsonb_agg(to_jsonb(p) ORDER BY id)::text, '[]')) FROM harness.projects p) AS project_digest,
    (SELECT md5(COALESCE(jsonb_agg(to_jsonb(c) ORDER BY id)::text, '[]')) FROM harness.conversations c) AS conversation_digest,
    (SELECT md5(COALESCE(jsonb_agg(to_jsonb(e) ORDER BY session_id, sequence)::text, '[]')) FROM harness.events e) AS event_digest,
    (SELECT md5(COALESCE(jsonb_agg(to_jsonb(m) ORDER BY id)::text, '[]')) FROM harness.memories m) AS memory_digest,
    (SELECT md5(COALESCE(jsonb_agg(to_jsonb(q) ORDER BY id)::text, '[]')) FROM harness.quick_prompts q) AS prompts_digest,
    (SELECT md5(COALESCE(jsonb_agg(to_jsonb(f) ORDER BY id)::text, '[]')) FROM harness.chat_attachments f) AS files_digest,
    (SELECT md5(COALESCE(jsonb_agg(to_jsonb(x) ORDER BY id)::text, '[]')) FROM harness.external_tools x) AS external_tools_digest`);
  return result.rows[0];
}

try {
  command("docker", ["run", "--detach", "--name", container,
    "--memory=256m", "--cpus=1", "--pids-limit=128", "--publish", "127.0.0.1::5432",
    "--tmpfs", "/var/lib/postgresql:rw,size=192m", "--env", "POSTGRES_USER", "--env", "POSTGRES_PASSWORD",
    "--env", "POSTGRES_DB", image, "-c", "shared_buffers=16MB", "-c", "max_connections=20"], { env: containerEnv });
  created = true;
  const info = JSON.parse(command("docker", ["inspect", "--format", "{{json .NetworkSettings.Ports}}", container]));
  const port = info["5432/tcp"][0].HostPort;
  const connection = `postgresql://harness:${password}@127.0.0.1:${port}/harness_test`;
  pool = new Pool({ connectionString: connection, max: 2, connectionTimeoutMillis: 500 });
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    try { await pool.query("SELECT 1"); ready = true; break; }
    catch { await delay(250); }
  }
  if (!ready) throw new Error("PostgreSQL de test non disponible.");
  const env = { ...process.env, HARNESS_TEST_DATABASE_URL: connection, HARNESS_DATABASE_URL: connection };
  console.log(`PostgreSQL isolé (${image}), plafond 256 Mio.`);
  command("pnpm", ["exec", "tsx", "--test", "tests/postgres.integration.ts"], { env, stdio: "inherit" });

  const config = path.join(directory, "harness.config.json");
  await writeFile(config, JSON.stringify({ displayName: "Nora Heart", storage: { driver: "postgres", connectionStringEnv: "HARNESS_DATABASE_URL" },
    workspaceDirectory: "workspace", maxSteps: 8 }));
  command("pnpm", ["db:migrate", "--config", config], { env, stdio: "inherit" });
  command("pnpm", ["demo", "--config", config], { env, stdio: "inherit" });
  command("pnpm", ["demo", "--config", config], { env, stdio: "inherit" });

  const before = await snapshot(pool);
  const dump = command("docker", ["exec", container, "pg_dump", "--username=harness", "--dbname=harness_test", "--format=custom"], { encoding: null });
  await pool.query("CREATE DATABASE harness_restore_test");
  command("docker", ["exec", "--interactive", container, "pg_restore", "--username=harness", "--dbname=harness_restore_test", "--no-owner", "--exit-on-error"], { input: dump, encoding: null });
  const restored = new Pool({ connectionString: connection.replace(/\/harness_test$/, "/harness_restore_test"), max: 1 });
  try {
    const after = await snapshot(restored);
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Restauration différente de la source.");
    console.log(`Sauvegarde/restauration vérifiée : ${before.events} événements, ${before.memories} souvenirs, identité et contenus identiques.`);
  } finally { await restored.end(); }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool?.end();
  if (created) command("docker", ["rm", "--force", "--volumes", container]);
  await rm(directory, { recursive: true, force: true });
}
