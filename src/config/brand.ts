/**
 * Antcolos brand configuration — the single place identity is defined.
 *
 * TEMPORARY BRANDING. The wordmark below is a typographic placeholder and
 * `/brand/antcolos-mark.svg` is a replaceable placeholder mark. Neither is the
 * final official Antcolos logo. To rebrand:
 *   1. colors, type scale, radius, elevation -> src/styles/globals.css
 *   2. the mark                               -> public/brand/antcolos-mark.svg
 *   3. name, tagline, wordmark treatment      -> this file
 * No component anywhere else hardcodes a brand value.
 */

export const brand = {
  name: "Antcolos",
  /** Rendered as two weights in the typographic wordmark. */
  wordmark: { lead: "ant", trail: "colos" },
  tagline: "Fleet operations, one system",
  markSrc: "/brand/antcolos-mark.svg",
  /** Set true once a final logo lockup replaces the placeholder. */
  isFinalLogo: false,
} as const;

export const site = {
  title: `${brand.name} — ${brand.tagline}`,
  description:
    "Antcolos is the operating system for carriers and dispatch agencies: loads, dispatch, drivers, equipment, documents and settlements in one place.",
} as const;
