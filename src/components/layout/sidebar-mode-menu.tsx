"use client";

import { PanelLeft, PanelLeftClose, PanelLeftDashed } from "lucide-react";
import type { ComponentType } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuCheckIndicator, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SIDEBAR_MODES, type SidebarMode } from "@/lib/session/sidebar-mode-store";
import { cn } from "@/lib/utils";
import { useSidebarMode } from "./use-sidebar-mode";

interface SidebarModeOption {
  label: string;
  hint: string;
  icon: ComponentType<{ "aria-hidden"?: boolean; className?: string }>;
}

export const SIDEBAR_MODE_OPTIONS: Record<SidebarMode, SidebarModeOption> = {
  expanded: {
    label: "Expanded",
    hint: "Icons and labels",
    icon: PanelLeft,
  },
  icon: {
    label: "Icons only",
    hint: "Compact rail",
    icon: PanelLeftDashed,
  },
  hidden: {
    label: "Hidden",
    hint: "Open it from the logo",
    icon: PanelLeftClose,
  },
};

/**
 * The single visible control for the three sidebar modes. It lives in the
 * topbar so it is reachable in every mode — including the one where there is
 * no sidebar left to put a control in.
 */
export function SidebarModeMenu({ className }: { className?: string }) {
  const { mode, setMode } = useSidebarMode();
  const current = SIDEBAR_MODE_OPTIONS[mode];
  const CurrentIcon = current.icon;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(className)}
          aria-label={`Sidebar: ${current.label}. Change how the sidebar is displayed.`}
        >
          <CurrentIcon aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>Sidebar</DropdownMenuLabel>
        {SIDEBAR_MODES.map((value) => {
          const option = SIDEBAR_MODE_OPTIONS[value];
          const Icon = option.icon;
          return (
            <DropdownMenuItem key={value} onSelect={() => setMode(value)}>
              <Icon aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-fg">{option.label}</span>
                <span className="block truncate text-[0.75rem] text-fg-subtle">
                  {option.hint}
                </span>
              </span>
              <DropdownMenuCheckIndicator checked={value === mode} />
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
