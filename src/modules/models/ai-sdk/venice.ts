import type { ModelCapabilities } from "../../../contracts/models.ts";
import type { ProviderUsage } from "../../../contracts/usage.ts";

/** One read-only request, available to inference keys. Billing endpoints require an admin key. */
export async function readVeniceUsage(
  apiKey: string,
  modelId: string,
  transport: typeof fetch = globalThis.fetch,
): Promise<ProviderUsage> {
  const base: ProviderUsage = {
    provider: "venice", modelId, status: "unavailable", observedAt: new Date().toISOString(),
    source: "Venice GET /api/v1/api_keys/rate_limits",
    message: "Solde et limites Venice indisponibles.",
    dashboardUrl: "https://venice.ai/settings/api",
  };
  const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined;
  try {
    const response = await transport("https://api.venice.ai/api/v1/api_keys/rate_limits", {
      method: "GET", headers: { Authorization: "Bearer " + apiKey }, redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return base;
    const { data } = await response.json();
    if (!data || typeof data !== "object" || !data.balances || typeof data.balances !== "object") return base;
    const result: ProviderUsage = { ...base, message: "Soldes du compte, partagés entre modèles et clés. Historique des dépenses non disponible avec la clé d’inférence : Venice exige une clé administrateur. Aucun appel au modèle." };
    const usd = number(data.balances.USD);
    if (usd !== undefined) result.balance = { remaining: usd, currency: "USD", scope: "account", label: "Solde USD" };
    const nextEpoch = typeof data.nextEpochBegins === "string" && Number.isFinite(Date.parse(data.nextEpochBegins))
      ? new Date(data.nextEpochBegins).toISOString() : undefined;
    const details: NonNullable<ProviderUsage["balanceDetails"]> = [];
    for (const [key, label, unit] of [["DIEM", "DIEM disponibles", "DIEM"], ["BUNDLED_CREDITS", "Crédits inclus · solde API", "unités"], ["EARNED_CREDITS", "Crédits gagnés · solde API", "unités"]]) {
      const remaining = number(data.balances[key]);
      if (remaining !== undefined) details.push({ label, remaining, unit, ...(key === "DIEM" && remaining > 0 && nextEpoch ? { resetsAt: nextEpoch } : {}) });
    }
    if (details.length) result.balanceDetails = details;
    const limits: NonNullable<ProviderUsage["rateLimits"]> = {};
    const selected = Array.isArray(data.rateLimits) ? data.rateLimits.find((item: { apiModelId?: unknown }) => item?.apiModelId === modelId) : undefined;
    for (const limit of Array.isArray(selected?.rateLimits) ? selected.rateLimits : []) {
      const amount = number(limit?.amount);
      if (amount === undefined || !Number.isSafeInteger(amount) || amount < 0) continue;
      if (limit.type === "RPM") limits.requestsPerMinute = amount;
      if (limit.type === "TPM") limits.tokensPerMinute = amount;
    }
    if (Object.keys(limits).length) result.rateLimits = limits;
    if (result.balance || details.length || result.rateLimits) result.status = "available";
    if (data.accessPermitted === false) result.message += " L’accès API est actuellement refusé par Venice.";
    return result;
  } catch { return base; }
}

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
