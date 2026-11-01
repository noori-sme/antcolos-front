import type { NextConfig } from "next";

// `src/lib/api/client.ts` falls back to the STAGING API when this is unset. A
// production build without it would point real users at staging, so say so
// loudly at build time. (Not fatal yet: CI builds without it.)
if (process.env.NODE_ENV === "production" && !process.env.NEXT_PUBLIC_API_URL) {
  console.warn(
    "\n⚠  NEXT_PUBLIC_API_URL is not set: this build will call the STAGING API " +
      "(https://antcolos-staging.up.railway.app/api/v1). Set it for any non-staging deploy.\n",
  );
}

/**
 * Baseline response headers for every route. Deliberately not here yet:
 * a Content-Security-Policy (needs nonces for Next's inline scripts and a
 * browser pass) and HSTS (its scope is a hosting/domain decision).
 */
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // No page, public ones included, may be shown inside a frame.
  { key: "X-Frame-Options", value: "DENY" },
  // The app uses the clipboard only; none of these.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  // The dev overlay badge sits on top of the mobile tab bar; off so the real
  // UI is what we review.
  devIndicators: false,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
