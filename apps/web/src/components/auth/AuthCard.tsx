import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { cx } from "@/components/kit";
import { Wordmark } from "@/components/shell/Wordmark";

// The Account Recovery file (S-REC-*): a "Getting back in" header and one card that says what happened, what to do
// next, and offers the action. Sign-in and two-step use the same card (questions 1 and 2 on issue #25). The design's
// right-hand column ("Why it reads this way", the rules, the email) explains the design and is not part of the screen.

export type MarkTone = "accent" | "clear" | "action" | "none" | "blocked";
export type MarkGlyph = "circle" | "square" | "triangle" | "barred";

const TONE: Record<MarkTone, string> = {
  accent: "border-accent text-accent",
  clear: "border-clear text-clear",
  action: "border-action text-action",
  none: "border-na text-na",
  blocked: "border-blocked text-blocked",
};

const GLYPH: Record<MarkGlyph, string> = {
  circle: "w-[11px] h-[11px] border-2 border-current rounded-full",
  square: "w-[11px] h-[11px] bg-current",
  triangle: "w-0 h-0 border-x-[6px] border-x-transparent border-b-[11px] border-b-current",
  barred: "w-[11px] h-[11px] bg-current shadow-[inset_0_4px_0_var(--paper),inset_0_-4px_0_currentColor]",
};

/** The page around a card: the header strip and a centred column, 16 px gutters at phone width. */
export function AuthPage({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-panel text-ink text-[14px]">
      <header className="flex items-center gap-[20px] border-b border-ink bg-paper py-[13px] px-[16px] md:px-[30px]">
        <Wordmark size="header" />
        <span className="font-mono text-[10.5px] tracking-[0.05em] text-n600">GETTING BACK IN</span>
      </header>
      <main className="flex-1 pt-[30px] pb-[60px] px-[16px] md:px-[30px]">
        <div className="max-w-[440px] mx-auto">{children}</div>
      </main>
    </div>
  );
}

/** The mark above a card's title: a glyph and a mono label, never colour alone. */
export function Mark({ label, tone, glyph }: { label: string; tone: MarkTone; glyph: MarkGlyph }) {
  return (
    <div className={cx("mt-[22px] inline-flex items-center gap-[9px] border py-[6px] px-[10px]", TONE[tone])}>
      <span aria-hidden="true" className={cx("flex-none", GLYPH[glyph])} />
      <span className="font-mono text-[10px] tracking-[0.08em]">{label}</span>
    </div>
  );
}

export function AuthCard({
  mark,
  title,
  body,
  children,
  testId,
}: {
  mark: { label: string; tone: MarkTone; glyph: MarkGlyph };
  title: string;
  body: ReactNode;
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <section data-testid={testId} aria-labelledby="auth-title" className="blueprint border border-ink bg-paper py-[28px] px-[30px] leading-[1.55]">
      <i className="corner tl" />
      <i className="corner tr" />
      <i className="corner bl" />
      <i className="corner br" />
      <Wordmark size="card" />
      <Mark {...mark} />
      <h1 id="auth-title" className="mt-[14px] mb-0 text-[25px] font-semibold leading-[1.15]">
        {title}
      </h1>
      <p className="mt-[10px] mb-0 text-[14px] leading-[1.6] text-n700">{body}</p>
      {children}
    </section>
  );
}

/** The fields block: 20 px below the body, 13 px between fields. */
export function Fields({ children }: { children: ReactNode }) {
  return <div className="mt-[20px] flex flex-col gap-[13px]">{children}</div>;
}

export function Field({
  label,
  hint,
  hintTone = "n600",
  ...input
}: { label: string; hint?: ReactNode; hintTone?: "n600" | "clear" | "action" } & InputHTMLAttributes<HTMLInputElement>) {
  const id = input.id ?? `f-${input.name}`;
  return (
    <div>
      <label htmlFor={id} className="block text-[12.5px] font-medium mb-[5px]">
        {label}
      </label>
      <input
        id={id}
        className="w-full border border-n400 rounded-control py-[11px] px-[12px] text-[14px] leading-[1.55] font-head bg-paper text-ink placeholder:text-n500"
        {...input}
      />
      {hint ? (
        <p
          className={cx(
            "mt-[5px] mb-0 font-mono text-[10px] tracking-[0.05em]",
            hintTone === "clear" ? "text-clear" : hintTone === "action" ? "text-action" : "text-n600",
          )}
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const PRIMARY =
  "kit-transition block mt-[22px] w-full bg-accent text-paper border-0 rounded-control py-[13px] px-[20px] " +
  "text-[14.5px] font-medium font-head leading-[1.55] text-center cursor-pointer hover:bg-accent-600 hover:text-paper " +
  "active:bg-accent-700 disabled:opacity-45 disabled:cursor-not-allowed";

/** The card's one primary action. */
export function Primary({ children, ...rest }: { children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="submit" className={PRIMARY} {...rest}>
      {children}
    </button>
  );
}

/** The primary action when it navigates (a mail link, another page). */
export function PrimaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className={PRIMARY}>
      {children}
    </a>
  );
}

/** The quiet line under the primary action: the other way forward. */
export function Secondary({ children }: { children: ReactNode }) {
  return <p className="mt-[14px] mb-0 text-center text-[13px] text-n600">{children}</p>;
}

/** A link inside Secondary, in the line's own grey so the card reads as drawn. */
export function QuietLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="text-n600 hover:text-accent-700 underline-offset-[3px] hover:underline">
      {children}
    </a>
  );
}

/** What went wrong with a submission, beside the action that can fix it. */
export function Problem({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="mt-[16px] mb-0 border-l-[3px] border-blocked pl-[12px] text-[12.5px] leading-[1.5] text-n800">
      {children}
    </p>
  );
}

/** The dotted list of facts (S-REC-004): a square per line, its colour repeated by the words. */
export function FactList({ items }: { items: { text: string; tone: "n600" | "clear" | "blocked" | "action" }[] }) {
  const dot = { n600: "bg-n600", clear: "bg-clear", blocked: "bg-blocked", action: "bg-action" } as const;
  return (
    <ul className="mt-[20px] mb-0 p-0 list-none flex flex-col gap-[10px]">
      {items.map((item) => (
        <li key={item.text} className="flex gap-[11px] items-baseline">
          <span aria-hidden="true" className={cx("w-[10px] h-[10px] flex-none mt-[4px]", dot[item.tone])} />
          <span className="text-[13px] leading-[1.5] text-n800">{item.text}</span>
        </li>
      ))}
    </ul>
  );
}
