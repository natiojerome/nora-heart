import {defaultRuntimePolicies,type MemoryPolicy} from "../../../contracts/policies.ts";
import { randomUUID } from "node:crypto";
import type { Memory } from "../../../contracts/memory.ts";
import type { MemoryInput, MemoryRecord, MemorySource, StructuredMemoryRepository, StructuredMemoryService } from "../../../contracts/structured-memory.ts";

const stopwords = new Set("alors aussi avec avoir cette comme comment dans depuis donc elle elles encore entre était être fait faire faut leur leurs mais même merci nous notre parce pour pourquoi peux peut quand quelle quelles quels quelque sont sous suis suite tout tous très votre vous veux veut voudrais utiliser continuer continue reprends projet conversation souviens mémoire souvenir memorise mémorise retiens rappelle".split(" "));
export function memoryTerms(query: string,maxTerms=defaultRuntimePolicies.memory.terms): string[] {
  return [...new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])].filter(term => !stopwords.has(term)).slice(0,maxTerms||undefined);
}
const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export class StructuredMemory implements StructuredMemoryService {
  get supportsRestore(){return this.repository.supportsRestore!==false;}
  constructor(private readonly repository: StructuredMemoryRepository,
    private readonly view: { projectId?: string | null; source: MemorySource }, private readonly policy:Pick<MemoryPolicy,"candidates"|"results"|"terms">=defaultRuntimePolicies.memory) {}

  private validate(input: MemoryInput): MemoryInput {
    if (!input || typeof input.title !== "string" || !input.title.trim() || input.title.length > 160
      || typeof input.content !== "string" || !input.content.trim() || input.content.length > 4000
      || !["fact", "preference", "constraint", "decision"].includes(input.kind)) throw new Error("Souvenir invalide : titre, contenu ou type.");
    if ((input.scope !== "personal" && input.scope !== "project")
      || (input.scope === "personal" && input.projectId !== null)
      || (input.scope === "project" && (typeof input.projectId !== "string" || !uuid(input.projectId)))) throw new Error("Portée du souvenir invalide.");
    if (input.scope === "project" && this.view.projectId !== undefined && input.projectId !== this.view.projectId) throw new Error("Souvenir hors du projet courant.");
    if (/-----BEGIN .*PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{20,}|\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}|\bBearer\s+[A-Za-z0-9._~-]{20,}/i.test(input.content + " " + input.title)) throw new Error("Ne pas mémoriser de secret.");
    return { ...input, title: input.title.trim(), content: input.content.trim() };
  }
  async remember(content: string): Promise<Memory> {
    return this.rememberRecord({ title: content.slice(0, 160), content, kind: "fact",
      scope: this.view.projectId ? "project" : "personal", projectId: this.view.projectId ?? null });
  }
  async rememberRecord(input: MemoryInput): Promise<MemoryRecord> {
    const valid = this.validate(input);
    const at = new Date().toISOString();
    return this.repository.create({ ...valid, id: randomUUID(), version: 1, status: "active", source: this.view.source, createdAt: at, updatedAt: at });
  }
  async get(id: string): Promise<MemoryRecord> {
    if (!uuid(id)) throw new Error("Souvenir introuvable.");
    const record = await this.repository.get(id);
    if (!record || (record.scope === "project" && this.view.projectId !== undefined && record.projectId !== this.view.projectId)) throw new Error("Souvenir introuvable.");
    return record;
  }
  async list(includeForgotten = false): Promise<MemoryRecord[]> {
    return this.repository.list({ projectId: this.view.projectId, includeForgotten, limit: 200 });
  }
  async search(query: string): Promise<MemoryRecord[]> {
    if (typeof query !== "string") throw new Error("Recherche mémoire invalide.");
    if(!query.trim())return this.repository.list({projectId:this.view.projectId??null,includeForgotten:false,limit:this.policy.results});
    const terms = memoryTerms(query,this.policy.terms);
    if (!terms.length) return [];
    const candidates = await this.repository.list({ projectId: this.view.projectId ?? null, terms, limit: this.policy.candidates });
    const score = (record: MemoryRecord) => {
      const title = record.title.toLocaleLowerCase(), content = record.content.toLocaleLowerCase();
      return terms.reduce((total, term) => total + (title.includes(term) ? 3 : 0) + (content.includes(term) ? 1 : 0), 0);
    };
    return candidates.map(record => ({ record, score: score(record) })).filter(item => item.score > 0)
      .sort((a,b) => b.score - a.score || b.record.updatedAt.localeCompare(a.record.updatedAt) || a.record.id.localeCompare(b.record.id)).slice(0,this.policy.results||undefined).map(item => item.record);
  }
  async update(id: string, version: number, input: MemoryInput): Promise<MemoryRecord> {
    const valid = this.validate(input);
    const current = await this.get(id);
    return this.replace({ ...current, ...valid }, version);
  }
  async setStatus(id: string, version: number, status: MemoryRecord["status"]): Promise<MemoryRecord> {
    if(status==='active'&&!this.supportsRestore)throw new Error('La mémoire distante ne permet pas de restaurer un souvenir supprimé.');
    if (status !== "active" && status !== "forgotten") throw new Error("État mémoire invalide.");
    return this.replace({ ...await this.get(id), status }, version);
  }
  private async replace(record: MemoryRecord, version: number) {
    if (!Number.isInteger(version) || version < 1) throw new Error("Version mémoire requise.");
    return this.repository.replace({ ...record, version: version + 1, source: this.view.source, updatedAt: new Date().toISOString() }, version);
  }
  async revisions(id: string): Promise<MemoryRecord[]> { await this.get(id); return this.repository.revisions(id); }
}
