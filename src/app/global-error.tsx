"use client";

import "@/styles/globals.css";
import { ErrorState } from "@/components/data/states";

/**
 * Last-resort boundary for errors thrown by the root layout or its providers
 * (session, query client, theme). It replaces the root layout, so it brings
 * its own <html>/<body> and the global stylesheet.
 */
export default function GlobalError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-dvh items-center justify-center bg-canvas px-4 font-sans antialiased">
        <title>Something went wrong · Antcolos</title>
        <div className="w-full max-w-md">
          <ErrorState
            description="Antcolos could not load. Try again, or reload the page."
            onRetry={retry}
          />
        </div>
      </body>
    </html>
  );
}
