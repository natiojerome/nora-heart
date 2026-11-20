export type FileAccess = "none" | "read" | "write" | "develop" | "yolo";
export interface WorkspaceEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
  size: number;
  revision: string;
  updatedAt: string;
}
export interface WorkspaceDocument extends WorkspaceEntry {
  content: string;
  offset?: number;
  nextOffset?: number;
  truncated?: boolean;
}
export interface WorkspaceFiles {
  list(
    path?: string,
    offset?: number,
    count?: number,
  ): Promise<{
    entries: WorkspaceEntry[];
    truncated: boolean;
    nextOffset?: number;
  }>;
  info(path: string): Promise<WorkspaceEntry & { text: boolean }>;
  download(
    path: string,
  ): Promise<{ entry: WorkspaceEntry; body: AsyncIterable<Uint8Array> }>;
  import(
    path: string,
    body: AsyncIterable<Uint8Array>,
    revision?: string,
  ): Promise<void>;
  read(
    path: string,
    offset?: number,
    length?: number,
  ): Promise<WorkspaceDocument>;
  create(path: string, content: string): Promise<void>;
  update(path: string, content: string, revision: string): Promise<void>;
  replace(path:string,before:string,after:string,revision:string):Promise<void>;
  move(path: string, destination: string, revision: string): Promise<void>;
  remove(path: string, revision: string): Promise<void>;
  mkdir(path: string): Promise<void>;
}
