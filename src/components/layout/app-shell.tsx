"use client";

import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MobileTabBar } from "./mobile-nav";
import { Sidebar, SidebarOverlay } from "./sidebar";
import { Topbar } from "./topbar";
import { LockedSection } from "./locked-section";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={300}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-surface-raised focus:px-4 focus:py-2 focus:shadow-e3"
      >
        Skip to content
      </a>
      <div className="flex min-h-dvh bg-canvas">
        <LockedSection className="z-40">
          <Sidebar />
        </LockedSection>
        <SidebarOverlay />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar />
          <LockedSection className="flex-1 flex flex-col" message="Thanks for choosing Antcolos! Right now, you do not have access to this dashboard.">
            <main
              id="main"
              className="flex-1 px-page-x py-page-y pb-[5.5rem] lg:pb-page-y"
            >
              <div className="mx-auto w-full max-w-[100rem]">{children}</div>
            </main>
          </LockedSection>
        </div>
      </div>
      <MobileTabBar />
    </TooltipProvider>
  );
}
