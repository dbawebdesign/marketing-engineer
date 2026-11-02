import { describe, expect, it } from "vitest";
import { inferSource } from "@/lib/infer-source";

describe("inferSource", () => {
  it("maps common note openings to a source", () => {
    expect(inferSource("Call with Polar Mechanical: lost a quote")).toBe("sales_call");
    expect(inferSource("Demo with Acme Heating, went well")).toBe("sales_call");
    expect(inferSource("Discovery call — Brightline HVAC")).toBe("sales_call");
    expect(inferSource("Meeting with Jane at Kessler Air")).toBe("sales_call");
    expect(inferSource("Support ticket from Northwind Plumbing: invoices fail")).toBe("support_ticket");
    expect(inferSource("Ticket #4411 — sync broken")).toBe("support_ticket");
    expect(inferSource("Churn reason — Fairway Electric: too expensive")).toBe("churn_note");
    expect(inferSource("Cancelled: Summit Roofing moved to a competitor")).toBe("churn_note");
    expect(inferSource("G2 review from an ops manager: love the reminders")).toBe("review");
    expect(inferSource("Capterra: 4/5, setup was slow")).toBe("review");
    expect(inferSource("Review on Trustpilot — great support")).toBe("review");
    expect(inferSource("NPS comment: would recommend")).toBe("survey");
    expect(inferSource("Customer interview with Dana")).toBe("interview");
    expect(inferSource("LinkedIn comment: we tried this")).toBe("social");
    expect(inferSource("\n\n- Support: login loop again")).toBe("support_ticket");
  });
  it("stays quiet when the opening doesn't say", () => {
    expect(inferSource("They said the follow-up flow is the money.")).toBeNull();
    expect(inferSource("Polar Mechanical — wants follow-up reminders")).toBeNull();
    expect(inferSource("")).toBeNull();
  });
});
