import { describe, expect, it } from "vitest";
import { keepSupported, verifyEvidence, type SignalLite } from "@/server/agents/evidence";

const sig = (id: string, content: string): SignalLite => ({ id, source: "sales_call", content, title: "", url: null, account: null, occurred_at: new Date().toISOString() });
const signals = new Map([
  ["a", sig("a", "The owner said the follow-up quote never gets sent after the tech leaves.")],
  ["b", sig("b", "Emergency dispatch at night is the main pain.")],
]);

describe("receipts", () => {
  it("verifies verbatim quotes, tolerating case, punctuation and smart quotes", () => {
    const v = verifyEvidence([{ signal_id: "a", quote: "the Follow-up quote never gets sent" }], signals);
    expect(v[0]?.verified).toBe(true);
  });

  it("rejects quotes that are not in the cited signal", () => {
    const v = verifyEvidence(
      [
        { signal_id: "b", quote: "the follow-up quote never gets sent" }, // wrong signal
        { signal_id: "a", quote: "customers want better collaboration" }, // invented
        { signal_id: "zzz", quote: "the follow-up quote never gets sent" }, // unknown signal
        { signal_id: "a", quote: "the" }, // too short to mean anything
      ],
      signals,
    );
    expect(v.every((e) => !e.verified)).toBe(true);
  });

  it("drops claims with no verified receipt and counts them", () => {
    const r = keepSupported(
      [
        { claim: "supported", evidence: [{ signal_id: "b", quote: "Emergency dispatch at night" }] },
        { claim: "hallucinated", evidence: [{ signal_id: "b", quote: "they love our pricing page" }] },
        { claim: "no evidence", evidence: [] },
      ],
      signals,
    );
    expect(r.kept.map((k) => k.claim)).toEqual(["supported"]);
    expect(r.dropped).toBe(2);
    expect(r.unverifiedQuotes).toBe(1);
  });

  it("deduplicates identical receipts", () => {
    const v = verifyEvidence(
      [
        { signal_id: "b", quote: "Emergency dispatch at night" },
        { signal_id: "b", quote: "emergency dispatch at night" },
      ],
      signals,
    );
    expect(v).toHaveLength(1);
  });
});
