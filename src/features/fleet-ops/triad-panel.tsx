"use client";

import { ArrowRight, Users } from "lucide-react";
import Link from "next/link";
import type { FleetAssignmentTriad } from "@/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "./labels";

/**
 * The live Driver–Truck–Trailer assignments.
 *
 * Composed from two permanent records — the driver assignment and the trailer
 * attachment — rather than stored as a triad of its own. That is why an
 * incomplete triad is shown rather than hidden: a truck with a trailer and no
 * driver is a real arrangement, and it is usually the one somebody needs to
 * look at.
 */
export function TriadPanel({ triads }: { triads: FleetAssignmentTriad[] }) {
  return (
    <Card>
      <CardHeader className="flex-col items-start gap-1">
        <CardTitle>Current assignments</CardTitle>
        <CardDescription>
          Driver, power unit and trailer as they stand right now. Each leg is a dated record;
          reassigning ends the old one and opens a new one, and the ended rows are kept.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {triads.length === 0 ? (
          <p className="flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-4 text-[0.8125rem] text-fg-muted">
            <Users className="size-4 shrink-0 text-fg-subtle" aria-hidden />
            No driver is on a truck and no trailer is hooked up in this organization right now.
          </p>
        ) : (
          <ul className="space-y-2">
            {triads.map((t) => (
              <li
                key={t.truckId}
                className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-border bg-surface-sunken/40 px-3.5 py-2.5"
              >
                <Leg
                  label={t.driver?.driverName ?? "No driver"}
                  muted={!t.driver}
                  href={t.driver ? undefined : undefined}
                />
                <ArrowRight className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
                <Leg label={`Unit ${t.truckUnit}`} href={`/fleet/trucks/${t.truckId}`} />
                <ArrowRight className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
                <Leg
                  label={t.trailer?.trailerUnit ? `Trailer ${t.trailer.trailerUnit}` : "No trailer"}
                  muted={!t.trailer}
                  href={t.trailer?.trailerId ? `/fleet/trailers/${t.trailer.trailerId}` : undefined}
                />
                <span className="ml-auto text-[0.75rem] text-fg-subtle">
                  Effective {formatDate(t.effectiveFrom)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function Leg({ label, href, muted }: { label: string; href?: string; muted?: boolean }) {
  const className = muted
    ? "text-[0.8125rem] text-fg-subtle italic"
    : "text-[0.8125rem] font-medium text-fg";
  if (!href) return <span className={className}>{label}</span>;
  return (
    <Link
      href={href}
      className="text-[0.8125rem] font-medium text-fg underline-offset-4 hover:text-primary hover:underline"
    >
      {label}
    </Link>
  );
}
