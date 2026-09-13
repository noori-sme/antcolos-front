import type { ReactNode } from "react";

/**
 * The account-screen frame: no sidebar, no topbar, no organization switcher.
 *
 * Signing in happens before any of that exists, so these routes deliberately sit
 * outside the product shell in `(app)` and share nothing with it but the design
 * tokens.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-10 sm:px-6 sm:py-14">
        {children}
      </main>
    </div>
  );
}
