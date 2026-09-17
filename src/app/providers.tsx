"use client";

import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import { QueryProvider } from "@/lib/query/provider";
import { SessionProvider } from "@/lib/session/provider";
import { SessionFixtureBridge } from "@/lib/session/fixture-bridge";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryProvider>
        <SessionProvider>
          {/* Development only, and removed entirely from a production build. */}
          <SessionFixtureBridge />
          {children}
        </SessionProvider>
      </QueryProvider>
    </ThemeProvider>
  );
}
