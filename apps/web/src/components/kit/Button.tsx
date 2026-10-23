import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "./states";

export type ButtonVariant = "primary" | "secondary" | "ghost";
export type ButtonSize = "sm" | "md";

// Cobalt §5 and the Empty and Error States file: primary is the accent with white text, secondary a --n400 hairline,
// ghost a bare accent-700 label. Hover goes to accent-600, pressed to accent-700. Disabled drops to 45% opacity and
// loses the accent entirely. Focus is the global 2px accent outline at 2px offset.
const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-paper border-0 font-medium hover:bg-accent-600 active:bg-accent-700 disabled:bg-n600",
  secondary:
    "bg-transparent text-n700 border border-n400 hover:border-accent hover:text-accent-700 active:text-accent-700 " +
    "disabled:border-n400 disabled:text-n700",
  ghost: "bg-transparent text-accent-700 border-0 hover:text-accent active:text-accent-700 disabled:text-n700",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "py-[8px] px-[14px] text-[12.5px]",
  md: "py-[10px] px-[16px] text-[13.5px]",
};

function classes(variant: ButtonVariant, size: ButtonSize, className?: string) {
  return cx(
    "kit-transition inline-block rounded-control cursor-pointer no-underline font-head",
    "disabled:opacity-45 disabled:cursor-not-allowed",
    VARIANT[variant],
    SIZE[size],
    className,
  );
}

type Common = { variant?: ButtonVariant; size?: ButtonSize; className?: string; children: ReactNode };

/** A button. Exactly one primary per state or dialog ("One action, never three"). */
export function Button({
  variant = "secondary",
  size = "sm",
  className,
  type = "button",
  ...rest
}: Common & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={classes(variant, size, className)} {...rest} />;
}

/** A link that looks like a button, for an action that navigates. */
export function ButtonLink({ variant = "secondary", size = "sm", className, href, children }: Common & { href: string }) {
  return (
    <a href={href} className={classes(variant, size, className)}>
      {children}
    </a>
  );
}
