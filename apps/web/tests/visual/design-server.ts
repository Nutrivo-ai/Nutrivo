// Serves design/ read-only over HTTP for the baseline capture: the design files fetch their own source, which file://
// refuses. The files are never written (CLAUDE.md: design/ is read-only reference).
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import type { Page } from "@playwright/test";

export const DESIGN_ROOT = path.resolve(__dirname, "../../../../design");

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

/** Starts the server on a free port and resolves with its base URL. */
export async function serveDesign(): Promise<{ url: string; close: () => void }> {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
    const file = path.join(DESIGN_ROOT, rel);
    if (!file.startsWith(DESIGN_ROOT + path.sep)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(file, (err, body) => {
      if (err) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" }).end(body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, close: () => server.close() };
}

/** Waits for the design's component to mount, then sets its own state (the DCLogic instance support.js keeps as
 * `logic` on its host component): the same state its rail, tabs and steps set when clicked. */
export async function setDesignState(page: Page, state: Record<string, unknown>): Promise<void> {
  await page.waitForFunction((next) => {
    type Logic = { setState: (s: unknown) => void; renderVals: unknown };
    type Fiber = { stateNode?: { logic?: Logic }; return?: Fiber; child?: Fiber; sibling?: Fiber };
    const walk = (f: Fiber | undefined): Fiber | undefined => {
      for (let n = f; n; n = n.sibling) {
        if (typeof n.stateNode?.logic?.renderVals === "function") return n;
        const hit = walk(n.child);
        if (hit) return hit;
      }
      return undefined;
    };
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      const key = Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
      if (!key) continue;
      let root = (el as unknown as Record<string, Fiber>)[key];
      while (root.return) root = root.return;
      const logic = walk(root)?.stateNode?.logic;
      if (logic) {
        logic.setState(next);
        return true;
      }
    }
    return false;
  }, state);
}
