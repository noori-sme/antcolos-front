import { LogoMark, Wordmark } from "@/components/brand/logo";
import { LandingActions } from "../actions";
import { SectionMedia } from "../media";
import type { HeroSection as HeroSpec } from "../content";
import { SectionFrame } from "./frame";

/**
 * The brand, and the two ways in.
 *
 * The logo is the page's `<h1>`: on a page this bare, the name of the product
 * IS the heading, and a hidden one alongside it would only make a screen reader
 * say "Antcolos" twice. `LogoMark` and `Wordmark` are composed here rather than
 * using `Logo` for that reason, and so the lockup can be sized for a hero
 * without changing how it looks everywhere else.
 *
 * `flex-1` lets the hero take the whole viewport while it is the only section;
 * once a second section exists it simply stops being the only thing to fill.
 */
export function HeroSection({ section }: { section: HeroSpec }) {
  return (
    <SectionFrame
      id={section.id}
      className="flex flex-1 items-center justify-center"
      innerClassName="flex flex-col items-center gap-8 text-center sm:gap-10"
    >
      <h1 className="inline-flex items-center gap-3">
        <LogoMark size="lg" className="size-10 sm:size-12" />
        <Wordmark size="lg" className="text-[1.75rem] tracking-[-0.026em] sm:text-[2.125rem]" />
      </h1>

      {section.tagline ? (
        <p className="max-w-[34rem] text-[1rem] leading-relaxed text-fg-muted sm:text-[1.0625rem]">
          {section.tagline}
        </p>
      ) : null}

      {section.media ? (
        <SectionMedia
          media={section.media}
          className="w-full rounded-xl border border-border shadow-e2"
        />
      ) : null}

      <LandingActions actions={section.actions} />
    </SectionFrame>
  );
}
