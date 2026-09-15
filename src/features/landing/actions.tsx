import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { LandingAction } from "./content";

/**
 * The row of doors: full-width and stacked on a phone, side by side from `sm`
 * up, so neither button ever ends up a thumb-sized target in a corner.
 *
 * These are `Link`s wearing the design system's Button, not buttons that
 * navigate: a real anchor is what makes middle-click, long-press and "open in
 * new tab" work.
 */
export function LandingActions({ actions }: { actions: readonly LandingAction[] }) {
  return (
    // The cap stops a wide phone or a small tablet turning two buttons into two
    // slabs; from `sm` up they sit side by side and size to their own content.
    <div className="flex w-full max-w-[22rem] flex-col gap-3 sm:w-auto sm:max-w-none sm:flex-row">
      {actions.map((action) => (
        <Button
          key={action.href}
          asChild
          variant={action.emphasis}
          size="lg"
          className="w-full sm:w-auto sm:min-w-[9rem]"
        >
          <Link href={action.href}>{action.label}</Link>
        </Button>
      ))}
    </div>
  );
}
