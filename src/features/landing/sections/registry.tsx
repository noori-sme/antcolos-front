import type { ComponentType } from "react";
import type { LandingSection } from "../content";
import { HeroSection } from "./hero";

/**
 * Which component draws which kind of section.
 *
 * The mapped type is the point: add a kind to `LandingSection` and this object
 * stops type-checking until the new kind has a component here. A described
 * section can never quietly render nothing.
 */
type SectionRenderers = {
  [K in LandingSection["kind"]]: ComponentType<{
    section: Extract<LandingSection, { kind: K }>;
  }>;
};

const renderers: SectionRenderers = {
  hero: HeroSection,
};

export function renderSection(section: LandingSection) {
  // The lookup is sound by construction — the mapped type above pairs every
  // `kind` with a component that takes exactly that kind — but TypeScript
  // cannot narrow an index signature and a prop type together, so the cast
  // stands in for the guarantee the type already gives us.
  const Section = renderers[section.kind] as ComponentType<{ section: LandingSection }>;
  return <Section key={section.id} section={section} />;
}
