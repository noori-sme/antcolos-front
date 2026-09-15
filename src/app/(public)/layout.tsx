import type { ReactNode } from "react";

/**
 * The frame for pages reached WITHOUT signing in.
 *
 * No sidebar, no topbar, no organization switcher, and — crucially — no
 * session: a tracking link holder is not a user of Antcolos and must not be
 * shown anything that implies they are. These routes sit outside `(app)`
 * entirely and share nothing with it but the design tokens.
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <main className="flex flex-1 flex-col items-center px-4 py-8 sm:px-6 sm:py-12">
        {children}
      </main>
    </div>
  );
}
