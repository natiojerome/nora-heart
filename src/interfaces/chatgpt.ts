import { parseArgs } from "node:util";
import { loadConfig } from "../app/config.ts";
import { chatGptCommand, chatGptErrorMessage } from "../app/chatgpt.ts";

const { values } = parseArgs({ options: {
  config: { type: "string", default: "harness.chatgpt.config.json" },
  action: { type: "string", default: "status" },
  port: { type: "string", default: "1455" },
} });
const controller = new AbortController();
const cancel = () => controller.abort();
process.once("SIGINT", cancel);
process.once("SIGTERM", cancel);
try {
  const config = await loadConfig(values.config!);
  await chatGptCommand(config, values.action!, Number(values.port), url => {
    console.log(`Continue with ChatGPT : ${url}`);
    console.log("Sur un serveur distant : transférer ce port par SSH avant d’ouvrir le lien. Aucun token à coller dans le chat.");
  }, controller.signal);
} catch (error) {
  console.error(chatGptErrorMessage(error) ?? "Opération ChatGPT impossible. Vérifier la configuration, les permissions du dossier, le consentement et l’éligibilité. Aucun repli sur une clé API.");
  process.exitCode = 1;
} finally {
  process.removeListener("SIGINT", cancel);
  process.removeListener("SIGTERM", cancel);
}
