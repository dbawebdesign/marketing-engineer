/** The three intro questions on Today and the memory doc each answer lands in. */
export const INTRO_FIELDS = [
  { name: "sell", key: "ai-search/company-facts", doc: "Company facts", label: "What do you sell?", placeholder: "e.g. Scheduling software for dental clinics, $99 a month per location.", rows: 2 },
  { name: "buyers", key: "outbound/icp", doc: "Ideal customer profile", label: "Who buys it?", placeholder: "e.g. Practice managers at clinics with 3–20 chairs. Not solo dentists.", rows: 2 },
  { name: "voice", key: "content/founder-voice", doc: "Founder voice", label: "Paste something you wrote", placeholder: "A post, a customer email, a paragraph from your site. Agents copy how you sound.", rows: 4 },
] as const;
export type IntroName = (typeof INTRO_FIELDS)[number]["name"];
export type IntroAnswers = Partial<Record<IntroName, string>>;
