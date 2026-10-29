import { redirect } from "next/navigation";

// /admin opens on the term acceptance queue, the one admin screen the design draws (S-NV2-029).
export default function AdminHome() {
  redirect("/admin/terms");
}
