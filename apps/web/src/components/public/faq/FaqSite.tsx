import Link from "next/link";
import { SiteMark } from "@/components/public/Site";
import { PUBLIC_ROUTES } from "@/lib/public/links";
import { sx } from "@/lib/public/sx";

// The header and footer that design/public/Nutrivo FAQ and About.dc.html draws around both of its pages (S-FAQ-001
// /faq, S-FAQ-002 /about). In the design the Questions / About us tabs are buttons that switch the component's state;
// here each is a link to its route, drawn the same, the current one marked with aria-current.

const TABS = [
  { key: "faq", label: "Questions", href: PUBLIC_ROUTES.faq },
  { key: "about", label: "About us", href: PUBLIC_ROUTES.about },
] as const;

export type FaqPageKey = (typeof TABS)[number]["key"];

/** The tab style the design's renderVals() builds for the current and the other tab. */
const tabStyle = (current: boolean) =>
  `border: 1px solid ${current ? "var(--accent)" : "var(--n400)"}; background: ${current ? "var(--accent-100)" : "var(--paper)"}; ` +
  `color: ${current ? "var(--accent-700)" : "var(--n700)"}; padding: 8px 14px; font-size: 13px; cursor: pointer; font-weight: ${current ? "600" : "400"}`;

export function FaqHeader({ current }: { current: FaqPageKey }) {
  return (
    <header data-testid="faq-header" style={sx("border-bottom: 1px solid var(--ink); background: var(--paper)")}>
      <div style={sx("max-width: 1120px; margin: 0 auto; padding: 15px 26px; display: flex; align-items: center; gap: 20px; flex-wrap: wrap")}>
        <SiteMark ai={14} />
        <div style={sx("flex: 1")} />
        <nav aria-label="Questions and about" style={sx("display: flex; gap: 1px")}>
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={t.href}
              className="pub-tab"
              aria-current={t.key === current ? "page" : undefined}
              style={{ ...sx(tabStyle(t.key === current)), textAlign: "center" }}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <Link href={PUBLIC_ROUTES.pricing} style={sx("font-size: 13.5px")}>Pricing</Link>
        <Link href={PUBLIC_ROUTES.coverage} style={sx("font-size: 13.5px")}>Coverage</Link>
      </div>
    </header>
  );
}

export function FaqFooter() {
  return (
    <footer data-testid="faq-footer" style={sx("border-top: 1px solid var(--ink); background: var(--paper)")}>
      <div style={sx("max-width: 1120px; margin: 0 auto; padding: 20px 26px; display: flex; align-items: baseline; gap: 20px; flex-wrap: wrap")}>
        <p style={sx("margin: 0; font-size: 12.5px; color: var(--n600)")}>
          Sunny Ventures AB, trading as Nutrivo.ai · Karlbergsvägen 48, 113 37 Stockholm, Sweden · VAT SE559429715101
        </p>
        <div style={sx("flex: 1")} />
        <Link href={PUBLIC_ROUTES.pricing} style={sx("font-size: 12.5px")}>Pricing</Link>
        <Link href={PUBLIC_ROUTES.coverage} style={sx("font-size: 12.5px")}>Coverage</Link>
        <Link href={PUBLIC_ROUTES.terms} style={sx("font-size: 12.5px")}>Terms</Link>
      </div>
    </footer>
  );
}

/** The design's four `<i class="corner …">` registration marks inside a `.blueprint` box (globals.css draws them). */
export function Corners() {
  return (
    <>
      <i aria-hidden="true" className="corner tl" />
      <i aria-hidden="true" className="corner tr" />
      <i aria-hidden="true" className="corner bl" />
      <i aria-hidden="true" className="corner br" />
    </>
  );
}
