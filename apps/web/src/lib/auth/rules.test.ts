import { describe, expect, it } from "vitest";
import {
  CONTINUE,
  EXPIRED_LINK,
  callbackFailure,
  checkPassword,
  linkType,
  mfaGate,
  minutesLeft,
  safeNext,
  signInHref,
} from "./rules";

describe("safeNext: where sign-in returns to", () => {
  it("keeps a page of ours, with its query", () => {
    expect(safeNext("/w/abc/board?x=1")).toBe("/w/abc/board?x=1");
  });

  it.each(["//evil.test/w", "/\\evil.test", "https://evil.test/", "javascript:alert(1)", "w/abc", "/w/\u0000x", ""])(
    "never sends anybody off-site: %j falls back",
    (next) => {
      expect(safeNext(next)).toBe(CONTINUE);
    },
  );

  it("falls back when nothing was asked for", () => {
    expect(safeNext(null)).toBe(CONTINUE);
    expect(safeNext(undefined, "/x")).toBe("/x");
  });

  it("carries a page into /sign-in, and leaves the default out", () => {
    expect(signInHref("/w/abc/board")).toBe("/sign-in?next=%2Fw%2Fabc%2Fboard");
    expect(signInHref(CONTINUE)).toBe("/sign-in");
    expect(signInHref("//evil.test")).toBe("/sign-in");
  });
});

describe("checkPassword: S-REC-002", () => {
  it("[A07.main] accepts twelve characters or more, typed twice", () => {
    expect(checkPassword("twelve chars", "twelve chars")).toEqual({ ok: true, strength: "fair" });
  });

  it("reads a passphrase of four words as strong, with no symbol demanded", () => {
    expect(checkPassword("copper kettle river lamp", "copper kettle river lamp")).toEqual({ ok: true, strength: "strong" });
  });

  it("refuses a short password, a mismatch and one bcrypt would cut", () => {
    expect(checkPassword("short", "short")).toEqual({ ok: false, problem: "short" });
    expect(checkPassword("twelve chars", "twelve charz")).toEqual({ ok: false, problem: "mismatch" });
    expect(checkPassword("x".repeat(73), "x".repeat(73))).toEqual({ ok: false, problem: "long" });
  });
});

describe("mfaGate: two-step at sign-in", () => {
  it("[A02.fail.2] a signer without TOTP enrols before entering a workspace", () => {
    expect(mfaGate({ currentLevel: "aal1", nextLevel: "aal1" }, true)).toBe("enrol");
  });

  it("[A02.must.2] a person with a verified factor proves it before anything else (aal2)", () => {
    expect(mfaGate({ currentLevel: "aal1", nextLevel: "aal2" }, true)).toBe("challenge");
    expect(mfaGate({ currentLevel: "aal1", nextLevel: "aal2" }, false)).toBe("challenge");
  });

  it("[A02.must.2] a signer at aal2 goes on", () => {
    expect(mfaGate({ currentLevel: "aal2", nextLevel: "aal2" }, true)).toBe("ok");
  });

  it("a person without signing authority or a factor is not forced to enrol", () => {
    expect(mfaGate({ currentLevel: "aal1", nextLevel: "aal1" }, false)).toBe("ok");
  });
});

describe("callbackFailure: email links", () => {
  it("[A07.fail.1] an expired or used link lands on the Account Recovery page", () => {
    const expired = new URLSearchParams("error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid");
    expect(callbackFailure(expired)).toBe(EXPIRED_LINK);
  });

  it("[A07.fail.1] a link carrying nothing to verify is treated as expired", () => {
    expect(callbackFailure(new URLSearchParams(""))).toBe(EXPIRED_LINK);
  });

  it("lets a code or a token hash through to be verified", () => {
    expect(callbackFailure(new URLSearchParams("code=abc"))).toBeNull();
    expect(callbackFailure(new URLSearchParams("token_hash=abc&type=recovery"))).toBeNull();
  });

  it("verifies only the email-link types it knows", () => {
    expect(linkType("recovery")).toBe("recovery");
    expect(linkType("magiclink")).toBe("magiclink");
    expect(linkType("sms")).toBeNull();
    expect(linkType(null)).toBeNull();
  });
});

describe("minutesLeft: the reset link's hour", () => {
  const sent = "2026-10-23T10:00:00Z";
  it("counts down from an hour after the reset was asked for", () => {
    expect(minutesLeft(sent, Date.parse("2026-10-23T10:13:30Z"))).toBe(47);
  });

  it("never reads below zero, and says nothing without a time", () => {
    expect(minutesLeft(sent, Date.parse("2026-10-23T12:00:00Z"))).toBe(0);
    expect(minutesLeft(null, 0)).toBeNull();
    expect(minutesLeft("not a date", 0)).toBeNull();
  });
});
