"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "@/config/nav";
import { useNeedsYouCount } from "@/features/needs-you/hooks";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function useIsActive(href: string) {
  const pathname = usePathname();
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Live count for the nav item that declares it. Never guessed — it comes from
 *  the same permission- and scope-filtered service call the queue itself uses. */
function NavCount({ collapsed }: { collapsed: boolean }) {
  const { data } = useNeedsYouCount();
  if (!data) return null;
  return (
    <span
      className={cn(
        "tnum ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[0.6875rem] font-semibold text-primary-fg",
        collapsed && "absolute top-1 right-1 ml-0 px-1",
      )}
    >
      {data}
      <span className="sr-only"> items need you</span>
    </span>
  );
}

export function NavLink({
  item,
  collapsed = false,
  onNavigate,
}: {
  item: NavItem;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const active = useIsActive(item.href);
  const Icon = item.icon;

  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex h-nav-item items-center gap-3 rounded-md px-2.5 text-[0.875rem] font-medium transition-colors",
        collapsed && "justify-center px-0",
        active
          ? "bg-surface-hover text-fg"
          : "text-fg-muted hover:bg-surface-hover hover:text-fg",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute left-0 h-5 w-0.5 rounded-r-full bg-primary transition-opacity",
          active ? "opacity-100" : "opacity-0",
        )}
      />
      <Icon
        aria-hidden
        className={cn("size-[1.125rem] shrink-0", active ? "text-primary" : "text-fg-subtle")}
      />
      {collapsed ? <span className="sr-only">{item.label}</span> : <span className="truncate">{item.label}</span>}
      {item.showsNeedsYouCount ? <NavCount collapsed={collapsed} /> : null}
    </Link>
  );

  if (!collapsed) return link;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  );
}
