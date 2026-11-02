export const SIGNAL_SOURCES = ["sales_call", "support_ticket", "churn_note", "crm_note", "review", "social", "interview", "product_event", "survey", "other"] as const;
export const SOURCE_LABEL: Record<(typeof SIGNAL_SOURCES)[number], string> = {
  sales_call: "Sales call",
  support_ticket: "Support ticket",
  churn_note: "Churn note",
  crm_note: "CRM note",
  review: "Review",
  social: "Social",
  interview: "Interview",
  product_event: "Product event",
  survey: "Survey",
  other: "Other",
};
export const sourceLabel = (s: string | undefined | null) => (s ? (SOURCE_LABEL[s as keyof typeof SOURCE_LABEL] ?? s.replace(/_/g, " ")) : "");
