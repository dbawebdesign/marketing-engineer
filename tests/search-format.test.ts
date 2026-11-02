import { describe, expect, it } from "vitest";
import { likeEscape, plainSnippet } from "@/server/services/search";
import { platformOf } from "@/lib/draft-meta";

describe("palette search helpers", () => {
  it("escapes LIKE wildcards", () => {
    expect(likeEscape("50%_off\\")).toBe("50\\%\\_off\\\\");
  });
  it("flattens markdown into one line with ellipses at cut ends", () => {
    expect(plainSnippet("## Heading\n**bold** [link](http://x)", true, false)).toBe("Heading bold link…");
    expect(plainSnippet("mid text", false, true)).toBe("…mid text");
  });
});

describe("platformOf", () => {
  it("reads payload.platform, then the Platform meta row", () => {
    expect(platformOf({ platform: "x" })).toBe("x");
    expect(platformOf({ meta: [{ label: "Platform", value: "LinkedIn" }] })).toBe("linkedin");
    expect(platformOf({ meta: [{ label: "Kind", value: "Landing line" }] })).toBeNull();
    expect(platformOf(null)).toBeNull();
  });
});
