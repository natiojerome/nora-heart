import { constants } from "node:fs";
import {
  open,
  lstat,
  readdir,
  realpath,
  stat as fileStat,
  writeFile,
  rename,
  unlink,
  mkdir,
  rmdir,
  link,
} from "node:fs/promises";
import { createHash, randomUUID, randomBytes } from "node:crypto";
import path from "node:path";
import type { Json } from "../../../contracts/json.ts";
import type { Tool } from "../../../contracts/tools.ts";
import type {
  WorkspaceFiles,
  WorkspaceEntry,
  WorkspaceFilesFactory,
} from "../../../contracts/files.ts";

import {WorkspaceError} from "../../../contracts/files.ts";
export {WorkspaceError} from "../../../contracts/files.ts";
function argument(args: Json, key: string): string {
  if (
    !args ||
    typeof args !== "object" ||
    Array.isArray(args) ||
    typeof args[key] !== "string"
  )
    throw new WorkspaceError(`Argument ${key} manquant ou invalide.`);
  return args[key];
}
const digest = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");
const safeErrors: Record<string, string> = {
  ENOENT: "Fichier ou dossier introuvable.",
  EEXIST: "Ce nom existe déjà.",
  ENOTEMPTY: "Ce dossier contient encore des fichiers.",
  EISDIR: "Choisis un fichier.",
  ENAMETOOLONG: "Chemin trop long pour le système de fichiers.",
  ENOSPC: "L’espace disque disponible est insuffisant.",
  ENOTDIR: "Ce chemin n’est pas un dossier.",
  ELOOP: "Les liens symboliques ne sont pas autorisés.",
};
async function guarded<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    throw new WorkspaceError(
      safeErrors[(error as NodeJS.ErrnoException).code ?? ""] ??
        "Opération fichier impossible.",
    );
  }
}

/** A workspace is trusted local storage, not an OS sandbox against other processes. */
export class LocalFiles implements WorkspaceFiles {
  constructor(private readonly workspace: string, private readonly host = false) {}
  private async resolve(input: string, creating = false, rootAllowed = false) {
    if(this.host){
      if(typeof input!=='string'||input.includes('\0'))throw new WorkspaceError('Chemin invalide.');
      const target=path.resolve(this.workspace,input||'.');
      if(creating){try{return await realpath(target);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;return path.join(await realpath(path.dirname(target)),path.basename(target));}}
      return realpath(target);
    }
    if (
      typeof input !== "string" ||
      input.includes("\0") ||
      input.includes("\\") ||
      path.isAbsolute(input)
    )
      throw new WorkspaceError("Chemin relatif au workspace requis.");
    const parts = input.split("/").filter(Boolean);
    if (
      parts.some(
        (part) => part === ".." || part === "." || part.startsWith(".heart-"),
      ) ||
      (!parts.length && !rootAllowed)
    )
      throw new WorkspaceError("Chemin hors du workspace ou réservé.");
    const root = await realpath(this.workspace);
    let target = root;
    for (let index = 0; index < parts.length; index++) {
      target = path.join(target, parts[index]);
      if (creating && index === parts.length - 1) continue;
      const stat = await lstat(target);
      if (stat.isSymbolicLink())
        throw new WorkspaceError(
          "Les liens symboliques ne sont pas autorisés.",
        );
      if (index < parts.length - 1 && !stat.isDirectory())
        throw new WorkspaceError("Ce chemin n’est pas un dossier.");
    }
    return target;
  }
  private text(content: string) {
    if (typeof content !== "string")
      throw new WorkspaceError("Contenu texte requis.");
    return content;
  }
  private async file(input: string) {
    const target = await this.resolve(input);
    const handle = await open(
      target,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || (!this.host && stat.nlink !== 1))
        throw new WorkspaceError("Fichier non régulier ou lié.");
      return { target, handle, stat };
    } catch (error) {
      await handle.close();
      throw error;
    }
  }
  info(input: string): Promise<WorkspaceEntry & { text: boolean }> {
    return guarded(async () => {
      const target = await this.resolve(input),
        stat = await lstat(target);
      if (stat.isDirectory())
        return {
          name: path.basename(input),
          path: input,
          kind: "directory",
          size: stat.size,
          revision: digest(`${stat.ino}:${stat.mtimeMs}`),
          updatedAt: stat.mtime.toISOString(),
          text: false,
        };
      const file = await this.file(input),
        hash = createHash("sha256"),
        decoder = new TextDecoder("utf-8", { fatal: true });
      let text = true;
      try {
        for await (const chunk of file.handle.createReadStream({
          autoClose: false,
        })) {
          hash.update(chunk);
          if (text)
            try {
              decoder.decode(chunk, { stream: true });
              if (chunk.includes(0)) text = false;
            } catch {
              text = false;
            }
        }
        if (text)
          try {
            decoder.decode();
          } catch {
            text = false;
          }
        return {
          name: path.basename(input),
          path: input,
          kind: "file",
          size: file.stat.size,
          revision: hash.digest("hex"),
          updatedAt: file.stat.mtime.toISOString(),
          text,
        };
      } finally {
        await file.handle.close();
      }
    });
  }
  download(input: string) {
    return guarded(async () => {
      const file = await this.file(input);
      const entry: WorkspaceEntry = {
        name: path.basename(input),
        path: input,
        kind: "file",
        size: file.stat.size,
        revision: "",
        updatedAt: file.stat.mtime.toISOString(),
      };
      return {
        entry,
        body: (async function* () {
          try {
            for await (const chunk of file.handle.createReadStream({
              autoClose: false,
            }))
              yield chunk;
          } finally {
            await file.handle.close();
          }
        })(),
      };
    });
  }
  import(input: string, body: AsyncIterable<Uint8Array>, revision?: string) {
    return guarded(async () => {
      const target = await this.resolve(input, true),
        temporary = path.join(
          path.dirname(target),
          `.heart-${randomUUID()}.tmp`,
        );
      let attributes:{mode:number;uid:number;gid:number}|undefined;
      if(revision!==undefined){const current=await this.file(input);attributes={mode:current.stat.mode&0o7777,uid:current.stat.uid,gid:current.stat.gid};await current.handle.close();}
      try {
        const handle = await open(temporary, "wx", 0o600);
        try {
          for await (const chunk of body) {
            let position = 0;
            while (position < chunk.length) {
              const result = await handle.write(
                chunk,
                position,
                chunk.length - position,
              );
              position += result.bytesWritten;
            }
          }
          if(attributes){
            const owner=await handle.stat();
            if(owner.uid!==attributes.uid||owner.gid!==attributes.gid)await handle.chown(attributes.uid,attributes.gid);
            await handle.chmod(attributes.mode);
          }
          await handle.sync();
        } finally {
          await handle.close();
        }
        if (revision !== undefined) {
          if ((await this.info(input)).revision !== revision)
            throw new WorkspaceError(
              "Le fichier a changé. Recharge-le avant de réessayer.",
            );
          await rename(temporary, target);
        } else {
          await link(temporary, target);
        }
      } finally {
        await unlink(temporary).catch(() => {});
      }
    });
  }
  list(input = "", offset = 0, count = 200) {
    return guarded(async () => {
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(count) ||
        count < 1
      )
        throw new WorkspaceError("Pagination invalide.");
      if (input === ".") input = "";
      const target = await this.resolve(input, false, true);
      const names = (await readdir(target, { withFileTypes: true }))
        .filter(
          (item) =>
            (!item.name.startsWith(".heart-") || this.host) &&
            (item.isFile() || item.isDirectory() || (this.host && item.isSymbolicLink())),
        )
        .sort(
          (a, b) =>
            Number(b.isDirectory()) - Number(a.isDirectory()) ||
            a.name.localeCompare(b.name),
        );
      const entries: WorkspaceEntry[] = [];
      for (const item of names.slice(offset, offset + count)) {
        const relative = input ? path.join(input,item.name) : item.name;
        // Listing includes large/binary files; opening them as text is explicitly refused.
        const stat = this.host && item.isSymbolicLink() ? await fileStat(path.join(target,item.name)).catch(()=>lstat(path.join(target,item.name))) : await lstat(path.join(target, item.name));
        entries.push({
          name: item.name,
          path: relative,
          kind: stat.isDirectory() ? "directory" : "file",
          size: stat.size,
          revision: stat.isDirectory()
            ? digest(`${stat.ino}:${stat.mtimeMs}`)
            : "",
          updatedAt: stat.mtime.toISOString(),
        });
      }
      return {
        entries,
        truncated: offset + entries.length < names.length,
        nextOffset: offset + entries.length,
      };
    });
  }
  read(input: string, offset = 0, length = 64 * 1024) {
    return guarded(async () => {
      if (
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        !Number.isSafeInteger(length) ||
        length < 1
      )
        throw new WorkspaceError("Plage de lecture invalide.");
      const entry = await this.info(input);
      if (!entry.text)
        throw new WorkspaceError(
          "Ce format n’est pas éditable en texte UTF-8. Le fichier reste téléchargeable et déplaçable.",
        );
      const file = await this.file(input);
      try {
        const bytes = Buffer.alloc(
          Math.min(length, Math.max(0, file.stat.size - offset)),
        );
        const { bytesRead } = await file.handle.read(
          bytes,
          0,
          bytes.length,
          offset,
        );
        let end = bytesRead;
        // End each page at a UTF-8 boundary; offsets and nextOffset are byte positions.
        if (offset + end < file.stat.size && end > 0) {
          let start = end - 1;
          while (start > 0 && (bytes[start] & 0xc0) === 0x80) start--;
          const first = bytes[start],
            needed =
              first >= 0xf0 ? 4 : first >= 0xe0 ? 3 : first >= 0xc0 ? 2 : 1;
          if (end - start < needed) end = start;
        }
        if (end === 0 && bytesRead > 0)
          throw new WorkspaceError(
            "La plage coupe un caractère UTF-8. Augmente la longueur de lecture.",
          );
        const content = new TextDecoder("utf-8", {
          fatal: true,
          ignoreBOM: true,
        }).decode(bytes.subarray(0, end));
        return {
          ...entry,
          content,
          offset,
          nextOffset: offset + end,
          truncated: offset + end < file.stat.size,
        };
      } finally {
        await file.handle.close();
      }
    });
  }
  create(input: string, content: string) {
    return guarded(async () => {
      const target = await this.resolve(input, true);
      await writeFile(target, this.text(content), {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
    });
  }
  update(input: string, content: string, revision: string) {
    const bytes = Buffer.from(this.text(content));
    return this.import(
      input,
      (async function* () {
        yield bytes;
      })(),
      revision,
    );
  }
  replace(input:string,before:string,after:string,revision:string){return guarded(async()=>{
    if(typeof before!=="string"||!before.length||typeof after!=="string")throw new WorkspaceError("Texte à remplacer requis.");
    const info=await this.info(input);if(!info.text)throw new WorkspaceError("Une modification ciblée exige un texte UTF-8.");
    if(info.revision!==revision)throw new WorkspaceError("Le fichier a changé. Recharge-le avant de réessayer.");
    const needle=Buffer.from(before),replacement=Buffer.from(after),scan=await this.download(input);
    let tail=Buffer.alloc(0),occurrences=0;
    for await(const chunk of scan.body){const bytes=Buffer.concat([tail,chunk]);let start=0,index:number;
      while((index=bytes.indexOf(needle,start))>=0){if(++occurrences>1)throw new WorkspaceError("Le texte apparaît plusieurs fois. Donne un contexte unique.");start=index+1;}
      tail=Buffer.from(bytes.subarray(Math.max(0,bytes.length-needle.length+1)));
    }
    if(occurrences!==1)throw new WorkspaceError("Texte introuvable ; aucune modification appliquée.");
    const source=await this.download(input);
    const transformed=(async function*(){let carry=Buffer.alloc(0),matches=0;
      for await(const chunk of source.body){let bytes=Buffer.concat([carry,chunk]);let index:number;
        while((index=bytes.indexOf(needle))>=0){if(++matches>1)throw new WorkspaceError("Le texte apparaît plusieurs fois. Donne un contexte unique.");yield bytes.subarray(0,index);yield replacement;bytes=bytes.subarray(index+needle.length);}
        const safe=Math.max(0,bytes.length-needle.length+1);yield bytes.subarray(0,safe);carry=Buffer.from(bytes.subarray(safe));
      }
      if(matches!==1)throw new WorkspaceError("Texte introuvable ; aucune modification appliquée.");yield carry;
    })();
    await this.import(input,transformed,revision);
  });}
  move(input: string, destination: string, revision: string) {
    return guarded(async () => {
      const file = await this.info(input),
        target = await this.resolve(destination, true);
      if (file.revision !== revision)
        throw new WorkspaceError(
          "Le fichier a changé. Recharge-le avant de réessayer.",
        );
      if (file.kind !== "file") throw new WorkspaceError("Choisis un fichier.");
      const source = this.host ? path.join(await realpath(path.dirname(path.resolve(this.workspace,input))),path.basename(input)) : await this.resolve(input);
      await link(source, target); // Exclusive destination: rename() would overwrite it.
      try {
        await unlink(source);
      } catch (error) {
        await unlink(target).catch(() => {});
        throw error;
      }
    });
  }
  remove(input: string, revision: string) {
    return guarded(async () => {
      const entry = await this.info(input);
      if (entry.revision !== revision)
        throw new WorkspaceError(
          "Le fichier a changé. Recharge-le avant de réessayer.",
        );
      const target = this.host ? path.join(await realpath(path.dirname(path.resolve(this.workspace,input))),path.basename(input)) : await this.resolve(input);
      if(this.host&&(await lstat(target)).isSymbolicLink()){await unlink(target);return;}
      if (entry.kind === "directory") await rmdir(target);
      else await unlink(target);
    });
  }
  mkdir(input: string) {
    return guarded(async () => {
      await mkdir(await this.resolve(input, true), { mode: 0o700 });
    });
  }
}

export function fileTools(factory: WorkspaceFilesFactory = workspace=>new LocalFiles(workspace), host = false): Tool[] {
  // Tool receipts are short and run-local; storage/UI keep their canonical revision.
  const receipts=new Map<string,{path:string;revision:string}>();
  const prefix=randomBytes(6).toString('base64url');let serial=0;
  const action = (
    name: string,
    description: string,
    fields: string[],
    execute: (files: WorkspaceFiles, args: Json) => Promise<unknown>,
  ): Tool => ({
    name,
    description: description + (host ? ' YOLO : chemins absolus acceptés.' : ''),
    permission:
      name === "files.read" || name === "files.list" || name === "files.info"
        ? "files.read"
        : "files.write",
    parameters: {
      type: "object",
      properties: Object.fromEntries(
        fields.map((field):[string,Json] => [
          field,
          ["offset", "length"].includes(field)
            ? { type: "integer", minimum: field === "length" ? 1 : 0 }
            : field === "revision" ? { type:"string", description:"Recopier exactement revision de files.read/info pour ce chemin." } : { type: "string" },
        ]),
      ) as Record<string, Json>,
      required: fields.filter(
        (field) =>
          !(name === "files.list" && field === "path") &&
          !["offset", "length"].includes(field),
      ),
      additionalProperties: false,
    },
    async execute(args, context) {
      context.signal?.throwIfAborted();
      let input=args;
      const filePath=name==='files.list'?'':argument(args,'path');
      const key=path.resolve(context.workspace,filePath);
      if(fields.includes('revision')){
        const revision=argument(args,'revision'),receipt=receipts.get(revision);
        if(receipt){
          if(receipt.path!==key)throw new WorkspaceError('Cette revision appartient à un autre chemin. Relis le fichier.');
          input={...(args as Record<string,Json>),revision:receipt.revision};
        }else if(!/^[a-f0-9]{64}$/.test(revision))throw new WorkspaceError('Référence de lecture inconnue ou expirée. Relis ce chemin avec files.read/info.');
      }
      const result=await execute(factory(context.workspace,context.signal),input);
      if((name==='files.read'||name==='files.info')&&result&&typeof result==='object'&&'revision' in result&&typeof result.revision==='string'){
        const receipt=`r-${prefix}-${++serial}`;
        receipts.set(receipt,{path:key,revision:result.revision});
        return JSON.stringify({...result,revision:receipt});
      }
      return JSON.stringify(result??{ok:true});
    },
  });
  return [
    action(
      "files.list",
      "Lister un dossier paginé (offset/length, 200 par défaut). path vide = départ ; nextOffset/truncated pour poursuivre.",
      ["path", "offset", "length"],
      async (files, args) =>
        files.list(
          (args as Record<string, Json>)?.path as string | undefined,
          (args as Record<string, Json>).offset as number | undefined,
          (args as Record<string, Json>).length as number | undefined,
        ),
    ),
    action(
      "files.read",
      "Lire un texte UTF-8 paginé en octets (offset/length, 65536 par défaut). revision de lecture ; nextOffset/truncated pour poursuivre.",
      ["path", "offset", "length"],
      (files, args) =>
        files.read(
          argument(args, "path"),
          (args as Record<string, Json>).offset as number | undefined,
          (args as Record<string, Json>).length as number | undefined,
        ),
    ),
    action(
      "files.info",
      "Obtenir taille, type et référence de revision de tout fichier, sans charger son contenu.",
      ["path"],
      (files, args) => files.info(argument(args, "path")),
    ),
    action(
      "files.create",
      "Créer un fichier UTF-8 sans écraser un fichier existant. Le parent doit exister.",
      ["path", "content"],
      (files, args) =>
        files.create(argument(args, "path"), argument(args, "content")),
    ),
    action(
      "files.update",
      "Remplacer un texte UTF-8 avec la revision exacte du même fichier.",
      ["path", "content", "revision"],
      (files, args) =>
        files.update(
          argument(args, "path"),
          argument(args, "content"),
          argument(args, "revision"),
        ),
    ),
    action("files.replace","Remplacer before par after une seule fois, avec revision courante. Zéro ou plusieurs occurrences : refus sans modification.",["path","before","after","revision"],(files,args)=>files.replace(argument(args,"path"),argument(args,"before"),argument(args,"after"),argument(args,"revision"))),
    action(
      "files.move",
      "Déplacer ou renommer un fichier vers une destination libre, avec sa revision.",
      ["path", "destination", "revision"],
      (files, args) =>
        files.move(
          argument(args, "path"),
          argument(args, "destination"),
          argument(args, "revision"),
        ),
    ),
    action(
      "files.delete",
      "Supprimer un fichier ou dossier vide, avec sa revision courante.",
      ["path", "revision"],
      (files, args) =>
        files.remove(argument(args, "path"), argument(args, "revision")),
    ),
    action(
      "files.mkdir",
      "Créer un dossier dans le workspace, sans remplacer un chemin existant.",
      ["path"],
      (files, args) => files.mkdir(argument(args, "path")),
    ),
  ];
}
