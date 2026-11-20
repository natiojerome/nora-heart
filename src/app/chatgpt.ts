import path from "node:path";
import { ChatGptAuth, ChatGptProvider, ChatGptError } from "../modules/models/chatgpt/index.ts";
import type { Config } from "./config.ts";

export function chatGptConnection(config: Config) {
  if (config.modules.model !== "chatgpt" || !config.chatgpt) throw new Error("Choisir le module chatgpt et ses options.");
  const directory = process.env[config.chatgpt.credentialsDirectoryEnv];
  if (!directory || !path.isAbsolute(directory)) throw new Error(`Variable ${config.chatgpt.credentialsDirectoryEnv} requise : chemin absolu d’un dossier privé dédié.`);
  const auth = new ChatGptAuth({ directory, profile: config.chatgpt.profile });
  const model = new ChatGptProvider({ modelId: config.chatgpt.modelId, timeoutMs: config.chatgpt.timeoutMs,
    accessToken: signal => auth.accessToken(signal) });
  return { auth, model };
}

export function chatGptErrorMessage(error: unknown): string | undefined {
  if (!(error instanceof ChatGptError)) return undefined;
  if (error.code === "timeout") return "ChatGPT n’a pas transmis de données dans le délai d’attente. La réponse est interrompue ; historique conservé. Aucun repli API.";
  if (error.code === "subscription_sharing_usage_limit_exceeded") return "Limite d’usage ChatGPT atteinte. Gérer l’usage : https://chatgpt.com/settings/usage. Aucun repli API.";
  if (["chatgpt_reauthorization_required", "subscription_sharing_invalid_user"].includes(error.code)) return "Compte ChatGPT à reconnecter (pnpm chatgpt --action login). Aucun repli API.";
  if (error.code === "subscription_sharing_user_not_eligible") return "Usage du forfait indisponible pour ce compte ou cette application. Vérifier l’éligibilité et le consentement. Aucun repli API.";
  return "Réponse ChatGPT indisponible ou incompatible. Aucun repli API.";
}

export async function chatGptCommand(config: Config, action: string, port: number, onReady: (url: string) => void, signal?: AbortSignal): Promise<void> {
  const { auth, model } = chatGptConnection(config);
  switch (action) {
    case "login":
      await auth.login({ appName: config.displayName, port, onReady, signal });
      console.log("Compte connecté. Usage : https://chatgpt.com/settings/usage");
      break;
    case "status": console.log(JSON.stringify(await auth.status())); break;
    case "models": console.log(JSON.stringify(await model.models(signal), null, 2)); break;
    case "logout": {
      const result = await auth.logout();
      console.log(result.remoteRevoked ? "Déconnexion locale et révocation confirmées." :
        "Déconnexion locale effectuée ; révocation distante non confirmée. Déconnecter l’application dans les réglages ChatGPT.");
      break;
    }
    case "test": {
      const result = await model.generate({ instructions: "Réponds brièvement.", messages: [{ role: "user", content: "Réponds exactement : Nora Heart connecté." }], tools: [], signal });
      console.log(`Usage du forfait ChatGPT · ${model.id}\n${result.content}`);
      break;
    }
    default: throw new Error("Commande ChatGPT inconnue.");
  }
}
