import Link from "next/link";
import type { ReactNode } from "react";
import { SEGMENTS, SIGN_IN, START, segmentHref } from "@/lib/public/links";
import { sx } from "@/lib/public/sx";

// Pieces every public design file draws the same way (design/public/). Each route keeps its own file's header where
// the files differ; Coverage - public and Segment Pages share the one below.

/** The wordmark with its ".ai", as the public files draw it (22 px, the ".ai" at 14 or 15 px). */
export function SiteMark({ ai = 15 }: { ai?: number }) {
  return (
    <Link href="/" aria-label="Nutrivo home" style={sx("color: var(--ink)")}>
      <span style={sx("margin: 0; display: flex; align-items: flex-end; gap: 4px; font-size: 22px; font-weight: 600; letter-spacing: -0.045em; line-height: 1")}>
        <span>nutrivo</span>
        <span aria-hidden="true" style={sx("width: 6px; height: 6px; background: var(--accent); margin-bottom: 2px; flex-shrink: 0")} />
        <span style={{ ...sx("font-weight: 400; color: var(--n600); letter-spacing: 0"), fontSize: ai }}>.ai</span>
      </span>
    </Link>
  );
}

export type NavItem = "Product" | "Who it's for" | "Coverage" | "Pricing" | "About";

const NAV_HREF: Record<NavItem, string> = {
  Product: "/",
  "Who it's for": segmentHref(SEGMENTS[0].slug),
  Coverage: "/coverage",
  Pricing: "/pricing",
  About: "/about",
};

/** The header of Coverage - public and Segment Pages: mark, four links (the current one in accent), sign in, start. */
export function SiteHeader({ items, current }: { items: NavItem[]; current: NavItem }) {
  return (
    <header style={sx("display: flex; align-items: center; gap: 26px; border-bottom: 1px solid var(--ink); padding: 16px 56px")}>
      <SiteMark />
      <nav aria-label="Site" style={sx("flex: 1; display: flex; gap: 22px")}>
        {items.map((k) => (
          <Link
            key={k}
            href={NAV_HREF[k]}
            aria-current={k === current ? "page" : undefined}
            style={sx(`font-size: 13.5px; color: ${k === current ? "var(--accent-700)" : "var(--n700)"}; font-weight: ${k === current ? "600" : "400"}`)}
          >
            {k}
          </Link>
        ))}
      </nav>
      <Link href={SIGN_IN} style={sx("font-size: 13px; color: var(--n700)")}>Sign in</Link>
      <Link href={START} className="pub-primary" style={sx("background: var(--accent); color: var(--paper); padding: 9px 16px; border-radius: 3px; font-size: 13.5px; font-weight: 500")}>
        Check a label free
      </Link>
    </header>
  );
}

/** The operator line and a mono note, as the footers of Coverage - public and Segment Pages draw them. */
export function SiteFooter({ note }: { note: ReactNode }) {
  return (
    <footer style={sx("border-top: 1px solid var(--ink); padding: 22px 56px; display: flex; align-items: baseline; justify-content: space-between; gap: 30px")}>
      <p style={sx("margin: 0; font-size: 12.5px; color: var(--n600)")}>Nutrivo.ai is operated by Sunny Ventures AB, Karlbergsvägen 48, 113 37 Stockholm, Sweden.</p>
      <p style={sx("margin: 0; font-family: var(--mono); font-size: 10px; letter-spacing: 0.06em; color: var(--n600)")}>{note}</p>
    </footer>
  );
}

/** The page column every public design file draws its screen in (its root element's style), centred at 1600 px. */
export function Page({ children, css = "width: 1280px; margin: 0 auto; background: var(--paper)" }: { children: ReactNode; css?: string }) {
  return <div style={sx(css)}>{children}</div>;
}

/** The four "+" registration marks the public files draw at the corners of a framed box. */
export function Crosses({ color = "var(--n400)", size = 13, offset = [-8, -6] }: { color?: string; size?: number; offset?: [number, number] }) {
  const [v, h] = offset;
  const base = `position: absolute; font-family: var(--mono); font-size: ${size}px; line-height: 1; color: ${color}`;
  return (
    <>
      <span aria-hidden="true" style={{ ...sx(base), top: v, left: h }}>+</span>
      <span aria-hidden="true" style={{ ...sx(base), top: v, right: h }}>+</span>
      <span aria-hidden="true" style={{ ...sx(base), bottom: v, left: h }}>+</span>
      <span aria-hidden="true" style={{ ...sx(base), bottom: v, right: h }}>+</span>
    </>
  );
}
