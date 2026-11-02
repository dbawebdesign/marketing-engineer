import { describe, expect, it } from "vitest";
import { splitSummary } from "@/lib/answer-summary";
import { endSentence, finalNoteOf } from "@/lib/approval-notes";

describe("splitSummary", () => {
  const intro = "Acme is software for HVAC shops. Acme includes dispatch.";
  it("pulls the shared opening out once", () => {
    const r = splitSummary([`${intro} Pricing is per tech.`, intro, "", `${intro} Summit saved a month.`]);
    expect(r.summary).toBe(intro);
    expect(r.rest).toEqual(["Pricing is per tech.", "", "", "Summit saved a month."]);
  });
  it("leaves answers alone when they share nothing", () => {
    const r = splitSummary(["One thing.", "Another thing."]);
    expect(r.summary).toBeNull();
    expect(r.rest).toEqual(["One thing.", "Another thing."]);
  });
});

describe("approval notes", () => {
  it("names irreversible approvals only", () => {
    expect(finalNoteOf("market_memo")?.note).toBe("Updates the truth file");
    expect(finalNoteOf("post")).toBeNull();
  });
  it("never doubles punctuation", () => {
    expect(endSentence("Lead with the number")).toBe("Lead with the number.");
    expect(endSentence("Why open with a question?")).toBe("Why open with a question?");
    expect(endSentence("Too long.")).toBe("Too long.");
  });
});
