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
