// T-401 (C01–C04, B02): what the product screens decide without the database. The database decides everything that
// matters (permissions, the recipe cap, the allowance); this turns its answers into what a person reads.
import { isRateLimited, rateLimitMessage } from "@/lib/rate-limit";

export const STAGES = ["brief", "in_development", "active", "discontinued"] as const;
export type Stage = (typeof STAGES)[number];
export const isStage = (v: unknown): v is Stage => typeof v === "string" && (STAGES as readonly string[]).includes(v);

/** The design's four lifecycle cards (S-NV2-022), in its order. */
export const STAGE_CARDS: Record<Stage, { label: string; body: string }> = {
  brief: { label: "Brief", body: "Partial input accepted. Produces a design envelope, not a verdict." },
  in_development: { label: "In development", body: "Checks run, findings tracked, nothing sellable yet." },
  active: { label: "Active", body: "On the board, in freshness and monitoring." },
  discontinued: { label: "Discontinued", body: "Off the board. Certificates stay resolvable." },
};

/** A product is created at one of the first three stages; app.create_product refuses discontinued. */
export const CREATE_STAGES: Stage[] = ["brief", "in_development", "active"];

export const SPECIES = ["dog", "cat", "other"] as const;
export type Species = (typeof SPECIES)[number];

/** Plans in the order the next-plan offer climbs (D-03). */
const NEXT_PLAN: Record<string, string> = { free: "Basic", basic: "Standard", standard: "Advanced", advanced: "Advanced" };

export type Refusal = { code: string; title: string; body: string; offer?: { label: string; href: string } };

/**
 * The database's refusals for the product RPCs (docs/03) as what the person reads. C01.fail.1: over the recipe cap the
 * answer is the next plan, never an overage line; nothing was created.
 */
export function productRefusal(code: string | undefined, workspaceId: string, hint?: string | null): Refusal {
  const plans = `/w/${workspaceId}/billing/plans`;
  if (isRateLimited({ code, hint })) return { code: "P0049", ...rateLimitMessage({ code, hint }, "Nothing was created.") };
  switch (code) {
    case "P0034": {
      let plan = "the next plan";
      let included: number | null = null;
      try {
        const h = hint ? (JSON.parse(hint) as { plan?: string; recipes_included?: number }) : {};
        if (h.plan) plan = NEXT_PLAN[h.plan] ?? plan;
        if (typeof h.recipes_included === "number") included = h.recipes_included;
      } catch {
        // a hint that does not parse changes only the wording
      }
      return {
        code,
        title: "Every recipe on your plan is in use",
        body: `${included === null ? "All recipes your plan includes" : `All ${included} recipes your plan includes`} are live, so a new recipe needs ${plan}. Nothing was created and nothing was added to your invoice. A pack size or variant of an existing recipe can still be added to its family.`,
        offer: { label: `See ${plan === "the next plan" ? "plans" : plan}`, href: plans },
      };
    }
    case "P0032":
      return {
        code,
        title: "All three free labels are used",
        body: "Nothing was created. Everything already checked stays readable and re-checking it stays free. A plan adds a fourth label.",
        offer: { label: "Pick a plan", href: plans },
      };
    case "P0036":
      return {
        code,
        title: "New artworks are paused until payment is resolved",
        body: "Nothing was created. Everything else keeps working: reports, re-checks and verification.",
      };
    case "42501":
      return {
        code,
        title: "Your role cannot add products here",
        body: "Adding a product or a family needs an internal editor, portfolio manager or admin with access to every family. An admin of this workspace can change your role.",
      };
    case "22023":
      return {
        code,
        title: "Something in the form cannot be saved",
        body: "Check the name, the family and the markets: markets must be in your workspace's regions. Nothing was created.",
      };
    default:
      return {
        code: code ?? "unknown",
        title: "The product was not created",
        body: "Nothing was saved. Try again in a minute.",
      };
  }
}

export type ProductInput = {
  name: string;
  familyId: string | null;
  familyName: string;
  stage: Stage;
  species: Species | null;
  lifeStage: string;
  format: string;
  nodes: string[];
};

export type InputProblem = "name" | "family" | "stage" | "species" | "category";

export const INPUT_PROBLEM: Record<InputProblem, string> = {
  name: "Give the product a name of up to 200 characters, as it will appear on the label.",
  family: "Pick a family, or name a new one (up to 200 characters).",
  stage: "Pick a lifecycle stage: brief, in development or active.",
  species: "Pick dog, cat or other.",
  category: "Life stage and format are up to 100 characters each.",
};

/** What the form can say before the database does (the database checks all of it again). */
export function checkProduct(input: ProductInput): InputProblem | null {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 200) return "name";
  if (!input.familyId && input.familyName.trim().length > 200) return "family";
  if (!CREATE_STAGES.includes(input.stage)) return "stage";
  if (input.species !== null && !(SPECIES as readonly string[]).includes(input.species)) return "species";
  if (input.lifeStage.length > 100 || input.format.length > 100) return "category";
  return null;
}

/** The provisional name app.create_product_from_artwork gives a product made from a file (C02 step 2). */
export function provisionalName(fileName: string): string {
  const name = fileName
    .replace(/\.[A-Za-z0-9]{1,5}$/, "")
    .replace(/[_\s]+/g, " ")
    .trim();
  return (name || "Untitled label").slice(0, 200);
}

export type Allowance = { plan: string; used: number; allowed: number };

/**
 * B02 and the Plans and Checkout moments (S-PLN-004, S-PLN-005). Nothing shows on a paid plan or before the first
 * label is used; from then the header counts; one panel when one label is left; when all are used, a product with no
 * artwork yet shows the fourth-label card, while a product already checked keeps its free re-checks.
 */
export type AllowanceMoment =
  | { kind: "none" }
  | { kind: "counter"; left: number; used: number; allowed: number }
  | { kind: "last"; left: 1; used: number; allowed: number }
  | { kind: "spent"; used: number; allowed: number; hasArtwork: boolean };

export function allowanceMoment(a: Allowance | null, hasArtwork: boolean): AllowanceMoment {
  if (!a || a.plan !== "free" || a.used < 1) return { kind: "none" };
  const left = Math.max(0, a.allowed - a.used);
  if (left === 0) return { kind: "spent", used: a.used, allowed: a.allowed, hasArtwork };
  if (left === 1) return { kind: "last", left: 1, used: a.used, allowed: a.allowed };
  return { kind: "counter", left, used: a.used, allowed: a.allowed };
}

/** The header counter's words, as the design writes them: "1 of 3 free labels left", "3 of 3 free labels used". */
export function counterText(m: AllowanceMoment): string | null {
  if (m.kind === "none") return null;
  if (m.kind === "spent") return `${m.used} of ${m.allowed} free labels used`;
  return `${m.left} of ${m.allowed} free labels left`;
}

/** Markets the form offers: the non-region nodes of the workspace's entitled regions, grouped by region. */
export type JurisdictionNode = { id: string; name: string; node_type: string; parent_id: string | null };

export function marketGroups(nodes: JurisdictionNode[], regions: string[]): { region: string; nodes: JurisdictionNode[] }[] {
  return regions
    .map((region) => ({
      region,
      nodes: nodes
        .filter((n) => n.node_type !== "region" && n.parent_id === region)
        .sort((a, b) => (a.node_type === b.node_type ? a.id.localeCompare(b.id) : a.node_type === "country" ? -1 : 1)),
    }))
    .filter((g) => g.nodes.length > 0);
}

/** "EU · DE, FR, NL · UK · GB" as the design writes a market list. */
export function marketLine(nodeIds: string[]): string {
  const byRegion = new Map<string, string[]>();
  for (const id of [...nodeIds].sort()) {
    const [region, ...rest] = id.split("-");
    const list = byRegion.get(region) ?? [];
    list.push(rest.join("-") || region);
    byRegion.set(region, list);
  }
  return [...byRegion.entries()].map(([region, list]) => `${region} · ${list.join(", ")}`).join(" · ");
}
