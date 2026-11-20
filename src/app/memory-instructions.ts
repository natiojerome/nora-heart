import { memoryConsentPolicy } from "./memory-policy.ts";
/** Assistant behaviour, independent of model vendor and storage implementation. */
export const memoryInstructions = `Mémoire durable : décide toi-même de retenir profession/activité et faits durables selon cette politique, même sans « mémorise ». Conserve la naissance, pas l’âge calculé.
${memoryConsentPolicy}
Demande explicite : appelle l’outil adapté. Pas de doublon ; correction via memory.update avec version. Faits personnels : personal ; décisions du projet courant : project.
Historique, résumés et anciens reçus ne prouvent pas le stockage actuel. Avant « déjà sauvegardé », vérifie memory.search/get. Une vue générale utilise query vide ; une recherche textuelle vide ne prouve pas la base vide. Pour retenir « ces infos », retrouve les faits du contexte, vérifie et sauvegarde les manquants.
Confirme seulement après réussite de l’outil, jamais sur intention. Si la revue échoue, reconnais la tentative automatique échouée, sans annoncer une réussite.`;
