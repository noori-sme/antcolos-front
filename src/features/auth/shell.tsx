import Link from "next/link";
import type { ReactNode, Ref } from "react";
import { Logo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";

/**
 * The frame every account screen sits in: wordmark, a titled card, and an
 * optional line underneath for the cross-link to the other flow.
 *
 * The heading is focusable (`tabIndex={-1}`) so multi-step flows can move focus
 * to it when the step changes — a screen reader then announces the new step
 * instead of leaving the user stranded on a button that no longer exists.
 */
export function AuthShell({
  title,
  description,
  children,
  footer,
  headingRef,
  width = "narrow",
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  headingRef?: Ref<HTMLHeadingElement>;
  width?: "narrow" | "wide";
}) {
  return (
    <div className={cn("w-full", width === "narrow" ? "max-w-[25rem]" : "max-w-[46rem]")}>
      <div className="mb-6 flex justify-center sm:mb-7">
        <Link
          href="/"
          className="rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          <Logo size="lg" />
        </Link>
      </div>

      <div className="rounded-xl border border-border bg-surface p-5 shadow-e2 sm:p-7">
        <h1
          ref={headingRef}
          tabIndex={-1}
          className="text-[1.1875rem] leading-7 font-semibold tracking-[-0.012em] text-fg outline-none sm:text-[1.3125rem] sm:leading-8"
        >
          {title}
        </h1>
        {description ? (
          <div className="mt-2 text-[0.875rem] leading-relaxed text-fg-muted">{description}</div>
        ) : null}
        <div className="mt-6">{children}</div>
      </div>

      {footer ? (
        <div className="mt-5 text-center text-[0.8125rem] text-fg-muted">{footer}</div>
      ) : null}
    </div>
  );
}

/** The "Already have an account? Sign in" line under the card. */
export function AuthSwitchLink({ prompt, href, label }: { prompt: string; href: string; label: string }) {
  return (
    <>
      {prompt}{" "}
      <Link
        href={href}
        className="font-medium text-primary underline-offset-4 hover:underline focus-visible:underline"
      >
        {label}
      </Link>
    </>
  );
}
