export type DraftMeta = { label: string; value: string }[];

/** payload.meta, when the agent sent a well-formed one. */
export function metaOf(payload: Record<string, unknown> | null | undefined): DraftMeta | undefined {
  const m = payload?.meta;
  if (!Array.isArray(m)) return undefined;
  const rows = m.filter((x): x is { label: string; value: string } => !!x && typeof x.label === "string" && typeof x.value === "string" && !!x.value.trim());
  return rows.length ? rows.slice(0, 6) : undefined;
}

/** "x" or "linkedin" for a social post: payload.platform, or the Platform row of payload.meta. */
export function platformOf(payload: Record<string, unknown> | null | undefined): "x" | "linkedin" | null {
  const raw = typeof payload?.platform === "string" ? payload.platform : metaOf(payload)?.find((m) => m.label.toLowerCase() === "platform")?.value;
  const v = raw?.trim().toLowerCase();
  if (v === "x" || v === "twitter") return "x";
  if (v === "linkedin") return "linkedin";
  return null;
}
