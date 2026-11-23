/** Optional, unofficial Venice web bridge. Install the pinned MIT upstream first.
 * The upstream translates JSON tool envelopes; Heart still validates and executes.
 * Never use the upstream installer: it changes OpenCode's defaults and logs content.
 */
import { createServer as httpServer } from 'node:http';
import { createServer } from '../.tools/venice-web/upstream/src/lib/server.mjs';
import { MODELS } from '../.tools/venice-web/upstream/src/lib/models.mjs';
import { mintToken, veneziaFetch } from '../.tools/venice-web/upstream/src/lib/venice.mjs';

const send = (res, status, data) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
};
let catalogue = [];
let refresh;
async function models() {
  if (refresh) return refresh;
  refresh = (async () => {
    const access = await mintToken();
    const response = await veneziaFetch('https://outerface.venice.ai/api/app/models', {
      headers: { authorization: 'Bearer ' + access }, signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error('catalogue-unavailable');
    const body = await response.json();
    if (!Array.isArray(body?.text?.models)) throw new Error('catalogue-invalid');
    const next = body.text.models.filter(m => m.active === true && m.usesCredits === false &&
      !m.staffOnly && !m.alphaAccess && typeof m.id === 'string' &&
      Number.isSafeInteger(m.maxContextLength) && m.maxContextLength >= 4096);
    if (!next.length) throw new Error('catalogue-empty');
    for (const id of Object.keys(MODELS)) delete MODELS[id];
    catalogue = next.map(m => {
      MODELS[m.id] = { name: m.friendly_name, context: m.maxContextLength,
        output: m.maxResponseTokens, reasoning: m.supportsReasoning === true,
        vision: m.supportsMultiModal === true };
      return { id: m.id, name: m.friendly_name, contextWindow: m.maxContextLength,
        supportsTools: true, toolCalling: 'emulated', vision: m.supportsMultiModal === true,
        reasoningEfforts: [], usesCredits: false };
    });
    return catalogue;
  })();
  try { return await refresh; } finally { refresh = undefined; }
}
const upstream = createServer();
const port = Number(process.env.VENICE_WEB_PORT ?? 3456);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid bridge port');
const server = httpServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'GET' && url.pathname === '/health') {
      try { await mintToken(); send(res, 200, { ok: true, provider: 'venice-web' }); }
      catch { send(res, 200, { ok: false, provider: 'venice-web' }); }
      return;
    }
    if (req.method === 'GET' && url.pathname === '/v1/models') {
      send(res, 200, { data: await models() }); return;
    }
    if (req.method !== 'POST' || url.pathname !== '/v1/chat/completions') {
      send(res, 404, { error: { message: 'Route unavailable.' } }); return;
    }
    // Fail closed, including when a formerly free model becomes paid. No API fallback.
    await models();
    await upstream(req, res);
  } catch {
    if (!res.headersSent) send(res, 503, { error: { message: 'Venice web unavailable; check the web session and catalogue.' } });
    else res.end();
  }
});
server.requestTimeout = 0;
server.listen(port, '127.0.0.1');
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close());
