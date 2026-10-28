import { describe, expect, it } from "vitest";
import { sx } from "./sx";

describe("sx", () => {
  it("turns a design style string into a React style object", () => {
    expect(sx("margin: 18px 0 0; font-size: 42px; -webkit-font-smoothing: antialiased; --gap: 4px")).toMatchObject({
      margin: "18px 0 0",
      fontSize: "42px",
      WebkitFontSmoothing: "antialiased",
      "--gap": "4px",
    });
  });

  it("ignores empty declarations and returns the same object for the same string", () => {
    expect(sx(" ; color: var(--ink);;")).toEqual({ color: "var(--ink)" });
    expect(sx("color: var(--ink)")).toBe(sx("color: var(--ink)"));
  });
});
