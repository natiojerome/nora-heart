import { parseArgs } from "node:util";
import path from "node:path";
import { loadConfig } from "../app/config.ts";
import { backupSqlite } from "../app/compose.ts";
try {
  const { values } = parseArgs({
    options: {
      config: { type: "string", default: "harness.sqlite.example.json" },
      output: { type: "string" },
    },
  });
  if (!values.output) throw new Error("Destination requise.");
  await backupSqlite(
    await loadConfig(values.config!),
    path.resolve(values.output),
  );
  console.log("Snapshot SQLite et métadonnées de reprise sauvegardés.");
} catch {
  console.error(
    "Sauvegarde SQLite refusée : vérifier configuration, destination neuve et fermeture des runtimes.",
  );
  process.exitCode = 1;
}
