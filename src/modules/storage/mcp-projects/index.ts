import type { Json } from '../../../contracts/json.ts';
import type { Project, ProjectRepository } from '../../../contracts/projects.ts';
import { ExternalCallError } from '../../../contracts/external-tools.ts';

export type ProjectsMcpCall = (name: string, args: Record<string, Json>) => Promise<Json>;
/** Maps the remote authority; never writes a local project or retries an effect. */
export class McpProjectsRepository implements ProjectRepository {
  private listing?: Promise<Project[]>;
  constructor(private readonly call: ProjectsMcpCall) {}
  private record(value: unknown): Project {
    const r = value as {id: string; name: string; version: number; status: string; objective?: string};
    if (!r || !/^[0-9a-f-]{36}$/i.test(r.id) || typeof r.name !== 'string' || !Number.isInteger(r.version) || typeof r.status !== 'string')
      throw new Error('Projets MCP : réponse incompatible.');
    return {id: r.id, title: r.name, version: r.version, status: r.status, ...(r.objective ? {objective: r.objective} : {})};
  }
  async create(input: Project): Promise<Project> {
    return this.record(await this.call('projects_create', {
      name: input.title, objective: input.objective || input.title, operationId: input.id,
    }));
  }
  async get(id: string): Promise<Project | null> {
    try { return this.record(await this.call('projects_get', {id})); }
    catch (error) { if (error instanceof ExternalCallError && error.code === 'NOT_FOUND') return null; throw error; }
  }
  list(): Promise<Project[]> {
    // Coalesce only simultaneous requests. No stale cache across remote writes/users.
    if (!this.listing) this.listing = this.readPages().finally(() => {this.listing = undefined;});
    return this.listing.then(items => items.map(item => ({...item})));
  }
  private async readPages(): Promise<Project[]> {
    const items: Project[] = [], seen = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await this.call('projects_search', {limit: 100, ...(cursor ? {cursor} : {})}) as unknown as {items: unknown[]; nextCursor: string | null};
      if (!Array.isArray(page.items) || (page.nextCursor !== null && typeof page.nextCursor !== 'string')) throw new Error('Projets MCP : pagination incompatible.');
      items.push(...page.items.map(item => this.record(item)));
      cursor = page.nextCursor ?? undefined;
      if (cursor && seen.has(cursor)) throw new Error('Projets MCP : pagination incohérente.');
      if (cursor) seen.add(cursor);
    } while (cursor);
    return items;
  }
}
