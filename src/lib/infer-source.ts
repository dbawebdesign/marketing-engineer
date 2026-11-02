import type { SIGNAL_SOURCES } from "@/lib/signal-sources";

export type SignalSource = (typeof SIGNAL_SOURCES)[number];

/**
 * Guess where a pasted note came from by how it starts:
 * "Support ticket from…" → support_ticket, "Churn reason —" → churn_note, "G2 review…" → review.
 * Looks at the opening words only, so a sales call that mentions a ticket stays a sales call.
 * Null when the opening doesn't say.
 */
const RULES: [RegExp, SignalSource][] = [
  [/^(?:support\b|ticket\b|zendesk\b|intercom\b|help ?desk\b|bug report\b|\#\d+)/i, "support_ticket"],
  [/^(?:churn(?:ed)?\b|cancel(?:l?ed|lation|ling)?\b|lost (?:customer|account)\b|exit (?:survey|interview)\b|offboard)/i, "churn_note"],
  [/^(?:g2\b|capterra\b|trustpilot\b|app ?store\b|play store\b|google review|yelp\b|(?:\d(?:\.\d)?\s*(?:\/\s*5|stars?)\b)|★|(?:\w+\s+)?reviews?\b)/i, "review"],
  [/^(?:tweet\b|twitter\b|x post\b|linkedin\b|reddit\b|social\b|(?:hacker news|hn)\b)/i, "social"],
  [/^(?:survey\b|nps\b|csat\b|poll\b)/i, "survey"],
  [/^(?:(?:customer|user|research|discovery)\s+interview\b|interview\b)/i, "interview"],
  [/^(?:crm\b|hubspot\b|salesforce\b|account note\b)/i, "crm_note"],
  [/^(?:(?:sales|discovery|intro|demo|qbr|renewal|follow-up|followup)\s+)?(?:call\b|meeting\b|demo\b|sync\b|chat with\b)|^(?:qbr|renewal)\b/i, "sales_call"],
];

export function inferSource(text: string): SignalSource | null {
  const line = text.split("\n").find((l) => l.trim())?.trim() ?? "";
  if (!line) return null;
  // Allow a leading label like "Note 3:" or a bullet before the telling words.
  const head = line.replace(/^(?:[-*•]\s+|note\s*\d*\s*[:.-]\s*)/i, "");
  for (const [re, src] of RULES) if (re.test(head)) return src;
  return null;
}
