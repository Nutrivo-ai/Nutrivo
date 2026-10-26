// Where the public site's calls to action go (T-603, plan on issue #60).
// "Sign in" is T-103's /sign-in. Starting the free allowance belongs to /onboarding (T-106, PR #135); until that is on
// main every start link goes to /sign-in, and START switches to "/onboarding" when it lands.
export const SIGN_IN = "/sign-in";
export const START = "/sign-in";
export const CONTACT = "mailto:hello@nutrivo.ai";

export const PUBLIC_ROUTES = {
  home: "/",
  pricing: "/pricing",
  coverage: "/coverage",
  faq: "/faq",
  about: "/about",
  terms: "/legal/terms",
  dpa: "/legal/dpa",
  privacy: "/legal/privacy",
} as const;

export const SEGMENTS = [
  { key: "npd", slug: "new-product-development", label: "New product development" },
  { key: "pm", slug: "product-management", label: "Product & range management" },
  { key: "consultant", slug: "consultants", label: "Consultants & agencies" },
  { key: "cm", slug: "contract-manufacturers", label: "Contract manufacturers" },
  { key: "retailer", slug: "retailers", label: "Retailers & buyers" },
] as const;

export const segmentHref = (slug: string) => `/for/${slug}`;
