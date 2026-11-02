export type DraftMeta = { label: string; value: string }[];

/** payload.meta, when the agent sent a well-formed one. */
export function metaOf(payload: Record<string, unknown> | null | undefined): DraftMeta | undefined {
  const m = payload?.meta;
  if (!Array.isArray(m)) return undefined;
  const rows = m.filter((x): x is { label: string; value: string } => !!x && typeof x.label === "string" && typeof x.value === "string" && !!x.value.trim());
  return rows.length ? rows.slice(0, 6) : undefined;
}
