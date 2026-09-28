"use client";

import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import { QueryProvider } from "@/lib/query/provider";
import { SessionProvider } from "@/lib/session/provider";
import { Toaster } from "sonner";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryProvider>
        <SessionProvider>
          {children}
          <Toaster position="top-center" richColors theme="system" />
        </SessionProvider>
      </QueryProvider>
    </ThemeProvider>
  );
}
