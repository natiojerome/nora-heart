import type { MailFileTransfer } from "../../../contracts/mail.ts";
import type { WorkspaceFilesFactory } from "../../../contracts/files.ts";
import type { Tool } from "../../../contracts/tools.ts";
export function mailFileTools(
  transfer: MailFileTransfer,
  files: WorkspaceFilesFactory,
  canWrite: boolean,
  canUpload = true,
): Tool[] {
  const tools: Tool[] = [
    {
      name: "mail.attach_file",
      title: "Joindre un fichier local",
      permission: "external.write",
      description:
        "Transférer un fichier du workspace au stockage Mail par flux binaire, sans base64 ni octets dans le contexte. Retourne un UUID à inclure dans body.attachments du brouillon. Respecte les droits fichiers et la connexion Mail approuvée.",
      parameters: {
        type: "object",
        required: ["path"],
        additionalProperties: false,
        properties: { path: { type: "string" }, type: { type: "string" } },
      },
      execute: async (args: any, context) => {
        const local = await files(context.workspace, context.signal).download(
          args.path,
        );
        return JSON.stringify(
          await transfer.upload(
            local.entry.name,
            args.type ?? "application/octet-stream",
            local.body,
            context.signal,
          ),
        );
      },
    },
    ...(canWrite
      ? [
          {
            name: "mail.save_attachment",
            title: "Enregistrer une pièce jointe",
            permission: "files.write" as const,
            description:
              "Télécharger une pièce jointe Mail déjà importée vers un fichier du workspace, sans octets dans le contexte. destination doit être neuve, ou fournir sa révision actuelle pour la remplacer. Aucun envoi de mail.",
            parameters: {
              type: "object" as const,
              required: ["id", "destination"],
              additionalProperties: false,
              properties: {
                id: { type: "string" },
                destination: { type: "string" },
                revision: { type: "string" },
              },
            },
            execute: async (args: any, context: any) => {
              const remote = await transfer.download(args.id, context.signal);
              try {
                await files(context.workspace, context.signal).import(
                  args.destination,
                  remote.body,
                  args.revision,
                );
                return JSON.stringify({ saved: true, path: args.destination });
              } finally {
                await remote.close?.();
              }
            },
          },
        ]
      : []),
  ];
  return tools.filter((t) => canUpload || t.name !== "mail.attach_file");
}
