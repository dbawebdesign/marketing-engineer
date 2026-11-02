const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Drop a leading "# Title" when the header already shows that title. Render-time only. */
export function withoutTitleH1(body: string, title: string) {
  const m = body.match(/^\s*#\s+(.+?)\s*#*\s*(?:\r?\n|$)/);
  if (!m) return body;
  const h = norm(m[1]!);
  const t = norm(title);
  if (!h || !t || !(h === t || t.startsWith(h) || h.startsWith(t))) return body;
  return body.slice(m[0].length).replace(/^\s*\n/, "");
}
