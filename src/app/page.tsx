import { LandingPage } from "@/features/landing/landing-page";

/**
 * `/` — the public landing page.
 *
 * No session is read and none is required: this is the one route that renders
 * the same for everybody. Where a visitor goes next — Sign In or Sign Up — and
 * everything that happens after, is the auth flow's business, untouched.
 */
export default function RootPage() {
  return <LandingPage />;
}
