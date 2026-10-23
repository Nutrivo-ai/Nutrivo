// The shell's routes against spec/screens.yaml (T-102, docs/20 §4): every workspace route of a BUILD screen has a page,
// no page exists that the inventory does not name, roles and titles match, and the rail only links to real routes.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadScreens } from "../../../tests/visual/screens";
import { NAV, ROLES, WORKSPACE_ROUTES, hrefFor, matchRoute, roleAllows, routeFor, switchHref, type Role } from "./routes";

const APP = path.resolve(__dirname, "../../app");
const screens = loadScreens();
// Access removed and Dormant workspace (kind auth) replace the shell rather than render in it: T-103 builds them.
const inShell = screens.filter((s) => s.route?.startsWith("/w/") && s.scope === "build" && s.kind !== "auth");

function pages(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return pages(full);
    return entry.name === "page.tsx" ? [`/${path.relative(APP, dir).split(path.sep).join("/")}`] : [];
  });
}

describe("workspace routes (T-102)", () => {
  it("every BUILD screen inside a workspace has its route, and every route only its own screens", () => {
    const listed = new Map(WORKSPACE_ROUTES.flatMap((r) => r.screens.map((id) => [id, r.route] as const)));
    for (const screen of inShell) expect(listed.get(screen.id), screen.id).toBe(screen.route);
    expect([...listed.keys()].sort()).toEqual(inShell.map((s) => s.id).sort());
  });

  it("each route has exactly one page, and there is no page outside the inventory", () => {
    expect(pages(path.join(APP, "w")).sort()).toEqual(WORKSPACE_ROUTES.map((r) => r.route).sort());
    for (const r of WORKSPACE_ROUTES) {
      const source = fs.readFileSync(path.join(APP, r.route.slice(1), "page.tsx"), "utf8");
      expect(source).toContain(`route="${r.route}"`);
    }
  });

  it("titles come from the design and roles are the lowest role of the route's own screens", () => {
    const byId = new Map(screens.map((s) => [s.id, s]));
    for (const r of WORKSPACE_ROUTES) {
      expect(byId.get(r.screens[0])!.title).toBe(r.title);
      const roles = r.screens.map((id) => byId.get(id)!).filter((s) => s.kind === "app").map((s) => s.role as Role);
      const lowest = ROLES.find((role) => roles.includes(role));
      expect(r.role, r.route).toBe(lowest);
    }
  });

  it("the rail keeps Nutrivo 2.0's order and links only to its own screens' routes", () => {
    const nv2 = screens.filter((s) => s.design === "product/Nutrivo 2.0.dc.html");
    const design = fs.readFileSync(path.resolve(__dirname, "../../../../../design", nv2[0].design), "utf8");
    const designOrder = [...design.matchAll(/navItem\("([^"]+)", "(\w+)"/g)].map((m) => m[1]);
    const railOrder = NAV.flatMap((g) => g.items.map((i) => i.label));
    expect(railOrder).toEqual(designOrder.filter((label) => railOrder.includes(label)));
    for (const item of NAV.flatMap((g) => g.items)) {
      const screen = nv2.find((s) => s.id === item.screen)!;
      expect(screen.title).toBe(item.label);
      expect(screen.route).toBe(item.route);
      expect(screen.kind).toBe("app");
      expect(screen.scope).toBe("build");
      expect(item.route.slice("/w/[workspace]".length)).not.toContain("[");
    }
  });

  it("matches pathnames to routes, static segments first", () => {
    expect(matchRoute("/w/abc")?.route).toBe("/w/[workspace]");
    expect(matchRoute("/w/abc/products/new")?.route).toBe("/w/[workspace]/products/new");
    expect(matchRoute("/w/abc/products/p1")?.route).toBe("/w/[workspace]/products/[product]");
    expect(matchRoute("/w/abc/settings/billing/")?.route).toBe("/w/[workspace]/settings/billing");
    expect(matchRoute("/w/abc/nowhere")).toBeNull();
  });

  it("switching keeps the section and never carries an id from the workspace being left", () => {
    expect(switchHref("/w/a/library/terms", "b")).toBe("/w/b/library/terms");
    expect(switchHref("/w/a/products/p1/report", "b")).toBe("/w/b");
    expect(switchHref("/w/a/library/coverage/DE", "b")).toBe("/w/b");
    expect(switchHref("/w/a/unknown", "b")).toBe("/w/b");
    expect(hrefFor("/w/[workspace]/board", "b")).toBe("/w/b/board");
  });

  it("orders roles from viewer to admin", () => {
    expect(roleAllows("admin", "viewer")).toBe(true);
    expect(roleAllows("editor", "editor")).toBe(true);
    expect(roleAllows("viewer", "editor")).toBe(false);
    expect(roleAllows("portfolio_manager", "admin")).toBe(false);
    expect(() => routeFor("/w/[workspace]/nowhere")).toThrow();
  });
});
