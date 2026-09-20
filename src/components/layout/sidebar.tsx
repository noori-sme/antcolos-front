"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { PanelLeft, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import Link from "next/link";
import { Logo, LogoMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { NavLink } from "./nav-link";
import { OrgSwitcher } from "./org-switcher";
import { useSidebarMode } from "./use-sidebar-mode";
import { useVisibleNav } from "./use-visible-nav";

/** Docked widths. The rail is wide enough for a centred 2.375rem target. */
const RAIL_WIDTH = "w-[4.25rem]";
const DOCKED_WIDTH = "w-64";
/** The drawer is the expanded sidebar, so it is the expanded sidebar's width. */
const DRAWER_WIDTH = "w-64";

export function SidebarContent({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const { main, settings } = useVisibleNav();

  return (
    <>
      <div className={cn("px-3 pb-3", collapsed && "px-2")}>
        <OrgSwitcher collapsed={collapsed} />
      </div>

      <nav
        aria-label="Main"
        className={cn("flex-1 overflow-y-auto px-3 pb-4", collapsed && "px-2")}
      >
        {main.map((section, index) => (
          <div key={section.id} className="mb-4">
            {/* A rail has no room for section headings, so the grouping is kept
                by a hairline instead of dropped. */}
            {collapsed ? (
              index > 0 ? (
                <div aria-hidden className="mx-auto mb-3 h-px w-6 bg-border" />
              ) : null
            ) : section.label ? (
              <p className="px-2.5 pb-1.5 text-[0.6875rem] font-semibold tracking-wider text-fg-subtle uppercase">
                {section.label}
              </p>
            ) : null}
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <li key={item.href}>
                  <NavLink item={item} collapsed={collapsed} onNavigate={onNavigate} />
                </li>
              ))}
            </ul>
          </div>
        ))}

        {settings.length > 0 ? (
          <div className="mt-auto border-t border-border pt-4">
            {settings.map((section) => (
              <div key={section.id}>
                {!collapsed ? (
                  <p className="px-2.5 pb-1.5 text-[0.6875rem] font-semibold tracking-wider text-fg-subtle uppercase">
                    Settings
                  </p>
                ) : null}
                <ul className="space-y-0.5">
                  {section.items.map((item) => (
                    <li key={item.href}>
                      <NavLink item={item} collapsed={collapsed} onNavigate={onNavigate} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : null}
      </nav>
    </>
  );
}

/** The brand row at the top of the sidebar, in whichever width it is sitting. */
function SidebarBrand({ collapsed }: { collapsed: boolean }) {
  return (
    <div
      className={cn("flex h-14 items-center gap-2 px-4", collapsed && "justify-center px-2")}
    >
      <Link href="/home" className="min-w-0" aria-label="Antcolos home">
        {collapsed ? <LogoMark /> : <Logo />}
      </Link>
    </div>
  );
}

/**
 * The docked sidebar: expanded, or the icon rail. "Hidden" is not a narrower
 * sidebar, it is no sidebar — it renders as the drawer below instead.
 */
export function Sidebar() {
  const { mode, setMode } = useSidebarMode();
  const collapsed = mode === "icon";

  if (mode === "hidden") return null;

  return (
    <aside
      data-sidebar-mode={mode}
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200 ease-out lg:flex",
        collapsed ? RAIL_WIDTH : DOCKED_WIDTH,
      )}
    >
      <SidebarBrand collapsed={collapsed} />
      <SidebarContent collapsed={collapsed} />

      <div
        className={cn(
          "flex h-12 items-center border-t border-border px-3",
          collapsed ? "justify-center px-2" : "justify-end",
        )}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="iconSm"
              onClick={() => setMode(collapsed ? "expanded" : "icon")}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar to icons"}
            >
              {collapsed ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side={collapsed ? "right" : "top"}>
            {collapsed ? "Expand sidebar" : "Collapse to icons"}
          </TooltipContent>
        </Tooltip>
      </div>
    </aside>
  );
}

/**
 * The sidebar in "hidden" mode: undocked, opened from the logo in the topbar,
 * closed by Escape, by clicking away, or by following a link. Radix owns the
 * focus trap, the return of focus and the dismiss behaviour.
 *
 * It is not breakpoint-gated, only its trigger is. A drawer that vanished at a
 * narrower width while still holding the focus trap would be a trap with
 * nothing in it — dragging the window narrow leaves a drawer you can still see
 * and still close.
 */
export function SidebarOverlay() {
  const { mode, overlayOpen, setOverlayOpen, setMode } = useSidebarMode();

  return (
    <Dialog.Root open={mode === "hidden" && overlayOpen} onOpenChange={setOverlayOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/45 data-[state=open]:animate-overlay-in data-[state=closed]:animate-overlay-out" />
        <Dialog.Content
          className={cn(
            "fixed inset-y-0 left-0 z-50 flex flex-col border-r border-border bg-surface shadow-e3 outline-none",
            "data-[state=open]:animate-drawer-in data-[state=closed]:animate-drawer-out",
            DRAWER_WIDTH,
          )}
          aria-describedby={undefined}
        >
          <Dialog.Title className="sr-only">Navigation</Dialog.Title>
          <div className="flex h-14 items-center justify-between px-4">
            <Link href="/home" onClick={() => setOverlayOpen(false)} aria-label="Antcolos home">
              <Logo />
            </Link>
            <Dialog.Close asChild>
              <Button variant="ghost" size="iconSm" aria-label="Close navigation">
                <X aria-hidden />
              </Button>
            </Dialog.Close>
          </div>

          <SidebarContent onNavigate={() => setOverlayOpen(false)} />

          <div className="flex h-12 items-center justify-end border-t border-border px-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMode("expanded")}
              aria-label="Dock sidebar, keeping it open"
            >
              <PanelLeft aria-hidden />
              Dock sidebar
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * The only thing left of the sidebar in "hidden" mode. The logo is the trigger,
 * so the brand keeps its place in the top-left corner and doubles as the way
 * back to the navigation.
 */
export function SidebarLogoTrigger() {
  const { mode, setOverlayOpen } = useSidebarMode();
  if (mode !== "hidden") return null;

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setOverlayOpen(true)}
            aria-haspopup="dialog"
            aria-label="Antcolos — open navigation"
            className="hidden shrink-0 items-center rounded-md px-1.5 py-1 transition-colors hover:bg-surface-hover lg:inline-flex"
          >
            <Logo size="sm" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Open navigation</TooltipContent>
      </Tooltip>
      {/* The brand and the workspace are two different things, and with the
          sidebar gone they would otherwise run together. */}
      <span aria-hidden className="hidden h-6 w-px shrink-0 bg-border lg:block" />
    </>
  );
}
