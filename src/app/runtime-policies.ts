import {
  defaultRuntimePolicies,
  type PolicyOverrides,
  type PolicySection,
  type RuntimePolicies,
} from "../contracts/policies.ts";
export { defaultRuntimePolicies };
export function validatePolicyOverrides(value: unknown): PolicyOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Limites invalides.");
  const overrides: Record<string, Record<string, number>> = {};
  for (const [section, fields] of Object.entries(value)) {
    if (
      !Object.hasOwn(defaultRuntimePolicies, section) ||
      !fields ||
      typeof fields !== "object" ||
      Array.isArray(fields)
    )
      throw new Error("Limites invalides.");
    const defaults = defaultRuntimePolicies[
        section as PolicySection
      ] as unknown as Record<string, number>,
      changed: Record<string, number> = {};
    for (const [field, n] of Object.entries(fields)) {
      if (
        !Object.hasOwn(defaults, field) ||
        !Number.isSafeInteger(n) ||
        (n as number) < 0 ||
        (field === "recentTurns" && (n as number) < 1) ||
        (field === "compressionPercent" &&
          ((n as number) < 1 || (n as number) > 100))
      )
        throw new Error("Limites invalides.");
      if (n !== defaults[field]) changed[field] = n as number;
    }
    if (Object.keys(changed).length) overrides[section] = changed;
  }
  return overrides as PolicyOverrides;
}
export function resolvePolicies(value: unknown = {}): RuntimePolicies {
  const overrides = validatePolicyOverrides(value);
  return Object.fromEntries(
    Object.entries(defaultRuntimePolicies).map(([key, defaults]) => [
      key,
      { ...defaults, ...overrides[key as PolicySection] },
    ]),
  ) as unknown as RuntimePolicies;
}
