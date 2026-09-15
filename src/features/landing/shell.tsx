import type { ReactNode } from "react";

/**
 * The frame the landing page's sections sit in.
 *
 * Deliberately thin: a canvas, a `<main>`, and nothing else. Sections are
 * full-bleed and own their own inner width, so a future edge-to-edge image or
 * video section needs no change here. A header or footer, when the page earns
 * one, goes above and below `<main>`.
 */
export function LandingShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
