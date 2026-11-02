import { describe, expect, it } from "vitest";
import { inferAccount } from "@/lib/infer-account";

describe("inferAccount", () => {
  it("reads the common note prefixes", () => {
    expect(inferAccount("Call with Polar Mechanical: they lost a $48k quote")).toBe("Polar Mechanical");
    expect(inferAccount("Meeting with Brightline HVAC\nNotes...")).toBe("Brightline HVAC");
    expect(inferAccount("Sales call with Jane at Kessler Air (Tue): pricing")).toBe("Kessler Air");
    expect(inferAccount("Polar Mechanical — wants follow-up reminders")).toBe("Polar Mechanical");
    expect(inferAccount("\n\nDemo with Acme Heating, went well")).toBe("Acme Heating");
  });
  it("stays quiet on ordinary notes", () => {
    expect(inferAccount("They said the follow-up flow is the money.")).toBeNull();
    expect(inferAccount("Summary: pricing came up twice")).toBeNull();
    expect(inferAccount("")).toBeNull();
  });
});

describe("inferAccount on labelled notes", () => {
  it("reads the company after a source label", () => {
    expect(inferAccount("Support ticket from Northwind Plumbing: invoices fail")).toBe("Northwind Plumbing");
    expect(inferAccount("Churn reason — Fairway Electric: too expensive")).toBe("Fairway Electric");
    expect(inferAccount("Cancelled: Summit Roofing, moved to a competitor")).toBe("Summit Roofing");
  });
  it("doesn't take the label itself as the account", () => {
    expect(inferAccount("G2 review — love the reminders")).toBeNull();
    expect(inferAccount("Churn reason — too expensive")).toBeNull();
  });
});
