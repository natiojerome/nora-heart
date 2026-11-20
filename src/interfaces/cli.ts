import { parseArgs } from "node:util";
import { loadConfig } from "../app/config.ts";
import { compose } from "../app/compose.ts";
import { chatGptErrorMessage } from "../app/chatgpt.ts";

const { values } = parseArgs({ options: {
  config: { type: "string", default: "harness.config.json" },
  session: { type: "string", default: "demo" },
  prompt: { type: "string", default: "Liste les fichiers de mon workspace." },
} });
async function main(): Promise<void> {
  const config = await loadConfig(values.config!);
  const application = await compose(config);
  try {
    console.log(`${config.displayName} · instance ${application.instanceId} · modèle ${application.model.id}`);
    if (config.chatgpt) console.log(`Usage du forfait ChatGPT · profil ${config.chatgpt.profile} · https://chatgpt.com/settings/usage`);
    const result = await application.engine.run({
      sessionId: values.session!, prompt: values.prompt!, provider: application.model,
      displayName: config.displayName, workspace: config.workspace,
      permissions: new Set(["files.read", "memory.read"]), maxSteps: config.maxSteps,
    });
    console.log(result.text);
  } finally { await application.close(); }
}

main().catch(error => {
  // Do not leak provider/SQL error details or credentials into CLI logs.
  console.error(chatGptErrorMessage(error) ?? "Démarrage ou exécution impossible. Vérifier la configuration, l’accès au stockage sélectionné et les migrations (pnpm db:migrate). Aucun repli automatique.");
  process.exitCode = 1;
});
