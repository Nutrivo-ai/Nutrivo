import { describe, expect, it } from "vitest";
import { startLabel } from "./links";

// The e2e build sets NEXT_PUBLIC_SIGNUPS_OPEN=true so the public pages match their design baselines; production
// builds without it until launch (T-1101), so the pre-launch label is checked here.
describe("startLabel", () => {
  it("reads \"Join the pilot\" while sign-up is closed (production before launch)", () => {
    expect(startLabel(false)).toBe("Join the pilot");
  });

  it("reads as the design draws it once sign-up opens", () => {
    expect(startLabel(true)).toBe("Check a label free");
  });
});
