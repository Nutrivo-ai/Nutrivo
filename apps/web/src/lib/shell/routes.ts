// The workspace routes of spec/screens.yaml (scope build) and the left rail of Nutrivo 2.0 (T-102, docs/20 §4).
// routes.test.ts keeps both in step with spec/screens.yaml and with the pages under src/app/w/[workspace].

/** app.memberships.role, lowest first, as spec/screens.yaml orders them ("lowest role that sees it"). */
export const ROLES = ["viewer", "editor", "portfolio_manager", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  viewer: "viewer",
  editor: "editor",
  portfolio_manager: "portfolio manager",
  admin: "admin",
};

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export function roleAllows(role: Role, needed: Role) {
  return ROLES.indexOf(role) >= ROLES.indexOf(needed);
}

export type WorkspaceRoute = {
  /** The route as spec/screens.yaml writes it. */
  route: string;
  /** The screens of spec/screens.yaml drawn at this route, the Nutrivo 2.0 frame first. */
  screens: string[];
  /** The screen's title in its design file. */
  title: string;
  /** The mono line above the title: the rail group the screen sits in. */
  crumb: string;
  /** The lowest role that sees the route's own screens (spec/screens.yaml). */
  role: Role;
};

export const WORKSPACE_ROUTES: WorkspaceRoute[] = [
  { route: "/w/[workspace]", screens: ["S-NV2-001", "S-ONB-007"], title: "Home", crumb: "Start", role: "viewer" },
  { route: "/w/[workspace]/products/[product]/check", screens: ["S-NV2-002", "S-PLN-004", "S-PLN-005"], title: "Upload & scope", crumb: "Check your label", role: "editor" },
  { route: "/w/[workspace]/products/[product]/report", screens: ["S-NV2-003"], title: "Label report", crumb: "Check your label", role: "viewer" },
  { route: "/w/[workspace]/briefs/[product]", screens: ["S-NV2-004"], title: "Brief & formula", crumb: "New product", role: "editor" },
  { route: "/w/[workspace]/briefs/[product]/envelope", screens: ["S-NV2-005"], title: "Design envelope", crumb: "New product", role: "viewer" },
  { route: "/w/[workspace]/board", screens: ["S-NV2-006", "S-MIS-003", "S-MOB-001"], title: "Board", crumb: "Portfolio", role: "viewer" },
  { route: "/w/[workspace]/products/[product]/nodes/[node]", screens: ["S-NV2-007", "S-MOB-003"], title: "Product × node", crumb: "Portfolio", role: "viewer" },
  { route: "/w/[workspace]/obligations", screens: ["S-NV2-008"], title: "Obligations", crumb: "Portfolio", role: "viewer" },
  { route: "/w/[workspace]/certificates", screens: ["S-NV2-009"], title: "Certificates", crumb: "Portfolio", role: "viewer" },
  { route: "/w/[workspace]/documents", screens: ["S-NV2-010"], title: "Documents", crumb: "Portfolio", role: "viewer" },
  { route: "/w/[workspace]/screening", screens: ["S-NV2-011"], title: "Ingredients & formulas", crumb: "Screening", role: "editor" },
  { route: "/w/[workspace]/library/terms", screens: ["S-NV2-012"], title: "Term register", crumb: "Library", role: "viewer" },
  { route: "/w/[workspace]/library/coverage", screens: ["S-NV2-013"], title: "Coverage & confidence", crumb: "Library", role: "viewer" },
  { route: "/w/[workspace]/library/suppliers", screens: ["S-NV2-014"], title: "Suppliers", crumb: "Library", role: "viewer" },
  { route: "/w/[workspace]/monitoring", screens: ["S-NV2-015"], title: "Monitoring & alerts", crumb: "Operations", role: "viewer" },
  { route: "/w/[workspace]/settings", screens: ["S-NV2-017"], title: "Settings & roles", crumb: "Operations", role: "admin" },
  { route: "/w/[workspace]/exports", screens: ["S-NV2-018"], title: "Exports", crumb: "Operations", role: "viewer" },
  { route: "/w/[workspace]/markets", screens: ["S-NV2-019"], title: "Jurisdiction tree", crumb: "Jurisdictions", role: "viewer" },
  { route: "/w/[workspace]/products/[product]/nodes/[node]/registration", screens: ["S-NV2-020"], title: "Registration pack", crumb: "Jurisdictions", role: "viewer" },
  { route: "/w/[workspace]/library/coverage/[node]", screens: ["S-NV2-021"], title: "Coverage node", crumb: "Jurisdictions", role: "viewer" },
  { route: "/w/[workspace]/products/new", screens: ["S-NV2-022"], title: "Add a product", crumb: "Products", role: "editor" },
  { route: "/w/[workspace]/products/discontinued", screens: ["S-NV2-023"], title: "Discontinued", crumb: "Products", role: "viewer" },
  { route: "/w/[workspace]/products/[product]/checks/[check]", screens: ["S-NV2-024"], title: "Check in progress", crumb: "Running a check", role: "viewer" },
  { route: "/w/[workspace]/products/[product]/artwork/[artwork]", screens: ["S-NV2-025"], title: "Artwork we cannot read", crumb: "Running a check", role: "viewer" },
  { route: "/w/[workspace]/products/[product]/report/send", screens: ["S-NV2-026"], title: "Export, send, share", crumb: "Artefacts", role: "editor" },
  { route: "/w/[workspace]/alerts", screens: ["S-MIS-001", "S-MOB-006"], title: "Alerts inbox", crumb: "Operations", role: "viewer" },
  { route: "/w/[workspace]/horizon", screens: ["S-MIS-002"], title: "Horizon", crumb: "Operations", role: "viewer" },
  { route: "/w/[workspace]/billing/plans", screens: ["S-PLN-001"], title: "Plan picker", crumb: "Billing", role: "admin" },
  { route: "/w/[workspace]/billing/checkout", screens: ["S-PLN-002"], title: "Checkout", crumb: "Billing", role: "admin" },
  { route: "/w/[workspace]/billing/invoices/[invoice]", screens: ["S-PLN-003"], title: "Invoice and receipt", crumb: "Billing", role: "admin" },
  { route: "/w/[workspace]/settings/people", screens: ["S-WSS-001"], title: "People and roles", crumb: "Settings", role: "admin" },
  { route: "/w/[workspace]/settings/workspace", screens: ["S-WSS-003"], title: "Workspace", crumb: "Settings", role: "admin" },
  { route: "/w/[workspace]/settings/data", screens: ["S-WSS-004"], title: "Data and retention", crumb: "Settings", role: "admin" },
  { route: "/w/[workspace]/settings/audit", screens: ["S-WSS-005"], title: "Audit log", crumb: "Settings", role: "admin" },
  { route: "/w/[workspace]/settings/billing", screens: ["S-BIL-001"], title: "Plan and allowance", crumb: "Settings · billing", role: "admin" },
  { route: "/w/[workspace]/settings/billing/invoices", screens: ["S-BIL-002"], title: "Invoices", crumb: "Settings · billing", role: "admin" },
  { route: "/w/[workspace]/settings/billing/payment", screens: ["S-BIL-003"], title: "Payment method", crumb: "Settings · billing", role: "admin" },
  { route: "/w/[workspace]/settings/billing/details", screens: ["S-BIL-004"], title: "Billing details", crumb: "Settings · billing", role: "admin" },
  { route: "/w/[workspace]/products/[product]", screens: ["S-MOB-002"], title: "One recipe, its markets", crumb: "Portfolio", role: "viewer" },
  { route: "/w/[workspace]/capture", screens: ["S-MOB-004", "S-MOB-005"], title: "Capture", crumb: "Portfolio", role: "viewer" },
];

export function routeFor(route: string): WorkspaceRoute {
  const found = WORKSPACE_ROUTES.find((r) => r.route === route);
  if (!found) throw new Error(`${route} is not a workspace route of spec/screens.yaml`);
  return found;
}

export type NavItem = { label: string; screen: string; route: string };
export type NavGroup = { label: string; items: NavItem[] };

/**
 * The rail, in Nutrivo 2.0's own group order. Only screens with a route of their own under one workspace are here:
 * entries that need a product or a check, catalogue frames, LATER screens, /admin and public routes have nowhere to
 * go from a rail and are left out rather than drawn as dead links (question (c) on issue #24).
 */
export const NAV: NavGroup[] = [
  { label: "Start", items: [{ label: "Home", screen: "S-NV2-001", route: "/w/[workspace]" }] },
  {
    label: "Portfolio",
    items: [
      { label: "Board", screen: "S-NV2-006", route: "/w/[workspace]/board" },
      { label: "Obligations", screen: "S-NV2-008", route: "/w/[workspace]/obligations" },
      { label: "Certificates", screen: "S-NV2-009", route: "/w/[workspace]/certificates" },
      { label: "Documents", screen: "S-NV2-010", route: "/w/[workspace]/documents" },
    ],
  },
  { label: "Screening", items: [{ label: "Ingredients & formulas", screen: "S-NV2-011", route: "/w/[workspace]/screening" }] },
  {
    label: "Library",
    items: [
      { label: "Term register", screen: "S-NV2-012", route: "/w/[workspace]/library/terms" },
      { label: "Coverage & confidence", screen: "S-NV2-013", route: "/w/[workspace]/library/coverage" },
      { label: "Suppliers", screen: "S-NV2-014", route: "/w/[workspace]/library/suppliers" },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Monitoring & alerts", screen: "S-NV2-015", route: "/w/[workspace]/monitoring" },
      { label: "Exports", screen: "S-NV2-018", route: "/w/[workspace]/exports" },
      { label: "Settings & roles", screen: "S-NV2-017", route: "/w/[workspace]/settings" },
    ],
  },
  { label: "Jurisdictions", items: [{ label: "Jurisdiction tree", screen: "S-NV2-019", route: "/w/[workspace]/markets" }] },
  {
    label: "Products",
    items: [
      { label: "Add a product", screen: "S-NV2-022", route: "/w/[workspace]/products/new" },
      { label: "Discontinued", screen: "S-NV2-023", route: "/w/[workspace]/products/discontinued" },
    ],
  },
];

/** The Mobile file's tab bar: Recipes (the board), Alerts, and More, which opens the rail. */
export const MOBILE_TABS = [
  { label: "Recipes", route: "/w/[workspace]/board" },
  { label: "Alerts", route: "/w/[workspace]/alerts" },
] as const;

export function hrefFor(route: string, workspaceId: string) {
  return route.replace("[workspace]", workspaceId);
}

/** The route pattern a pathname under /w/<id> belongs to, or null when no workspace route matches it. */
export function matchRoute(pathname: string): WorkspaceRoute | null {
  const parts = pathname.replace(/\/+$/, "").split("/");
  let best: WorkspaceRoute | null = null;
  let bestStatic = -1;
  for (const candidate of WORKSPACE_ROUTES) {
    const pattern = candidate.route.split("/");
    if (pattern.length !== parts.length) continue;
    let statics = 0;
    const ok = pattern.every((segment, i) => {
      if (segment.startsWith("[")) return parts[i] !== "";
      if (segment === parts[i]) {
        statics++;
        return true;
      }
      return false;
    });
    // Static segments win over dynamic ones, as in Next's router: /products/new is not /products/[product].
    if (ok && statics > bestStatic) {
      best = candidate;
      bestStatic = statics;
    }
  }
  return best;
}

/**
 * Where switching to another workspace lands: the same rail section when the current page is one (a section exists in
 * every workspace), otherwise the other workspace's home. A product, check or node id never carries across, because
 * it belongs to the workspace being left.
 */
export function switchHref(pathname: string, workspaceId: string) {
  const current = matchRoute(pathname);
  const sameSection = current && !current.route.slice("/w/[workspace]".length).includes("[");
  return hrefFor(sameSection ? current.route : "/w/[workspace]", workspaceId);
}
