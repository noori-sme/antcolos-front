"use client";

import { Bell, Inbox, Search } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Logo } from "@/components/brand/logo";
import { useNeedsYouCount } from "@/features/needs-you/hooks";
import { useActiveMembership } from "@/lib/session/hooks";
import { AccountMenu } from "./account-menu";
import { MobileNavDrawer } from "./mobile-nav";
import { DensityToggle, ThemeToggle } from "./theme-density-controls";

function NeedsYouButton() {
  const { data } = useNeedsYouCount();
  return (
    <Button asChild variant="ghost" size="icon" className="relative">
      <Link href="/needs-you" aria-label={`Needs You${data ? `, ${data} open` : ""}`}>
        <Inbox aria-hidden />
        {data ? (
          <span className="tnum absolute -top-0.5 -right-0.5 inline-flex min-w-[1.05rem] items-center justify-center rounded-full bg-primary px-1 text-[0.625rem] font-semibold text-primary-fg ring-2 ring-surface">
            {data}
          </span>
        ) : null}
      </Link>
    </Button>
  );
}

export function Topbar() {
  const { organization, membership } = useActiveMembership();

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface/90 px-3 backdrop-blur-sm sm:px-4">
      <MobileNavDrawer />
      <div className="lg:hidden">
        <Logo size="sm" />
      </div>

      <div className="hidden min-w-0 items-center gap-2.5 lg:flex">
        <span className="truncate text-[0.875rem] font-medium text-fg">
          {organization?.displayName}
        </span>
        <Badge tone="outline">
          {organization?.type === "CARRIER" ? "Carrier" : "Dispatch agency"}
        </Badge>
        {membership?.scope.loads === "assigned" ? (
          <Badge tone="info">Assigned loads only</Badge>
        ) : null}
      </div>

      <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="icon" aria-label="Search" className="hidden sm:inline-flex">
          <Search aria-hidden />
        </Button>
        <DensityToggle className="hidden sm:inline-flex" />
        <ThemeToggle />
        <NeedsYouButton />
        <Button variant="ghost" size="icon" aria-label="Notifications" className="hidden sm:inline-flex">
          <Bell aria-hidden />
        </Button>
        <Separator orientation="vertical" className="mx-1 h-6" />
        <AccountMenu />
      </div>
    </header>
  );
}
