"use client";

import { NoPermissionState } from "@/components/kit";
import { ROLE_LABEL, roleAllows, routeFor } from "@/lib/shell/routes";
import { useShell } from "./context";
import { ScreenHeader } from "./Shell";

/**
 * A workspace route whose screen a later task builds (docs/20 §4). It renders the shell, the screen's title from its
 * design file and the screen ids of spec/screens.yaml, and nothing else: no content, no counts, no reads. The
 * route's role from spec/screens.yaml is applied, so a person below it sees the no-permission state; that is
 * presentation only, because RLS decides what any read returns.
 */
export function ScreenPlaceholder({ route }: { route: string }) {
  const screen = routeFor(route);
  const { current } = useShell();
  const allowed = roleAllows(current.role, screen.role);
  return (
    <>
      <ScreenHeader crumb={screen.crumb} title={screen.title} />
      <main className="flex-1 min-w-0 pt-[24px] px-[16px] md:px-[26px] pb-[48px]">
        {allowed ? (
          <section
            data-placeholder={screen.screens[0]}
            aria-label="Not built yet"
            className="max-w-[640px] py-[18px] px-[20px] border border-rule bg-panel"
          >
            <p className="m-0 font-mono text-[10px] tracking-[0.1em] uppercase text-n600">{screen.screens.join(" · ")}</p>
            <p className="mt-[7px] mb-0 text-[13.5px] leading-[1.55] text-n700">
              This screen is built in a later task. Until then this page reads and changes nothing in {current.name}.
            </p>
          </section>
        ) : (
          <div className="max-w-[640px]">
            <NoPermissionState
              where={`NO PERMISSION · ${screen.crumb.toUpperCase()}`}
              title={`Your role cannot open ${screen.title}`}
              body={`You are ${article(ROLE_LABEL[current.role])} ${ROLE_LABEL[current.role]} in ${current.name}. ${screen.title} needs ${article(ROLE_LABEL[screen.role])} ${ROLE_LABEL[screen.role]}${screen.role === "admin" ? "" : " or a role above it"}.`}
              aside={`An admin of ${current.name} can change your role.`}
            />
          </div>
        )}
      </main>
    </>
  );
}

function article(word: string) {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}
