"use client";

import { Monitor, Moon, Rows2, Rows3, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import { useSession } from "@/lib/session/hooks";
import { cn } from "@/lib/utils";

const subscribeNoop = () => () => {};

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  // false during SSR and the first paint, true once hydrated — avoids rendering
  // a theme icon the server could not know.
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false);

  // Until hydrated, `theme` is unknown — render a stable neutral state so the
  // server and client markup agree.
  const current = mounted ? (theme ?? "system") : "system";
  const next = current === "system" ? "light" : current === "light" ? "dark" : "system";
  const Icon = !mounted
    ? Monitor
    : current === "system"
      ? Monitor
      : resolvedTheme === "dark"
        ? Moon
        : Sun;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(next)}
          aria-label={`Theme: ${current}. Switch to ${next}.`}
        >
          <Icon aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Theme — {current}</TooltipContent>
    </Tooltip>
  );
}

/** Density is a User preference, so it follows the person across organizations. */
export function DensityToggle({ className }: { className?: string }) {
  const { density, setDensity } = useSession();
  const isCompact = density === "compact";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(className)}
          onClick={() => setDensity(isCompact ? "comfortable" : "compact")}
          aria-label={`Density: ${density}. Switch to ${isCompact ? "comfortable" : "compact"}.`}
        >
          {isCompact ? <Rows3 aria-hidden /> : <Rows2 aria-hidden />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>Density — {density}</TooltipContent>
    </Tooltip>
  );
}
