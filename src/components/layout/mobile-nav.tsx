"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Menu, MoreHorizontal, X } from "lucide-react";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { useUiStore } from "@/lib/session/store";
import { cn } from "@/lib/utils";
import { useIsActive } from "./nav-link";
import { SidebarContent } from "./sidebar";
import { useVisibleNav } from "./use-visible-nav";

/** Slide-over drawer holding the full navigation on small screens. */
export function MobileNavDrawer() {
  const open = useUiStore((s) => s.mobileNavOpen);
  const setOpen = useUiStore((s) => s.setMobileNavOpen);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
          <Menu aria-hidden />
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/45 lg:hidden" />
        <Dialog.Content
          className="fixed inset-y-0 left-0 z-50 flex w-[17.5rem] flex-col border-r border-border bg-surface shadow-e3 outline-none lg:hidden"
          aria-describedby={undefined}
        >
          <Dialog.Title className="sr-only">Navigation</Dialog.Title>
          <div className="flex h-14 items-center justify-between px-4">
            <Logo />
            <Dialog.Close asChild>
              <Button variant="ghost" size="iconSm" aria-label="Close navigation">
                <X aria-hidden />
              </Button>
            </Dialog.Close>
          </div>
          <SidebarContent onNavigate={() => setOpen(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Bottom bar for touch. Larger targets, simplified labels — High-Contrast
 * Utility principles, same tokens as the desktop shell.
 */
export function MobileTabBar() {
  const { mobilePrimary } = useVisibleNav();
  const setOpen = useUiStore((s) => s.setMobileNavOpen);

  if (mobilePrimary.length === 0) return null;

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="grid grid-cols-5">
        {mobilePrimary.map((item) => (
          <li key={item.href}>
            <MobileTabLink href={item.href} label={item.label} icon={item.icon} />
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex h-14 w-full flex-col items-center justify-center gap-1 text-fg-muted transition-colors active:bg-surface-hover"
          >
            <MoreHorizontal aria-hidden className="size-5" />
            <span className="text-[0.6875rem] leading-none font-medium">More</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}

function MobileTabLink({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}) {
  const active = useIsActive(href);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-14 flex-col items-center justify-center gap-1 transition-colors active:bg-surface-hover",
        active ? "text-primary" : "text-fg-muted",
      )}
    >
      <Icon aria-hidden className="size-5" />
      <span className="max-w-full truncate px-1 text-[0.6875rem] leading-none font-medium">
        {label}
      </span>
    </Link>
  );
}
