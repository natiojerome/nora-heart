import type { Tool } from "../contracts/tools.ts";
import type {
  ExternalToolConnection,
  ExternalToolDefinition,
} from "../contracts/external-tools.ts";

/** Presentation only: this dictionary never declares tools, IDs or permissions. */
export const serviceLabels: Record<string, string> = {
  memory: "Mémoire",
  projects: "Projets",
  vault: "Coffre-fort",
  mail: "Mail",
};
const legacyLabels: Record<string, string> = {
  "Nora MCPs · Mémoire partagée": "Mémoire",
  "Nora MCPs · Projets partagés": "Projets",
  "Nora MCPs · Coffre-fort": "Coffre-fort",
  "Recherche web locale": "Recherche web",
  ...Object.fromEntries(
    Object.entries(serviceLabels).map(([key, value]) => [
      "Services · " + key,
      value,
    ]),
  ),
};
export const connectionDisplayName = (
  connection: Pick<ExternalToolConnection, "label">,
) => legacyLabels[connection.label] ?? connection.label;
const labels: Record<string, string> = {
  "files.list": "Lister les fichiers",
  "files.read": "Lire un fichier",
  "files.create": "Créer un fichier",
  "files.write": "Écrire un fichier",
  "files.replace": "Modifier un fichier",
  "files.mkdir": "Créer un dossier",
  "files.delete": "Supprimer un fichier",
  "files.move": "Déplacer un fichier",
  "files.info": "Inspecter un fichier",
  "files.update": "Modifier un fichier",
  "terminal.exec": "Exécuter une commande",
  "terminal.list": "Lister les commandes",
  "tasks.list": "Lister les tâches",
  "tasks.read": "Lire une tâche et ses résultats",
  "tasks.write": "Gérer une tâche",
  "terminal.read": "Lire la sortie d’une commande",
  "terminal.write": "Écrire dans une commande",
  "terminal.stop": "Arrêter une commande",
  "history.read": "Relire l’historique",
  "interactions.request_input": "Demander une réponse",
  "skills.load": "Charger un skill",
  "skills.read": "Lire une ressource de skill",
  "memory.search": "Rechercher des souvenirs",
  "memory.get": "Lire un souvenir",
  "memory.remember": "Mémoriser une information",
  "memory.update": "Modifier un souvenir",
  "memory.forget": "Oublier un souvenir",
  "memory.restore": "Restaurer un souvenir",
  web_search: "Rechercher sur le web",
  web_fetch: "Lire une page web",
  memory_help: "Guide de la mémoire",
  memory_search: "Rechercher des souvenirs",
  memory_get: "Lire un souvenir",
  memory_create: "Mémoriser une information",
  memory_update: "Modifier un souvenir",
  memory_forget: "Oublier un souvenir",
  memory_revisions: "Voir les versions d’un souvenir",
  memory_export: "Exporter les souvenirs",
  vault_help: "Guide du coffre-fort",
  vault_search: "Rechercher des secrets",
  vault_get: "Inspecter un secret",
  vault_create: "Créer un secret",
  vault_update: "Modifier un secret",
  vault_read: "Lire un secret",
  vault_history: "Voir les versions d’un secret",
  vault_delete: "Supprimer un secret",
  vault_generate_password: "Générer un mot de passe",
  projects_help: "Guide des projets",
  projects_search: "Rechercher des projets",
  projects_get: "Lire un projet",
  projects_create: "Créer un projet",
  projects_update: "Modifier un projet",
  projects_archive: "Archiver un projet",
  projects_item_create: "Créer un élément de projet",
  projects_item_get: "Lire un élément de projet",
  projects_item_update: "Modifier un élément de projet",
  projects_items_list: "Lister les éléments d’un projet",
  projects_history: "Voir l’historique d’un projet",
  projects_export: "Exporter un projet",
  mail_help: "Guide du mail",
  mail_accounts: "Lister les comptes mail",
  mail_test: "Tester un compte mail",
  mail_folders: "Lister les dossiers mail",
  mail_search: "Rechercher des messages",
  mail_read: "Lire un message",
  mail_identities: "Lister les identités et signatures",
  mail_identity_save: "Enregistrer une identité et sa signature",
  mail_drafts: "Lister les brouillons",
  mail_draft_get: "Lire un brouillon",
  mail_draft_save: "Enregistrer un brouillon",
  mail_draft_sync: "Synchroniser un brouillon",
  mail_send: "Envoyer un message",
  mail_send_reconcile: "Vérifier un envoi incertain",
  mail_message_export: "Exporter un message",
  mail_attachment_import: "Importer une pièce jointe",
  mail_attachment_upload: "Déposer une pièce jointe",
  mail_attachment_read: "Lire une pièce jointe",
  mail_attachment_bytes: "Télécharger une pièce jointe",
};
export function toolDisplayName(tool: { name: string; title?: string }) {
  return tool.title || labels[tool.name] || tool.name;
}
export function connectionIcon(
  connection: Pick<ExternalToolConnection, "tools">,
) {
  const names = connection.tools.map((tool) => tool.name);
  for (const [prefix, icon] of [
    ["mail_", "mail"],
    ["memory_", "memories"],
    ["projects_", "projects"],
    ["vault_", "vault"],
    ["web_", "web"],
  ])
    if (names.some((name) => name.startsWith(prefix))) return icon;
  return "tools";
}
export const toolPresentation = (tool: ExternalToolDefinition) => ({
  ...tool,
  displayName: toolDisplayName(tool),
});
export const presentTools = <T extends Tool<unknown>>(tools: T[]) =>
  tools.map((tool) => ({ ...tool, title: toolDisplayName(tool) }));
