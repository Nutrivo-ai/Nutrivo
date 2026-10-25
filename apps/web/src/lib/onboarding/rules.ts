// T-106 (A01): the decisions onboarding makes, as pure functions so they are tested without a stack. Nothing here
// touches a session or holds a password longer than the call that checks it.
import { checkPassword, MIN_PASSWORD } from "@/lib/auth/rules";

export const ONBOARDING = "/onboarding";

/** The steps drawn on the rail (Onboarding Flow). Steps 04 and 05 arrive with their own tasks (T-303, T-404). */
export const STEPS = ["Account", "Where you sell", "Your first recipe", "Your artwork", "Your first answer"] as const;
export type Step = 1 | 2 | 3;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isEmail = (email: string) => EMAIL.test(email);

/** Personal mail providers: their domain says nothing about the company, so the name comes from the person instead. */
const PERSONAL = new Set([
  "gmail", "googlemail", "outlook", "hotmail", "live", "msn", "yahoo", "icloud", "me", "mac", "aol", "gmx", "web",
  "proton", "protonmail", "pm", "yandex", "mail", "zoho", "fastmail", "hey", "tutanota",
]);

/**
 * S-ONB-001: "Workspace will be called …, from your email domain." The domain's first label, capitalised
 * (haldenpet.com → Haldenpet). A personal mail provider says nothing about the company, so the name is then
 * "<full name>'s workspace" and `fromDomain` is false: the screen says "from your email domain" only when it is.
 */
export function workspaceNameFromEmail(email: string, fullName = ""): { name: string; fromDomain: boolean } {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  const label = domain.split(".")[0] ?? "";
  if (label && !PERSONAL.has(label)) {
    const name = label
      .split(/[-_]+/)
      .filter(Boolean)
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(" ");
    if (name) return { name, fromDomain: true }; // a label of separators only ("a@-.com") falls through
  }
  const person = fullName.trim();
  return { name: person ? `${person}'s workspace` : "My workspace", fromDomain: false };
}

/** app.workspaces.name: 1 to 200 characters (the table's own check). */
export const MAX_WORKSPACE_NAME = 200;

export type AccountProblem = "email" | "name" | "password_short" | "password_long" | "workspace";

/** S-ONB-001's three fields, and the workspace name. One problem at a time, in the order the fields are drawn. */
export function checkAccount(input: { email: string; fullName: string; password: string; workspaceName: string }): AccountProblem | null {
  if (!isEmail(input.email.trim())) return "email";
  if (!input.fullName.trim() || input.fullName.trim().length > 200) return "name";
  const password = checkPassword(input.password, input.password);
  if (!password.ok) return password.problem === "long" ? "password_long" : "password_short";
  const ws = input.workspaceName.trim();
  if (!ws || ws.length > MAX_WORKSPACE_NAME) return "workspace";
  return null;
}

export const ACCOUNT_PROBLEM: Record<AccountProblem, string> = {
  email: "Type your work email.",
  name: "Type your full name, as your colleagues would recognise it.",
  password_short: `The password needs ${MIN_PASSWORD} characters or more. A passphrase of four words is easier to remember.`,
  password_long: "At most 72 characters. Anything longer is not read, so it would not make the password stronger.",
  workspace: `The workspace needs a name of 1 to ${MAX_WORKSPACE_NAME} characters. Rename it before you continue.`,
};

/** The regulatory regions of S-ONB-002. Free is the EU only (docs/08-billing, A01 steps 2 and 3); the UK and the US come with a paid plan. */
export const FREE_REGION = "EU";

export type Operator = { name: string; address: string; country: string; approval_number?: string };

export type OperatorProblem = "name" | "address" | "country" | "approval";

/**
 * ISO 3166-1 alpha-2, every assigned code. Nothing else is a country here: not UK (GB), not EL (GR), not the letters
 * of a Dutch postcode ("1012 AB"). Nothing is converted either: an address ending ", UK" has no country to read.
 */
export const ISO_COUNTRIES = new Set(
  (
    "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
    "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
    "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO " +
    "JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR " +
    "MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO " +
    "RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV " +
    "TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
  ).split(" "),
);

/** The country an address ends with, as an ISO 3166-1 alpha-2 code, or null when it does not end with one. */
export function countryOf(address: string): string | null {
  const code = /(?:^|[\s,])([A-Z]{2})\.?$/.exec(address.trim())?.[1];
  return code && ISO_COUNTRIES.has(code) ? code : null;
}

/** "SE · Sweden": the code and its English name, so the person sees which country will be saved. */
export function countryLabel(code: string): string {
  let name: string | undefined;
  try {
    name = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" }).of(code);
  } catch {
    name = undefined;
  }
  return name ? `${code} · ${name}` : code;
}

/**
 * S-ONB-003 (B01): the responsible operator exactly as printed. The design draws no country field, so the country is
 * the ISO code the address ends with (issue #28, answer 2), shown on screen before it is saved. The approval number
 * is optional. The limits are app.set_default_operator's own.
 */
export function readOperator(input: { name: string; address: string; approval: string }):
  | { ok: true; operator: Operator }
  | { ok: false; problem: OperatorProblem } {
  const name = input.name.trim();
  const address = input.address.trim();
  const approval = input.approval.trim();
  if (!name || name.length > 300) return { ok: false, problem: "name" };
  if (!address || address.length > 500) return { ok: false, problem: "address" };
  const country = countryOf(address);
  if (!country) return { ok: false, problem: "country" };
  if (approval.length > 100) return { ok: false, problem: "approval" };
  return { ok: true, operator: { name, address, country, ...(approval ? { approval_number: approval } : {}) } };
}

export const OPERATOR_PROBLEM: Record<OperatorProblem, string> = {
  name: "Type the operator's name exactly as it is printed on the label.",
  address: "Type the operator's address exactly as it is printed on the label.",
  country:
    "The country could not be read from the end of the address. Keep the address exactly as printed and choose “I'll do this later”; the operator stays unset for now.",
  approval: "The establishment number is at most 100 characters. Leave it empty if you do not hold one.",
};

export type JurisdictionRow = { id: string; parent_id: string | null; node_type: string; languages: string[] };

export type RegionCard = { id: string; k: string; v: string; meta: string; nodes: string[] };

/** S-ONB-002's three regions: the descriptions are the design's, the counts and nodes come from ref.jurisdictions. */
const REGION_COPY: Record<string, { v: string; featured: string[] }> = {
  EU: {
    v: "One supranational rulebook, then national registration, language and enforcement per member state.",
    featured: ["EU-DE", "EU-FR", "EU-NL", "EU-IT"],
  },
  UK: {
    v: "A dual regime. Great Britain diverges on retained law, Northern Ireland stays aligned for goods.",
    featured: ["UK-GB", "UK-NI"],
  },
  US: {
    v: "Federal safety and labelling, then a model feed bill each state adopts in its own edition.",
    featured: ["US-FED", "US-TX", "US-CA"],
  },
};

const nodeLabel = (id: string) => (id === "US-FED" ? "US · Federal" : id.replace("-", " · "));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function regionCards(rows: JurisdictionRow[]): RegionCard[] {
  return Object.entries(REGION_COPY).flatMap(([id, copy]) => {
    if (!rows.some((r) => r.id === id && r.node_type === "region")) return [];
    const children = rows.filter((r) => r.parent_id === id);
    const featured = copy.featured.filter((f) => children.some((c) => c.id === f));
    const rest = children.length - featured.length;
    const nodes = [...featured.map(nodeLabel), ...(rest > 0 ? [`+ ${rest} more`] : [])];
    const states = children.filter((c) => c.node_type === "state").length;
    const countries = children.filter((c) => c.node_type === "country");
    const languages = new Set(children.flatMap((c) => c.languages));
    let meta: string;
    if (states > 0) meta = `${children.some((c) => c.node_type === "federal") ? "FEDERAL + " : ""}${states} STATES`;
    else if (id === "EU") meta = `${plural(countries.length, "MEMBER STATE", "MEMBER STATES")} · ${plural(languages.size, "LANGUAGE", "LANGUAGES")}`;
    else meta = `${plural(children.length, "NODE", "NODES")} · ${languages.size === 1 && languages.has("en") ? "ENGLISH" : plural(languages.size, "LANGUAGE", "LANGUAGES")}`;
    return [{ id, k: id, v: copy.v, meta, nodes }];
  });
}
