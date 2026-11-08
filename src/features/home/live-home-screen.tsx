"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { EmptyState } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { useVisibleNav } from "@/components/layout/use-visible-nav";
import { useActiveMembership, useSession } from "@/lib/session/hooks";
import { greeting } from "./greeting";

/**
 * Home in http mode (plan 08). The full Home is built from mock-only services,
 * so here it is a short page: who you are, where you are, and a card for each
 * live area this membership may open. The cards come from the same visible-nav
 * list as the sidebar, so they can never disagree with it.
 */
export function LiveHomeScreen() {
  const { user } = useSession();
  const { organization, membership } = useActiveMembership();
  const { main, settings } = useVisibleNav();

  const destinations = [...main, ...settings]
    .flatMap((section) => section.items)
    .filter((item) => item.href !== "/home");

  const firstName = user.displayName.split(" ")[0];
  const title = firstName ? `${greeting(new Date().getHours())}, ${firstName}` : "Welcome";
  const subtitle = organization
    ? `${organization.displayName} · ${membership?.isOwner ? "Owner" : (membership?.title ?? "Member")}`
    : undefined;

  return (
    <div className="space-y-section">
      <PageHeader title={title} description={subtitle} />
      {destinations.length === 0 ? (
        <EmptyState
          title="Nothing to open here yet"
          description="Your role doesn't include any of the areas that are connected to live data so far."
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {destinations.map(({ href, label, icon: Icon }) => (
            <li key={href}>
              <Link
                href={href}
                className="group flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3.5 shadow-e1 transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-fg-muted">
                  <Icon aria-hidden className="size-[1.125rem]" />
                </span>
                <span className="flex-1 text-[0.9375rem] font-medium text-fg">{label}</span>
                <ArrowRight aria-hidden className="size-4 text-fg-subtle transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
