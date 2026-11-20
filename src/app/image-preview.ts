/** Read a bounded signature, then stream the original bytes without buffering the file. */
export async function imagePreview(source: AsyncIterable<Uint8Array>, name: string) {
  const iterator = source[Symbol.asyncIterator]();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (length < 1024) {
      const next = await iterator.next();
      if (next.done) break;
      chunks.push(next.value);
      length += next.value.byteLength;
    }
    const prefix = Buffer.concat(chunks.map(chunk => Buffer.from(chunk.subarray(0, 1024)))).subarray(0, 1024);
    let mediaType: string | undefined;
    if (prefix.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) mediaType = 'image/png';
    else if (prefix[0] === 255 && prefix[1] === 216 && prefix[2] === 255) mediaType = 'image/jpeg';
    else if (/^GIF8[79]a/.test(prefix.toString('ascii', 0, 6))) mediaType = 'image/gif';
    else if (prefix.toString('ascii', 0, 4) === 'RIFF' && prefix.toString('ascii', 8, 12) === 'WEBP') mediaType = 'image/webp';
    else if (prefix.toString('ascii', 4, 8) === 'ftyp' && /avif|avis/.test(prefix.toString('ascii', 8, 32))) mediaType = 'image/avif';
    else if (/\.svg$/i.test(name) && /^\s*(?:<\?xml[^?]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg(?:\s|>)/i.test(prefix.toString('utf8').replace(/^\uFEFF/, ''))) mediaType = 'image/svg+xml';
    if (!mediaType) throw new Error('Ce fichier ne peut pas être affiché comme image.');
    return {
      mediaType,
      close: async () => { await iterator.return?.(); },
      async *body() {
        try {
          for (const chunk of chunks) yield chunk;
          for (;;) { const next = await iterator.next(); if (next.done) break; yield next.value; }
        } finally { await iterator.return?.(); }
      },
    };
  } catch (error) { await iterator.return?.(); throw error; }
}
