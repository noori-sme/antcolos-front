"use client";

import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import { QueryProvider } from "@/lib/query/provider";
import { SessionProvider } from "@/lib/session/provider";
import { Toaster, toast } from "sonner";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { scrollToTop } from "@/lib/utils/scroll";

export function Providers({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  useEffect(() => {
    scrollToTop();
    const pendingToast = sessionStorage.getItem("antcolos_pending_toast");
    if (pendingToast) {
      toast.success(pendingToast);
      sessionStorage.removeItem("antcolos_pending_toast");
    }
    const pendingErrorToast = sessionStorage.getItem("antcolos_pending_error_toast");
    if (pendingErrorToast) {
      toast.error(pendingErrorToast);
      sessionStorage.removeItem("antcolos_pending_error_toast");
    }
  }, [pathname]);

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
