"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Logo, LogoMark } from "@/components/brand/logo";
import { useUiStore } from "@/lib/session/store";
import { cn } from "@/lib/utils";
import { NavLink } from "./nav-link";
import { OrgSwitcher } from "./org-switcher";
import { useVisibleNav } from "./use-visible-nav";

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
        {main.map((section) => (
          <div key={section.id} className="mb-4">
            {section.label && !collapsed ? (
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

export function Sidebar() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggle = useUiStore((s) => s.toggleSidebar);

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200 lg:flex",
        collapsed ? "w-[4.25rem]" : "w-64",
      )}
    >
      <div
        className={cn(
          "flex h-14 items-center gap-2 px-4",
          collapsed && "justify-center px-2",
        )}
      >
        <Link href="/home" className="min-w-0">
          {collapsed ? <LogoMark /> : <Logo />}
        </Link>
      </div>

      <SidebarContent collapsed={collapsed} />

      <div
        className={cn(
          "flex h-12 items-center border-t border-border px-3",
          collapsed ? "justify-center px-2" : "justify-end",
        )}
      >
        <Button
          variant="ghost"
          size="iconSm"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}
        </Button>
      </div>
    </aside>
  );
}
