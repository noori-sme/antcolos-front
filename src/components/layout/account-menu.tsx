"use client";

import { LogOut, Settings2 } from "lucide-react";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage, initialsOf } from "@/components/ui/avatar";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ACCOUNT_NAV } from "@/config/nav";
import { useSession } from "@/lib/session/hooks";

/**
 * The account area is personal and permanent — never permission-gated. A user
 * with no permissions in any organization still has a complete account.
 */
export function AccountMenu() {
  const { user } = useSession();
  const items = ACCOUNT_NAV.flatMap((s) => s.items);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        aria-label="Account menu"
      >
        <Avatar className="size-8 ring-1 ring-border">
          {user.avatarUrl ? <AvatarImage src={user.avatarUrl} alt="" /> : null}
          <AvatarFallback>{initialsOf(user.displayName)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <div className="px-2.5 py-2">
          <p className="truncate text-[0.875rem] font-semibold text-fg">
            {user.displayName}
          </p>
          <p className="truncate text-[0.75rem] text-fg-subtle">{user.email}</p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Personal</DropdownMenuLabel>
        {items.map((item) => (
          <DropdownMenuItem key={item.href} asChild>
            <Link href={item.href}>
              <item.icon aria-hidden />
              {item.label}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings/organization">
            <Settings2 aria-hidden />
            Organization settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem>
          <LogOut aria-hidden />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
