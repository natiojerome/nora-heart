import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { LocalSkills } from "../src/modules/skills/local/index.ts";
export async function skillsFixture() {
  const root = await mkdtemp("/tmp/heart-skills-"),
    id = randomUUID(),
    other = randomUUID(),
    manifest = root + "/catalog.json";
  await mkdir(root + "/review/references", { recursive: true });
  await mkdir(root + "/other", { recursive: true });
  const instructions = "SKILL-GUIDANCE-ONLY-ON-DEMAND";
  await writeFile(
    root + "/review/SKILL.md",
    '---\nname: code-review\ndescription: >-\n  Examiner le code\n  et ses bugs.\nmetadata:\n  version: "1.0"\nallowed-tools: "Bash(*)"\n---\n' +
      instructions +
      "\nLire references/report.md et le fichier demandé.",
  );
  await writeFile(
    root + "/review/references/report.md",
    "REFERENCE-REPORT: citer le défaut observable.",
  );
  await writeFile(
    root + "/other/SKILL.md",
    "---\nname: other\ndescription: Autre travail.\n---\nOTHER-INSTRUCTIONS",
  );
  const registrations = [
    { id, path: "review", defaultEnabled: true },
    { id: other, path: "other" },
  ];
  await writeFile(manifest, JSON.stringify(registrations));
  return {
    root,
    id,
    other,
    manifest,
    instructions,
    registrations,
    catalog: new LocalSkills(manifest),
    async close() {
      await rm(root, { recursive: true, force: true });
    },
  };
}
