"use client";

import { ArrowRight, Gauge, Lock } from "lucide-react";
import Link from "next/link";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PermissionBadge } from "@/components/auth/permission-badge";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { audienceExplanation } from "@/lib/reports/audience";
import { AUDIENCE_LABEL, GROUP_ORDER, REPORT_GROUP_LABEL } from "@/lib/reports/catalog";
import type { ReportCatalogEntry, ReportGroup } from "@/types";
import { useReportSources, useReportWorkspace } from "./hooks";
import { SourceList } from "./source-notice";
import { ReportDenied, deniedPermissions } from "./states";

/**
 * The reporting index.
 *
 * What a membership is offered here is decided by the service: the workspace's
 * type, the audience its permissions put it in, and the keys each report needs.
 * A report it may not run is shown as locked with the missing permission named,
 * rather than hidden — knowing a number exists is not the same as seeing it.
 */
export function ReportsScreen() {
  const workspace = useReportWorkspace();
  const sources = useReportSources();

  if (workspace.isPending) {
    return (
      <div className="space-y-section">
        <PageHeader title="Reports" description="Loading what you can report on…" />
        <LoadingSkeleton rows={6} />
      </div>
    );
  }

  if (workspace.isError) {
    const denied = deniedPermissions(workspace.error);
    return (
      <div className="space-y-section">
        <PageHeader title="Reports" />
        {denied ? (
          <ReportDenied
            required={denied}
            message="Reporting analyses confirmed records from across the business, so it is gated on its own permission."
          />
        ) : (
          <ErrorState description={workspace.error.message} onRetry={() => workspace.refetch()} />
        )}
      </div>
    );
  }

  const { audience, entries, organizationName } = workspace.data;
  const byGroup = new Map<ReportGroup, ReportCatalogEntry[]>();
  for (const entry of entries) {
    byGroup.set(entry.definition.group, [
      ...(byGroup.get(entry.definition.group) ?? []),
      entry,
    ]);
  }

  return (
    <div className="space-y-section">
      <PageHeader
        title="Reports"
        description={audienceExplanation(audience, organizationName)}
        actions={<Badge tone="outline">{AUDIENCE_LABEL[audience]}</Badge>}
      />

      {entries.length === 0 ? (
        <EmptyState
          icon={Gauge}
          title="No reports for this membership"
          description="Reporting is open to you, but no report in the catalog matches this workspace."
        />
      ) : (
        GROUP_ORDER.filter((group) => byGroup.has(group)).map((group) => (
          <section key={group} className="space-y-3">
            <h2 className="text-[0.75rem] font-semibold tracking-wide text-fg-subtle uppercase">
              {REPORT_GROUP_LABEL[group]}
            </h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {byGroup.get(group)!.map((entry) => (
                <ReportCard key={entry.definition.id} entry={entry} />
              ))}
            </div>
          </section>
        ))
      )}

      <Card>
        <CardHeader>
          <CardTitle>Where these numbers come from</CardTitle>
        </CardHeader>
        <CardContent>
          {sources.isPending ? (
            <LoadingSkeleton rows={3} />
          ) : sources.isError ? (
            <ErrorState description={sources.error.message} onRetry={() => sources.refetch()} />
          ) : (
            <>
              <p className="mb-4 text-[0.8125rem] text-fg-muted">
                Reporting reads records the other modules own. It creates none of its
                own — no load, invoice, settlement, document, carrier, driver, truck,
                trailer, broker, shipper or receiver record is ever written here.
              </p>
              <SourceList sources={sources.data} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ReportCard({ entry }: { entry: ReportCatalogEntry }) {
  const { definition, available, missingPermissions } = entry;

  if (!available) {
    return (
      <Card className="border-dashed">
        <CardContent className="pt-4">
          <div className="flex items-start gap-2">
            <Lock aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
            <div className="min-w-0">
              <p className="text-[0.9375rem] font-semibold text-fg-muted">
                {definition.title}
              </p>
              <p className="mt-1 text-[0.8125rem] text-fg-subtle">{definition.description}</p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {missingPermissions.map((key) => (
                  <PermissionBadge key={key} permissionKey={key} />
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="transition-colors hover:border-border-strong hover:bg-surface-hover">
      <Link href={`/reports/${definition.id}`} className="block rounded-lg">
        <CardContent className="pt-4">
          <p className="flex items-center gap-1.5 text-[0.9375rem] font-semibold text-fg">
            {definition.title}
            <ArrowRight aria-hidden className="size-3.5 text-fg-subtle" />
          </p>
          <p className="mt-1 text-[0.8125rem] leading-5 text-fg-muted">
            {definition.description}
          </p>
          <p className="mt-2.5 text-[0.75rem] text-fg-subtle">
            By {definition.rowLabel.toLowerCase()} · {definition.views.length} views
          </p>
        </CardContent>
      </Link>
    </Card>
  );
}
