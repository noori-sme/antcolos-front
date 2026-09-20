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
  /**
   * The absolute origin canonical links and share cards are built against.
   *
   * Share cards and Open Graph tags are rendered on a server, which has no
   * `window.location`, and a relative URL in an `og:` tag is not a URL anybody
   * can follow. Set `NEXT_PUBLIC_SITE_ORIGIN` per environment; the fallback is
   * the dev server, so a local preview still produces links that work.
   */
  origin: process.env.NEXT_PUBLIC_SITE_ORIGIN ?? "http://localhost:3000",
  title: `${brand.name} — ${brand.tagline}`,
  description:
    "Antcolos is the operating system for carriers and dispatch agencies: loads, dispatch, drivers, equipment, documents and settlements in one place.",
} as const;
