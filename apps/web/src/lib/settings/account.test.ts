import { describe, expect, it } from "vitest";
import { browserOf, channelsText, leavingText } from "./account";

describe("Your account (S-WSS-006)", () => {
  it("names this browser from its User-Agent, as the design's session list does", () => {
    expect(browserOf("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36")).toBe("Chrome on macOS");
    expect(browserOf("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")).toBe("Safari on iOS");
    expect(browserOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0")).toBe("Firefox on Windows");
    expect(browserOf("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0")).toBe("Edge on Windows");
    expect(browserOf("")).toBe("A browser");
  });
});

describe("Your account wording", () => {
  const ws = { workspaceId: "w", name: "Halden Pet Nutrition", role: "admin" as const, regions: ["EU"] };
  it("states each notification's channels, a missing preference meaning on", () => {
    expect(channelsText({ email: true, inApp: true })).toBe("EMAIL + IN APP");
    expect(channelsText({ email: false, inApp: true })).toBe("IN APP ONLY");
    expect(channelsText({ email: true, inApp: false })).toBe("EMAIL ONLY");
    expect(channelsText({ email: false, inApp: false })).toBe("OFF");
    expect(channelsText(null)).toBe("OFF");
  });
  it("[A05.must.1] tells the only admin that somebody else must be made admin before they can leave", () => {
    expect(leavingText(ws, 0)).toBe(
      "You are the only admin, so somebody else has to be made admin before you can leave. Your name stays on the work you did either way.",
    );
    expect(leavingText(ws, 1)).toMatch(/^Another admin of Halden Pet Nutrition can remove you/);
    expect(leavingText({ ...ws, role: "editor" }, 1)).toMatch(/^An admin of Halden Pet Nutrition removes you/);
    expect(leavingText(null, 0)).toBeNull();
  });
});
