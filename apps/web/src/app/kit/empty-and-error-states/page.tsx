import type { Metadata } from "next";
import { EmptyAndErrorStatesStory } from "./story";

export const metadata: Metadata = { title: "Kit · Empty and error states" };

export default function EmptyAndErrorStatesPage() {
  return <EmptyAndErrorStatesStory />;
}
