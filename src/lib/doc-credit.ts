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

/**
 * The doc header's one line, without version numbers (those stay in History):
 * "Updated Nov 2 · Approved by Maya", "Updated Nov 2 · Edited by Maya", "Updated Nov 2".
 */
export function updatedLine(updatedAt: string | Date, v: { author_kind: string; person: string | null } | null | undefined) {
  const d = new Date(updatedAt);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  const when = d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
  const who = !v || !v.person ? null : v.author_kind === "agent" ? `Approved by ${v.person}` : v.author_kind === "user" ? `Edited by ${v.person}` : null;
  return `Updated ${when}${who ? ` · ${who}` : ""}`;
}
