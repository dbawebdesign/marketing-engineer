/** Who stands behind a doc version, in a few words: "Approved by Maya · Market pulse", "Edited by Maya". */
export function creditFor(v: { author_kind: string; person: string | null; agent: string | null; note?: string | null } | null | undefined) {
  if (!v) return null;
  if (v.author_kind === "agent") {
    if (v.person) return `Approved by ${v.person}${v.agent ? ` · ${v.agent}` : ""}`;
    return v.agent ?? "Agent";
  }
  if (v.author_kind === "user") return v.person ? `Edited by ${v.person}` : "Edited";
  return "Setup";
}
