import type { Metadata } from "next";
import { ShellStory } from "./story";

export const metadata: Metadata = { title: "Kit · Shell" };

export default function ShellStoryPage() {
  return <ShellStory />;
}
