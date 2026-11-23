"use client";

import { useState } from "react";
import { Building2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { useServiceContext } from "@/lib/api/use-service-context";
import { ROLE_TITLES } from "@/lib/session/http-roster";
import type { MyOrganization } from "@/types/carrier-authority";
import { useLeaveOrganization, useMyOrganizations } from "./hooks";

const TYPE_LABEL: Record<string, string> = { CARRIER: "Carrier", DISPATCHING_COMPANY: "Dispatch company" };
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** Every organization the person belongs to, with Leave (plan 25). */
export function MyOrganizationsScreen() {
  const ctx = useServiceContext();
  const { data, isLoading, isError, error, refetch } = useMyOrganizations();
  const leave = useLeaveOrganization();
  const [leaving, setLeaving] = useState<MyOrganization | null>(null);
  const orgs = data ?? [];

  return (
    <div className="space-y-section">
      <PageHeader title="My organizations" description="Where you work. Leaving one never deletes your Antcolos account." />
      {(isLoading || !ctx) && <LoadingSkeleton rows={2} />}
      {isError && <ErrorState title="Couldn't load your organizations" description={error?.message} onRetry={() => refetch()} />}
      {ctx && !isLoading && !isError && orgs.length === 0 && (
        <EmptyState icon={Building2} title="No organizations" description="When a carrier or dispatch company adds you, it shows up here." />
      )}
      {orgs.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {orgs.map((org) => {
            const current = org.organizationId === ctx?.organizationId;
            return (
              <li key={org.organizationId} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-fg">{org.name}</span>
                    {current && <Badge tone="info">Current</Badge>}
                  </div>
                  <p className="text-[0.8125rem] text-fg-muted">
                    {TYPE_LABEL[org.type] ?? org.type} · {ROLE_TITLES[org.roleId] ?? "Member"} · joined {day(org.joinedAt)}
                  </p>
                </div>
                <Button variant="secondary" size="sm" onClick={() => { leave.reset(); setLeaving(org); }}>
                  Leave
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {leaving && (
        <Dialog open onOpenChange={(open) => !open && !leave.isPending && setLeaving(null)}>
          <DialogContent
            title={`Leave ${leaving.name}?`}
            description={
              leaving.organizationId === ctx?.organizationId
                ? "You are working in this organization now, so you will be signed out of it. Your Antcolos account stays."
                : "You lose access to its trucks and loads. Your Antcolos account stays."
            }
          >
            {leave.error && <p role="alert" className="mt-3 text-[0.8125rem] text-st-danger">{leave.error.message}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setLeaving(null)} disabled={leave.isPending}>Cancel</Button>
              <Button
                variant="danger"
                disabled={leave.isPending}
                onClick={() => leave.mutate(leaving, { onSuccess: () => setLeaving(null) })}
              >
                Leave
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
