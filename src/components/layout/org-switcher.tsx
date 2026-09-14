"use client";

import { Building2, Check, ChevronsUpDown, Plus, Truck, UserRound } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useActiveMembership, useSession } from "@/lib/session/hooks";
import { workspaceKindOf, type Organization } from "@/types";
import { cn } from "@/lib/utils";

/**
 * Switching changes the ACTIVE MEMBERSHIP, never the identity. The profile,
 * avatar, name, theme and density stay exactly as they were; the sidebar,
 * routes and every permission check recompute; the data cache is discarded.
 */
export function OrgSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const { memberships, organizations, switchOrganization } = useSession();
  const { membership, organization } = useActiveMembership();

  const active = memberships.filter((m) => m.status === "active");
  const orgOf = (id: string) => organizations.find((o) => o.id === id);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "flex w-full items-center gap-2.5 rounded-md border border-border bg-surface px-2.5 py-2 text-left transition-colors hover:bg-surface-hover",
          collapsed && "justify-center px-0",
        )}
        aria-label="Switch organization"
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/12 text-primary">
          {organization ? <WorkspaceIcon organization={organization} className="size-4" /> : (
            <Building2 aria-hidden className="size-4" />
          )}
        </span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.8125rem] leading-4 font-semibold text-fg">
                {organization?.displayName ?? "No organization"}
              </span>
              <span className="block truncate text-[0.75rem] leading-4 text-fg-subtle">
                {membership?.isOwner ? "Owner" : (membership?.title ?? "Member")}
              </span>
            </span>
            <ChevronsUpDown aria-hidden className="size-4 shrink-0 text-fg-subtle" />
          </>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        {active.map((m) => {
          const org = orgOf(m.organizationId);
          const isActive = m.id === membership?.id;
          return (
            <DropdownMenuItem
              key={m.id}
              onSelect={() => switchOrganization(m.id)}
              className="items-start"
            >
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-fg-muted">
                {org ? <WorkspaceIcon organization={org} className="size-3.5" /> : (
                  <Building2 aria-hidden className="size-3.5" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-fg">
                  {org?.displayName}
                </span>
                <span className="mt-0.5 flex items-center gap-1.5">
                  <span className="truncate text-[0.75rem] text-fg-subtle">
                    {m.isOwner ? "Owner" : (m.title ?? "Member")}
                  </span>
                  {m.driverProfileId ? (
                    <Badge tone="outline" className="px-1 py-0 text-[0.625rem]">
                      Driver
                    </Badge>
                  ) : null}
                </span>
              </span>
              {isActive ? <Check aria-hidden className="mt-1 size-4 text-primary" /> : null}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/account/organizations">
            <Plus aria-hidden />
            Join or manage organizations
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * A carrier, a dispatch company and one person working for themselves are three
 * different things, and the switcher says which at a glance.
 */
function WorkspaceIcon({
  organization,
  className,
}: {
  organization: Pick<Organization, "type" | "individual">;
  className?: string;
}) {
  const kind = workspaceKindOf(organization);
  if (kind === "carrier_organization") return <Truck aria-hidden className={className} />;
  if (kind === "individual_dispatcher") return <UserRound aria-hidden className={className} />;
  return <Building2 aria-hidden className={className} />;
}
