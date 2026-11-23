import type { ContextExperiments } from "../contracts/context-experiments.ts";
export function contextExperiments(value: unknown): ContextExperiments {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Options de contexte invalides.");
  for (const [key, v] of Object.entries(value))
    if (
      !["measureRequests", "compactProjectReview"].includes(key) ||
      typeof v !== "boolean"
    )
      throw Error("Options de contexte invalides.");
  return { ...value } as ContextExperiments;
}
