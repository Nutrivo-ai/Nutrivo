"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/kit";
import { Wordmark } from "@/components/shell";

// The staff console's own navigation (#35 question 5): /admin is internal (K03), so it has no workspace rail.
export const ADMIN_NAV = [
  { href: "/admin/terms", label: "Term acceptance queue" },
  { href: "/admin/rules", label: "Rule review queue" },
  { href: "/admin/coverage", label: "Coverage and release" },
  { href: "/admin/glossary", label: "Glossary" },
] as const;

export function AdminNav() {
  const pathname = usePathname();
  return (
    <aside className="md:w-[216px] md:flex-none md:min-h-screen bg-panel md:border-r border-b md:border-b-0 border-rule">
      <div className="py-[18px] px-[18px]">
        <Wordmark />
        <p className="mt-[6px] mb-0 font-mono text-[10px] tracking-[0.1em] uppercase text-n600">Staff · content operations</p>
      </div>
      <nav aria-label="Admin" className="pb-[16px]">
        <p className="mt-[8px] mb-[6px] px-[18px] font-mono text-[10px] tracking-[0.13em] uppercase text-n600">Content</p>
        <ul className="m-0 p-0 list-none px-[12px]">
          {ADMIN_NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "kit-transition block py-[8px] px-[8px] text-[14px] no-underline",
                    active ? "bg-accent text-paper" : "text-ink hover:text-accent-700",
                  )}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
