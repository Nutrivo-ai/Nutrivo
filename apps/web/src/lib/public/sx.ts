import type { CSSProperties } from "react";

// The public design files (design/public/) draw every element with an inline style string. sx() turns such a string
// into a React style object, so each route keeps the design's declarations as written and can be read against it
// line by line. Colours stay token references (var(--…)): the tokens test rejects any other colour.
const cache = new Map<string, CSSProperties>();

/** "font-size" → "fontSize", "-webkit-font-smoothing" → "WebkitFontSmoothing"; custom properties stay as written. */
const property = (name: string) =>
  name.startsWith("--") ? name : name.replace(/^-/, "").replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()).replace(/^webkit/, "Webkit");

export function sx(css: string): CSSProperties {
  const hit = cache.get(css);
  if (hit) return hit;
  const style: Record<string, string> = {};
  for (const declaration of css.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon < 0) continue;
    const name = declaration.slice(0, colon).trim();
    const value = declaration.slice(colon + 1).trim();
    if (name && value) style[property(name)] = value;
  }
  cache.set(css, style as CSSProperties);
  return style as CSSProperties;
}
