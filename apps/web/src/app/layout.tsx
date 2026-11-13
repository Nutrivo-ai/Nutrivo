import type { Metadata } from "next";
import { IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
import "./globals.css";

// Cobalt type (docs/10): next/font downloads both families at build time and serves them from this app, so the
// browser never contacts a font service.
const instrumentSans = Instrument_Sans({
  variable: "--font-instrument-sans",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Nutrivo",
  description: "Pet-food labels checked against encoded EU feed law, per market and per language panel.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${instrumentSans.variable} ${plexMono.variable}`}>
      <body>
        {/* WCAG 2.4.1: the first stop on every page skips the rail and header to the page's <main id="main">. It is
            hidden until focused, so no screen differs from its design baseline. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-[8px] focus:left-[8px] focus:z-50 focus:bg-paper focus:text-accent-700 focus:px-[12px] focus:py-[8px] focus:border focus:border-accent"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
