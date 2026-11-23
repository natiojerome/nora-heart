import type { ModelCapabilities } from "../../../contracts/models.ts";

export async function veniceWebConnected(transport: typeof fetch = globalThis.fetch): Promise<boolean> {
  try {
    const response = await transport("http://127.0.0.1:3456/health", {
      redirect: "error", signal: AbortSignal.timeout(2000),
    });
    return response.ok && (await response.json()).ok === true;
  } catch { return false; }
}

export async function veniceWebModels(transport: typeof fetch = globalThis.fetch): Promise<
  (ModelCapabilities & { name: string; supportsTools: boolean; toolCalling: "emulated"; vision: boolean })[]
> {
  try {
    const response = await transport("http://127.0.0.1:3456/v1/models", {
      redirect: "error", signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error();
    const body = await response.json();
    if (!Array.isArray(body.data)) throw new Error();
    return body.data.filter((m: any) => typeof m.id === "string" && m.usesCredits === false &&
      Number.isSafeInteger(m.contextWindow) && m.contextWindow >= 4096).map((m: any) => ({
        id: m.id, name: typeof m.name === "string" ? m.name : m.id, contextWindow: m.contextWindow, supportsTools: true,
        toolCalling: "emulated" as const, vision: m.vision === true, reasoningEfforts: [],
      }));
  } catch { throw new Error("Venice web indisponible. Vérifier le pont local et la session Venice."); }
}
