/** Registration IDs belong to Heart; SKILL.md stays in the portable Agent Skills format. */
export interface SkillSummary {
  id: string;
  name: string;
  displayName?: string;
  description: string;
  revision: string;
  defaultEnabled: boolean;
  problem?: string;
}
export interface SkillDocument {
  id: string;
  name: string;
  revision: string;
  instructions: string;
  resources: string[];
}
export interface SkillResource {
  id: string;
  path: string;
  encoding: "utf8" | "base64";
  content: string;
}
export interface SkillReader {
  load(id: string, revision: string): Promise<SkillDocument>;
  read(id: string, revision: string, path: string): Promise<SkillResource>;
}
export interface SkillCatalog extends SkillReader {
  list(): Promise<SkillSummary[]>;
}
export type SkillOverrides = Record<string, boolean>;
export class SkillError extends Error {}
