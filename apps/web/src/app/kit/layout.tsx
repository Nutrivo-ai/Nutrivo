import { notFound } from "next/navigation";
import { ToastProvider } from "@/components/kit";

// The kit's own test pages (T-101): what the visual, axe and keyboard tests open. Never served in production.
export default function KitLayout({ children }: LayoutProps<"/kit">) {
  if (process.env.NUTRIVO_ENV === "prod") notFound();
  return <ToastProvider>{children}</ToastProvider>;
}
