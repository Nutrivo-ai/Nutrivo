// The public coverage page and the landing page's coverage block (P01) read public.coverage_snapshot() at request
// time and show nothing else: every count, date, depth and gap id on them is computed here from that one result
// (D-19). There is no coverage percentage and no figure across regions (S-COV-001: "No aggregate figure is
// published").
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

export const DOMAINS = [
  "mandatory_particulars",
  "composition",
  "claims_wording",
  "type_geometry",
  "language",
  "registration",
] as const;
export type Domain = (typeof DOMAINS)[number];

/** The domain names the public designs use for each coverage domain (Coverage - public, Landing Page). */
export const DOMAIN_LABEL: Record<Domain, string> = {
  mandatory_particulars: "Mandatory particulars",
  composition: "Composition, additives and analytical constituents",
  claims_wording: "Claims and marketing wording",
  type_geometry: "Type size and panel geometry",
  language: "Language of the printed panel",
  registration: "Registration: obligation, authority, route, fee, deadline",
};

export type DomainState = "complete" | "partial" | "not_encoded";

/** One row of public.coverage_snapshot()'s `nodes` (supabase/migrations/20261008000005_functions.sql). */
export type SnapshotRow = {
  node_id: string;
  domain: string;
  state: DomainState;
  rules_encoded: number;
  method: string;
  last_checked_at: string | null;
  gap_id: string | null;
};

export type Snapshot = { ruleset_version: string | null; nodes: SnapshotRow[] };

export type NodeCoverage = {
  id: string;
  /** EU member states by their ISO 3166 name; any other node by its id (the snapshot carries no names). */
  name: string;
  region: string;
  depth: DomainState;
  rules: number;
  /** The oldest date a person last checked any of its domains: the row never claims more currency than it has. */
  lastChecked: string | null;
  domainsEncoded: number;
  domains: SnapshotRow[];
  gaps: string[];
};

export type RegionCoverage = {
  id: string;
  nodes: NodeCoverage[];
  complete: number;
  partial: number;
  notEncoded: number;
  /** Each domain across the region's nodes: complete only when every node is. */
  domains: { domain: string; state: DomainState }[];
};

export type Coverage = { rulesetVersion: string | null; regions: RegionCoverage[] };

const REGION_ORDER = ["EU", "UK", "US"];
const isoName = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });

export function nodeName(id: string): string {
  const match = /^EU-([A-Z]{2})$/.exec(id);
  if (!match) return id;
  try {
    return isoName.of(match[1]) ?? id;
  } catch {
    return id;
  }
}

/** A node or region's depth from the states of its parts. */
export function depthOf(states: DomainState[]): DomainState {
  if (states.length > 0 && states.every((s) => s === "complete")) return "complete";
  if (states.every((s) => s === "not_encoded")) return "not_encoded";
  return "partial";
}

const domainRank = (domain: string) => {
  const i = (DOMAINS as readonly string[]).indexOf(domain);
  return i < 0 ? DOMAINS.length : i;
};

export function shapeCoverage(snapshot: Snapshot): Coverage {
  const byNode = new Map<string, SnapshotRow[]>();
  for (const row of snapshot.nodes ?? []) {
    const rows = byNode.get(row.node_id) ?? [];
    rows.push(row);
    byNode.set(row.node_id, rows);
  }
  const nodes: NodeCoverage[] = [...byNode.entries()].map(([id, rows]) => {
    const domains = [...rows].sort((a, b) => domainRank(a.domain) - domainRank(b.domain) || a.domain.localeCompare(b.domain));
    const dates = domains.map((d) => d.last_checked_at).filter((d): d is string => Boolean(d)).sort();
    return {
      id,
      name: nodeName(id),
      region: id.split("-")[0],
      depth: depthOf(domains.map((d) => d.state)),
      rules: domains.reduce((sum, d) => sum + d.rules_encoded, 0),
      lastChecked: dates[0] ?? null,
      domainsEncoded: domains.filter((d) => d.state === "complete").length,
      domains,
      gaps: [...new Set(domains.map((d) => d.gap_id).filter((g): g is string => Boolean(g)))],
    };
  });
  const regionIds = [...new Set(nodes.map((n) => n.region))].sort((a, b) => {
    const ra = REGION_ORDER.indexOf(a), rb = REGION_ORDER.indexOf(b);
    return (ra < 0 ? REGION_ORDER.length : ra) - (rb < 0 ? REGION_ORDER.length : rb) || a.localeCompare(b);
  });
  const regions = regionIds.map((id) => {
    const inRegion = nodes.filter((n) => n.region === id).sort((a, b) => a.id.localeCompare(b.id));
    const domainIds = [...new Set(inRegion.flatMap((n) => n.domains.map((d) => d.domain)))].sort(
      (a, b) => domainRank(a) - domainRank(b) || a.localeCompare(b),
    );
    return {
      id,
      nodes: inRegion,
      complete: inRegion.filter((n) => n.depth === "complete").length,
      partial: inRegion.filter((n) => n.depth === "partial").length,
      notEncoded: inRegion.filter((n) => n.depth === "not_encoded").length,
      domains: domainIds.map((domain) => ({
        domain,
        state: depthOf(inRegion.map((n) => n.domains.find((d) => d.domain === domain)?.state ?? "not_encoded")),
      })),
    };
  });
  return { rulesetVersion: snapshot.ruleset_version ?? null, regions };
}

export type CoverageRead = { ok: true; coverage: Coverage } | { ok: false };

/** Reads the snapshot as anyone would: the anon key, no session. A failure is reported, never guessed around. */
export async function readCoverage(requestId?: string): Promise<CoverageRead> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { ok: false };
  try {
    const db = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await db.rpc("coverage_snapshot");
    if (error || !data) throw error ?? new Error("coverage_snapshot returned nothing");
    return { ok: true, coverage: shapeCoverage(data as unknown as Snapshot) };
  } catch (error) {
    Sentry.captureMessage(`coverage_snapshot read failed: ${(error as { code?: string })?.code ?? (error as Error)?.name ?? "unknown"}`, {
      level: "error",
      tags: { area: "public", route: "coverage", request_id: requestId },
    });
    return { ok: false };
  }
}

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** Dates as the coverage design prints them in tables (2026-08-14). */
export const isoDay = (date: string | null) => (date ? date.slice(0, 10) : "—");
/** Dates as the coverage design prints them in running text (4 Sep 2026). */
export const longDay = (date: Date | string) => DAY.format(typeof date === "string" ? new Date(date) : date);
