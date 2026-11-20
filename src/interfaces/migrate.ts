import { parseArgs } from "node:util";
import { loadConfig } from "../app/config.ts";
import { migrateStorage } from "../app/compose.ts";

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { config: { type: "string", default: "harness.config.json" } } });
  const config = await loadConfig(values.config!);
  await migrateStorage(config);
  console.log("Migrations du stockage sélectionné appliquées ou déjà à jour.");
}

main().catch(() => {
  console.error("Migration refusée ou impossible. Vérifier la configuration du stockage, les droits et la compatibilité des migrations. Aucun détail de connexion affiché.");
  process.exitCode = 1;
});
