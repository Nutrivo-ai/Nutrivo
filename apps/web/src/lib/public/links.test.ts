import { describe, expect, it } from "vitest";
import { startLabel } from "./links";

// The start buttons' label: "Join the pilot" until launch (T-1101), then the design's "Check a label free".
describe("startLabel", () => {
  it("reads \"Join the pilot\" while sign-up is closed (production before launch)", () => {
    expect(startLabel(false)).toBe("Join the pilot");
  });

  it("reads as the design draws it once sign-up opens", () => {
    expect(startLabel(true)).toBe("Check a label free");
  });
});
