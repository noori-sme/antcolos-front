/**
 * Everything the landing page SAYS and SHOWS, in one file.
 *
 * The page renders whatever this list describes, in order. Changing the copy,
 * reordering sections, or dropping one is an edit here — no component changes.
 * Adding a NEW kind of section is three steps: describe it in `LandingSection`
 * below, write the component under `./sections`, register it in
 * `./sections/registry.tsx`. TypeScript fails the build until all three are
 * done, so a described section can never silently render nothing.
 *
 * Right now the page is deliberately minimal: the Antcolos logo and the two
 * doors into the product. Everything past those doors already exists and is
 * not this page's business.
 */

/** A door out of the landing page. `href` must be a route this app already has. */
export type LandingAction = {
  label: string;
  /** An in-app route — this page links nowhere the product does not already go. */
  href: string;
  /** Maps to the design system's Button variants, not to a raw color. */
  emphasis: "primary" | "secondary";
};

/**
 * The hero: the brand, and the way in.
 *
 * `media` is where an image or a video goes when there is one to show. It is
 * optional because today there is nothing to show, and a landing page with a
 * placeholder is worse than one without.
 */
export type HeroSection = {
  kind: "hero";
  id: string;
  /** Shown under the logo when there is something to say. */
  tagline?: string;
  actions: readonly LandingAction[];
  media?: LandingMedia;
};

/** An image or a video a section shows. Nothing uses it yet; sections that grow one will. */
export type LandingMedia =
  | { type: "image"; src: string; alt: string; width: number; height: number }
  | { type: "video"; src: string; poster?: string; /** Describes the video for people who cannot see it. */ label: string };

/** Every kind of section the landing page knows how to render. Add to the union to add a kind. */
export type LandingSection = HeroSection;

export const signIn: LandingAction = {
  label: "Sign in",
  href: "/sign-in",
  emphasis: "secondary",
};

export const signUp: LandingAction = {
  label: "Sign up",
  href: "/sign-up",
  emphasis: "primary",
};

/** The page, top to bottom. */
export const landingSections: readonly LandingSection[] = [
  {
    kind: "hero",
    id: "hero",
    // No tagline and no media on purpose: the page shows the brand and the two
    // doors, nothing else. Set either field here when there is something worth
    // showing, and the hero renders it.
    actions: [signIn, signUp],
  },
];
