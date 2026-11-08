"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  clearAllAuthCookies,
} from "@/lib/api/auth-cookies";
import { toast } from "sonner";
import { LogOut, Settings2 } from "lucide-react";
import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage, initialsOf } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogClose } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import { ACCOUNT_NAV } from "@/config/nav";
import { useSession } from "@/lib/session/hooks";
import { LockedSection } from "./locked-section";

/**
 * The account area is personal and permanent — never permission-gated. A user
 * with no permissions in any organization still has a complete account.
 */
export function AccountMenu() {
  const { user } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showSignOut, setShowSignOut] = useState(false);
  const items = ACCOUNT_NAV.flatMap((s) => s.items);

  const handleSignOut = () => {
    clearAllAuthCookies();
    
    queryClient.clear();
    sessionStorage.removeItem("antcolos_signup_step");
    sessionStorage.removeItem("antcolos_signup_email");
    sessionStorage.removeItem("antcolos_signup_from_login");
    sessionStorage.setItem("antcolos_pending_toast", "Signed out successfully");
    router.push("/sign-in");
  };

  return (
    <>
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
        <LockedSection>
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
        </LockedSection>
        <DropdownMenuSeparator />
        <DropdownMenuItem 
          className="text-st-danger focus:text-st-danger focus:bg-st-danger-bg [&_svg]:text-st-danger"
          onSelect={(e) => {
            e.preventDefault();
            setShowSignOut(true);
          }}
        >
          <LogOut aria-hidden />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>

    <Dialog open={showSignOut} onOpenChange={setShowSignOut}>
      <DialogContent title="Sign out" description="Are you sure you want to sign out? You will need to sign in again to access your account.">
        <div className="mt-6 flex justify-end gap-3">
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button variant="danger" onClick={handleSignOut}>
            Sign out
          </Button>
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
