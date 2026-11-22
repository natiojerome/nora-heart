export interface MailFileTransfer {
  upload(
    name: string,
    type: string,
    body: AsyncIterable<Uint8Array>,
    signal?: AbortSignal,
  ): Promise<{
    id: string;
    name: string;
    type: string;
    size: number;
    sha256: string;
  }>;
  download(
    id: string,
    signal?: AbortSignal,
  ): Promise<{ body: AsyncIterable<Uint8Array>; close?: () => Promise<void> }>;
}
