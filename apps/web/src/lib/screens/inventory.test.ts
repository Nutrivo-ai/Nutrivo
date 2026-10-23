// spec/screens.yaml against design/ and docs/workflows/ (T-012, docs/20 §2): every frame the designs switch to is
// inventoried exactly once, and every entry points at a real design file, workflow and baseline.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadScreens, REPO_ROOT, type Screen } from "../../../tests/visual/screens";

const screens = loadScreens();
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
const manifest = new Set((JSON.parse(read("design/MANIFEST.json")) as { files: { path: string }[] }).files.map((f) => f.path));

const KINDS = ["app", "admin", "auth", "public", "moment", "email", "document", "catalogue"];
const ROLES = ["anon", "authenticated", "viewer", "editor", "portfolio_manager", "admin", "staff", "supplier_link", "none"];
const STATES = ["loaded", "empty", "loading", "error", "no-permission", "rendered"];
const NOT_ROUTES = ["email", "document", "catalogue"];

const all = (re: RegExp, src: string) => [...src.matchAll(re)].map((m) => m[1]);
const order = (src: string) => all(/"(\w+)"/g, src.match(/const ORDER = \[([^\]]*)\]/)?.[1] ?? "");
const tuples = (src: string) => all(/\[\s*"([a-z]+)",\s*"[A-Z][^"]*"/g, src);
const topLevel = (src: string) => all(/^ {2}(\w+): \{$/gm, src);

// Each design file that switches between frames, the state key it switches and the values its own controls set.
const SWITCHES: { design: string; key: string; values: (src: string) => string[] }[] = [
  { design: "product/Nutrivo 2.0.dc.html", key: "screen", values: (s) => all(/navItem\("[^"]+", "(\w+)"/g, s) },
  { design: "product/Nutrivo - Missing Surfaces.dc.html", key: "screen", values: order },
  { design: "product/Nutrivo Account Recovery.dc.html", key: "screen", values: order },
  { design: "product/Nutrivo Billing Settings.dc.html", key: "screen", values: tuples },
  { design: "product/Nutrivo Plans and Checkout.dc.html", key: "screen", values: tuples },
  { design: "product/Nutrivo Workspace Settings.dc.html", key: "screen", values: (s) => [...tuples(s), ...all(/this\.go\("(\w+)"\)/g, s)] },
  { design: "product/Nutrivo Partner Tier.dc.html", key: "screen", values: tuples },
  { design: "product/Nutrivo Partner Upsell.dc.html", key: "screen", values: tuples },
  { design: "product/Nutrivo Onboarding Flow.dc.html", key: "step", values: () => ["1", "2", "3", "4", "5", "6"] },
  { design: "product/Nutrivo Onboarding Flow.dc.html", key: "screen", values: (s) => all(/screen === "(\w+)"/g, s) },
  { design: "public/Nutrivo FAQ and About.dc.html", key: "page", values: tuples },
  { design: "public/Nutrivo Legal - Terms, DPA, Privacy.dc.html", key: "doc", values: order },
  { design: "public/Nutrivo Segment Pages.dc.html", key: "seg", values: topLevel },
  { design: "public/Nutrivo Email Templates.dc.html", key: "pick", values: topLevel },
];

describe("spec/screens.yaml (T-012)", () => {
  it("has unique ids, each with its own baseline path", () => {
    const ids = screens.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of screens) {
      expect(s.id).toMatch(/^S-[A-Z0-9]{3}-\d{3}$/);
      expect(s.baseline).toBe(`apps/web/tests/visual/baselines/${s.id}.png`);
    }
  });

  it.each(screens.map((s) => [s.id, s] as [string, Screen]))("%s is well formed and its baseline exists", (_, s) => {
    expect(manifest.has(s.design), `${s.design} in design/MANIFEST.json`).toBe(true);
    expect(fs.existsSync(path.join(REPO_ROOT, "design", s.design))).toBe(true);
    expect(KINDS).toContain(s.kind);
    expect(ROLES).toContain(s.role);
    expect(["build", "later"]).toContain(s.scope);
    expect(typeof s.state).toBe("object");
    for (const w of s.workflows) expect(fs.existsSync(path.join(REPO_ROOT, "docs/workflows", `${w}.md`)), w).toBe(true);
    for (const st of s.states) expect(STATES).toContain(st);
    expect(s.viewports.length).toBeGreaterThan(0);
    for (const v of s.viewports) expect([1600, 390]).toContain(v);
    if (s.viewports.includes(390)) expect(s.element, "a phone frame is captured as an element").toBeDefined();
    if (NOT_ROUTES.includes(s.kind)) expect(s.route).toBeNull();
    if (["app", "admin", "auth", "public"].includes(s.kind)) expect(s.route).toMatch(/^\//);
    if (s.route?.startsWith("/w/[workspace]")) expect(["viewer", "editor", "portfolio_manager", "admin", "authenticated"]).toContain(s.role);
    if (s.route?.startsWith("/admin")) expect(s.role).toBe("staff");
    expect(fs.existsSync(path.join(REPO_ROOT, s.baseline)), `${s.baseline}: run pnpm baselines`).toBe(true);
  });

  it("covers every design file in product/, public/ and documents/", () => {
    const designed = [...manifest].filter((p) => /^(product|public|documents)\/.*\.dc\.html$/.test(p));
    const inventoried = new Set(screens.map((s) => s.design));
    expect(designed.filter((p) => !inventoried.has(p))).toEqual([]);
  });

  it.each(SWITCHES.map((w) => [`${w.design} · ${w.key}`, w] as const))("inventories every frame of %s", (_, w) => {
    const values = [...new Set(w.values(read(`design/${w.design}`)))];
    expect(values.length).toBeGreaterThan(1);
    const inventoried = screens.filter((s) => s.design === w.design && s.state[w.key] != null).map((s) => String(s.state[w.key]));
    expect(inventoried.sort()).toEqual(values.sort());
  });

  it("inventories each of the 6 phones in the Mobile file", () => {
    const src = read("design/product/Nutrivo Mobile.dc.html");
    const phones = all(/phone\(\{ chrome: "[^"]*"[^)]*?label: "([^"]+)"/g, src);
    const mobile = screens.filter((s) => s.design === "product/Nutrivo Mobile.dc.html");
    expect(mobile.map((s) => s.title)).toEqual(phones);
    expect(mobile.map((s) => s.element?.nth)).toEqual(phones.map((_, i) => i));
  });
});
