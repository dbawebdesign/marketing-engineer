/**
 * Guess the account a pasted note is about from its first line:
 * "Call with Polar Mechanical: …", "Meeting with Jane at Polar Mechanical", "Polar Mechanical — …".
 * Null when the line doesn't start with one of those shapes.
 */
export function inferAccount(text: string): string | null {
  const line = text.split("\n").find((l) => l.trim())?.trim() ?? "";
  if (!line) return null;
  let name: string | null = null;
  const withM = line.match(/^(?:(?:sales|discovery|intro|demo|support|churn|qbr|renewal|follow-up)\s+)?(?:call|meeting|chat|demo|interview|sync|notes?)\s+(?:with|w\/)\s+(.+?)(?:\s*[:(—–]|\s-\s|[.,;]|$)/i);
  // "Support ticket from Northwind Plumbing: …", "Churn reason — Fairway Electric: …", "Cancelled: Summit Roofing …"
  const LABEL = String.raw`(?:support\s+)?ticket(?:\s*#?\d+)?|support|churn(?:\s+(?:reason|note))?|cancell?ation|cancell?ed|crm\s+note|note`;
  const fromM = !withM && line.match(new RegExp(String.raw`^(?:${LABEL})\s+(?:from|by|for|re:?)\s+(.+?)(?:\s*[:(—–]|\s-\s|[.,;]|$)`, "i"));
  const labelDash = !withM && !fromM && line.match(new RegExp(String.raw`^(?:${LABEL})\s*[:—–-]\s*([A-Z0-9][^:—–(.,;]{1,60}?)\s*(?:[:(—–]|\s-\s|[.,;])`, "i"));
  if (withM) name = withM[1]!;
  else if (fromM) name = fromM[1]!;
  else if (labelDash) name = labelDash[1]!;
  else if (new RegExp(String.raw`^(?:${LABEL})\b`, "i").test(line)) return null;
  else if (/^(?:g2|capterra|trustpilot|review|nps|survey|tweet|linkedin|reddit)\b/i.test(line)) return null;
  else {
    const dash = line.match(/^([A-Z0-9][^:—–]{1,60}?)\s+[—–-]\s+\S/);
    if (dash) name = dash[1]!;
  }
  if (!name) return null;
  // "Jane Doe at Polar Mechanical" / "Jane from Polar Mechanical": the company is the account.
  const at = name.match(/\s(?:at|from|@)\s+(.+)$/i);
  if (at) name = at[1]!;
  name = name.replace(/\s+(?:today|yesterday|this week|last week)$/i, "").replace(/^the\s+/i, "").trim();
  if (name.length < 2 || name.length > 60 || name.split(/\s+/).length > 6) return null;
  return name;
}
