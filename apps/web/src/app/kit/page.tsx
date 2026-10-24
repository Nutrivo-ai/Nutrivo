import type { Metadata } from "next";
import { KitGallery } from "./gallery";

export const metadata: Metadata = { title: "Kit · Cobalt components" };

export default function KitPage() {
  return <KitGallery />;
}
