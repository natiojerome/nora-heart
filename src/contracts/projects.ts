export interface Project { id: string; title: string; objective?: string; version?: number; status?: string }
export interface ProjectRepository {
  create(project: Project): Promise<Project>;
  get(id: string): Promise<Project | null>;
  list(): Promise<Project[]>;
}
