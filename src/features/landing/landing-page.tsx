import { landingSections } from "./content";
import { renderSection } from "./sections/registry";
import { LandingShell } from "./shell";

/**
 * The public landing page — the first thing a signed-out visitor sees, and the
 * only page in the product that assumes nothing about who is looking.
 *
 * It composes; it does not decide. What the page contains lives in
 * `content.ts`, how each part looks lives in `sections/`. Nothing here knows
 * what a hero is.
 */
export function LandingPage() {
  return <LandingShell>{landingSections.map(renderSection)}</LandingShell>;
}
