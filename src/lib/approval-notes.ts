/**
 * Approvals that take effect at once and can't be undone from the review pane:
 * what to say before acting (`note`) and what ⌘Z says after (`why`).
 */
export type FinalNote = { note: string; why: string };

const FINAL: Record<string, FinalNote> = {
  market_memo: { note: "Updates the truth file", why: "Approving a memo updates the truth file and can’t be undone from here" },
  cockpit_memo: { note: "Publishes the weekly brief", why: "Approving a brief publishes it and can’t be undone from here" },
  creative_batch: { note: "Starts a test", why: "Approving a hook batch starts a test and can’t be undone from here" },
};

export const finalNoteOf = (type: string): FinalNote | null => FINAL[type] ?? null;

/** End a sentence that may already end in punctuation (e.g. a quoted reason) without doubling it. */
export const endSentence = (s: string) => (/[.!?…]["”’)]*\s*$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);
