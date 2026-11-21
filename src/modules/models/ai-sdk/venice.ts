import type { ModelCapabilities } from "../../../contracts/models.ts";

export interface VeniceModel extends ModelCapabilities {
  name: string;
  contextWindow: number;
  supportsTools: boolean;
  vision: boolean;
  pricing: { input: number | null; output: number | null; request: null };
}

/** Public text catalogue. Prices are already USD per million tokens, unlike OpenRouter. */
export async function veniceModels(
  transport: typeof fetch = globalThis.fetch,
): Promise<VeniceModel[]> {
  try {
    const response = await transport(
      "https://api.venice.ai/api/v1/models?type=text",
      {
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      },
    );
    if (!response.ok) throw new Error();
    const body = await response.json();
    if (!Array.isArray(body?.data)) throw new Error();
    const price = (value: unknown) =>
      typeof value === "number" && Number.isFinite(value) && value >= 0
        ? value
        : null;
    const unique = new Map<string, VeniceModel>();
    for (const item of body.data) {
      const spec = item?.model_spec,
        caps = spec?.capabilities;
      const contextWindow =
        spec?.availableContextTokens ?? item?.context_length;
      if (
        item?.type !== "text" ||
        typeof item.id !== "string" ||
        !item.id.trim() ||
        typeof spec?.name !== "string" ||
        !spec.name.trim() ||
        spec.offline === true ||
        !Number.isSafeInteger(contextWindow) ||
        contextWindow < 4096
      )
        continue;
      // Effort values are provider wire values: never invent levels from the model name.
      const reasoningEfforts: string[] =
        caps?.supportsReasoningEffort === true &&
        Array.isArray(caps.reasoningEffortOptions)
          ? [
              ...new Set<string>(
                caps.reasoningEffortOptions.filter(
                  (value: unknown) =>
                    typeof value === "string" &&
                    value.length > 0 &&
                    value.length <= 40,
                ),
              ),
            ]
          : [];
      unique.set(item.id, {
        id: item.id,
        name: spec.name,
        contextWindow,
        supportsTools: caps?.supportsFunctionCalling === true,
        vision: caps?.supportsVision === true,
        reasoningEfforts,
        ...(reasoningEfforts.includes(caps?.defaultReasoningEffort)
          ? { defaultReasoningEffort: caps.defaultReasoningEffort }
          : {}),
        pricing: {
          input: price(spec.pricing?.input?.usd),
          output: price(spec.pricing?.output?.usd),
          request: null,
        },
      });
    }
    return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    throw new Error(
      "Catalogue Venice AI indisponible. Actualise la liste pour réessayer.",
    );
  }
}
