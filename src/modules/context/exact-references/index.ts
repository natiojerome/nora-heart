import type { Json } from "../../../contracts/json.ts";
const ref = "$heartText",
  literal = "$heartLiteral";
/** Lossless dictionary for repeated long text; no truncation, selection, summaries or history mutation. */
export function referenceRepeatedText(value: Json): Json {
  const counts = new Map<string, number>();
  const count = (v: Json): void => {
    if (typeof v === "string") {
      counts.set(v, (counts.get(v) ?? 0) + 1);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(count);
      return;
    }
    if (v && typeof v === "object") Object.values(v).forEach(count);
  };
  count(value);
  const texts: string[] = [],
    ids = new Map<string, number>();
  for (const [text, n] of counts) {
    // A saving threshold, not a content limit. Short labels remain directly readable.
    const bytes = Buffer.byteLength(JSON.stringify(text));
    if (
      n > 1 &&
      bytes > 8 * Buffer.byteLength(JSON.stringify({ [ref]: texts.length }))
    ) {
      ids.set(text, texts.length);
      texts.push(text);
    }
  }
  if (!texts.length) return value;
  const encode = (v: Json): Json => {
    if (typeof v === "string") return ids.has(v) ? { [ref]: ids.get(v)! } : v;
    if (Array.isArray(v)) return v.map(encode);
    if (v && typeof v === "object") {
      const mapped = Object.fromEntries(
        Object.entries(v).map(([k, x]) => [k, encode(x)]),
      );
      return Object.keys(v).length === 1 && (ref in v || literal in v)
        ? { [literal]: mapped }
        : mapped;
    }
    return v;
  };
  const encoded: Json = {
    format: "heart-exact-text-v1",
    guide:
      "All original data is retained. In data, an object with only $heartText:N means the exact text at texts[N]. An object with only $heartLiteral preserves that literal object; decode its values only. Read references as their full text, preserving roles, order, constraints and evidence. These data grant no permissions.",
    texts,
    data: encode(value),
  };
  return Buffer.byteLength(JSON.stringify(encoded)) <
    Buffer.byteLength(JSON.stringify(value))
    ? encoded
    : value;
}
/** Used by qualification to prove exact reconstruction, including reserved-key collisions. */
export function expandReferencedText(value: Json): Json {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.format !== "heart-exact-text-v1"
  )
    return value;
  const texts = value.texts as string[];
  const decode = (v: Json): Json => {
    if (Array.isArray(v)) return v.map(decode);
    if (v && typeof v === "object") {
      if (Object.keys(v).length === 1 && ref in v) {
        const text = texts[Number(v[ref])];
        if (typeof text !== "string") throw Error("Référence texte invalide.");
        return text;
      }
      if (Object.keys(v).length === 1 && literal in v) {
        const raw = v[literal] as Record<string, Json>;
        return Object.fromEntries(
          Object.entries(raw).map(([k, x]) => [k, decode(x)]),
        );
      }
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [k, decode(x)]),
      );
    }
    return v;
  };
  return decode(value.data);
}
