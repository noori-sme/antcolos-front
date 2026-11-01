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

const nextConfig: NextConfig = {
  // The dev overlay badge sits on top of the mobile tab bar; off so the real
  // UI is what we review.
  devIndicators: false,
  /* config options here */
};

export default nextConfig;
