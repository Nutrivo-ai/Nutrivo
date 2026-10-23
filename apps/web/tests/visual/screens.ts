// spec/screens.yaml, typed: read by the baseline capture and the inventory test.
import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";

export const REPO_ROOT = path.resolve(__dirname, "../../../..");

export type Screen = {
  id: string;
  title: string;
  kind: "app" | "admin" | "auth" | "public" | "moment" | "email" | "document" | "catalogue";
  design: string;
  state: Record<string, unknown>;
  element?: { css: string; nth: number };
  route: string | null;
  role: string;
  scope: "build" | "later";
  viewports: number[];
  workflows: string[];
  data: string[];
  states: string[];
  baseline: string;
  notes?: string[];
};

export function loadScreens(): Screen[] {
  const doc = parse(fs.readFileSync(path.join(REPO_ROOT, "spec/screens.yaml"), "utf8")) as { screens: Screen[] };
  return doc.screens;
}
