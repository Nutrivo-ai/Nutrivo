import "@/components/public/public.css";

// The public site (T-603): marketing routes anyone can read, each built from its file in design/public/.
export default function PublicLayout({ children }: LayoutProps<"/">) {
  return children;
}
