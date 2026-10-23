import type { Metadata } from "next";
import { ShellStatesStory } from "./story";

export const metadata: Metadata = { title: "Kit · Shell states" };

export default function ShellStatesPage() {
  return <ShellStatesStory />;
}
