import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The shared outer shape of a landing section: full-bleed band on the outside
 * (so a section can paint its own background edge to edge), a measured,
 * gutter-padded column on the inside.
 *
 * Every section uses this, so page rhythm stays consistent as sections are added.
 */
export function SectionFrame({
  id,
  children,
  className,
  innerClassName,
}: {
  id: string;
  children: ReactNode;
  /** Band-level styling: background, vertical rhythm, how it fills the page. */
  className?: string;
  /** Column-level styling: the content's own layout. */
  innerClassName?: string;
}) {
  return (
    <section id={id} className={cn("w-full px-4 py-12 sm:px-6 sm:py-16", className)}>
      <div className={cn("mx-auto w-full max-w-[56rem]", innerClassName)}>{children}</div>
    </section>
  );
}
