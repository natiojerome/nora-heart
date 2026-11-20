import path from "node:path";
import { mkdir } from "node:fs/promises";
import { writeWebInvitation } from "../app/web-access.ts";

const file = process.env.HARNESS_WEB_INVITE_FILE;
const origin = process.env.HARNESS_WEB_ORIGIN;
if (!file || !origin || !path.isAbsolute(file)) throw new Error("Configurer le chemin privé d’invitation et l’origine web.");
await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
const invite = await writeWebInvitation(file);
// This command is explicit and owner-only; the fragment never enters HTTP logs.
console.log(`${new URL(origin).origin}/#invite=${invite}`);
