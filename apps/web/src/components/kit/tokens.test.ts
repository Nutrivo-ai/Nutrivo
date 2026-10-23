// Colour comes only from the Cobalt tokens (docs/10, .claude/rules/web.md): src/styles/tokens.css holds the docs/10
// block verbatim, and no other source file in the app defines a colour of its own.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../..");
const DOCS10 = path.resolve(SRC, "../../../docs/10-design-system.md");
const TOKENS = path.join(SRC, "styles/tokens.css");
const GLOBALS = path.join(SRC, "app/globals.css");
const COLOUR = /#[0-9a-fA-F]{3,8}(?![\w-])|\brgba?\(|\bhsla?\(|\boklch\(/g;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(tsx?|css)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function tokenBlock(text: string): string {
  const css = text.match(/```css\n([\s\S]*?)```/)?.[1] ?? text.match(/:root \{\n([\s\S]*?)\n\}/)?.[1];
  if (!css) throw new Error("no token block found");
  return css;
}

function declarations(css: string): Record<string, string> {
  return Object.fromEntries(
    Array.from(css.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g), (m) => [m[1], m[2].replace(/\/\*.*?\*\//g, "").trim()]),
  );
}

describe("Cobalt tokens", () => {
  it("tokens.css declares every docs/10 colour token with its docs/10 value", () => {
    const docs = declarations(tokenBlock(fs.readFileSync(DOCS10, "utf8")));
    const app = declarations(tokenBlock(fs.readFileSync(TOKENS, "utf8")));
    const colours = Object.entries(docs).filter(([, value]) => value.startsWith("#"));
    expect(colours.length).toBe(24);
    for (const [name, value] of colours) expect(app[name], name).toBe(value);
  });

  it("no source file defines a colour outside the token block", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      let text = fs.readFileSync(file, "utf8");
      if (file === TOKENS) text = text.replace(tokenBlock(text), "");
      for (const match of text.matchAll(COLOUR)) offenders.push(`${path.relative(SRC, file)}: ${match[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it("Tailwind's default palette is cleared, so only Cobalt colours exist as classes", () => {
    const css = fs.readFileSync(GLOBALS, "utf8");
    expect(css).toMatch(/@theme \{\s*--color-\*: initial;/);
    expect(css).not.toMatch(/@import "tailwindcss";/);
  });
});
