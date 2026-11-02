export const SYSTEM_SLUGS = {
  truth: "customer_truth",
  content: "founder_content",
  outbound: "outbound_signal",
  creative: "creative_testing",
  "ai-search": "ai_search",
  cockpit: "growth_cockpit",
} as const;
export type SystemSlug = keyof typeof SYSTEM_SLUGS;
export const slugForSystem = (s: string) => (Object.entries(SYSTEM_SLUGS).find(([, v]) => v === s)?.[0] ?? "truth") as SystemSlug;
