"use client";

import { useMemo, useState } from "react";
import { ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import type { DocumentFilters } from "@/lib/api/contracts/documents";
import { useActiveMembership, useCan } from "@/lib/session/hooks";
import { WORKSPACE_KIND_LABEL, workspaceKindOf, type DocumentStatus } from "@/types";
import { MockUploadNotice } from "./chips";
import { DocumentFilterBar } from "./filter-bar";
import { DocumentList } from "./document-list";
import { RequirementsPanel } from "./requirements-panel";
import { SharesPanel } from "./shares-panel";
import { UpgradePanel } from "./upgrade-panel";
import {
  useDocumentAction, useDocumentList, useWorkspaceChecklist,
} from "./hooks";
import { cn } from "@/lib/utils";

type Tab = "documents" | "requirements" | "sharing" | "upgrade";

/**
 * THE Document Center.
 *
 * One organization's paperwork in one place: its own workspace documents, its
 * drivers', its trucks', its trailers', and the documents other organizations
 * have explicitly shared with it. They are not four lists joined on a screen —
 * they are one record type with one identity, read through one service.
 *
 * What is asked OF this workspace depends on what kind of workspace it is. A
 * dispatch organization is never shown a carrier's requirements, and an
 * individual dispatcher's personal paperwork is never treated as a dispatch
 * organization's. That is decided in the service from the active membership,
 * not here.
 */
export function DocumentCenterScreen() {
  const { organization } = useActiveMembership();
  const canUpload = useCan("documents:upload");
  const canApprove = useCan("documents:approve");

  const [tab, setTab] = useState<Tab>("documents");
  const [filters, setFilters] = useState<DocumentFilters>({});

  const list = useDocumentList(filters);
  const unfiltered = useDocumentList({});
  const checklist = useWorkspaceChecklist();
  const action = useDocumentAction();

  const kind = organization ? workspaceKindOf(organization) : null;
  const isIndividual = kind === "individual_dispatcher";

  const counts = useMemo(() => {
    const out: Partial<Record<DocumentStatus, number>> = {};
    for (const view of unfiltered.data ?? []) {
      out[view.status] = (out[view.status] ?? 0) + 1;
    }
    return out;
  }, [unfiltered.data]);

  const tabs: Array<[Tab, string]> = [
    ["documents", "Documents"],
    ["requirements", "Requirements"],
    ["sharing", "Sharing"],
    ...(isIndividual ? ([["upgrade", "Upgrade"]] as Array<[Tab, string]>) : []),
  ];

  if (list.error) {
    return (
      <div className="space-y-section">
        <PageHeader title="Documents" description="Every document this workspace holds." />
        <ErrorState
          title="Documents could not be loaded"
          description={list.error.message}
          onRetry={() => void list.refetch()}
        />
      </div>
    );
  }

  return (
    <div className="space-y-section">
      <PageHeader
        title="Documents"
        description="Every document this workspace holds, and everything it has been asked for."
        actions={
          kind ? (
            <Badge tone="outline">{WORKSPACE_KIND_LABEL[kind]}</Badge>
          ) : null
        }
      />

      <div className="flex flex-wrap gap-1.5 border-b border-border pb-2.5" role="tablist" aria-label="Document views">
        {tabs.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={cn(
              "rounded-full px-3 py-1.5 text-[0.8125rem] font-medium transition-colors",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              tab === value
                ? "bg-primary/12 text-primary"
                : "text-fg-muted hover:bg-surface-hover hover:text-fg",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "documents" ? (
        <div className="space-y-4">
          <DocumentFilterBar filters={filters} onChange={setFilters} counts={counts} />
          {list.isPending ? <LoadingSkeleton rows={6} /> : (
            <DocumentList documents={list.data ?? []} />
          )}
          <MockUploadNotice />
        </div>
      ) : null}

      {tab === "requirements" ? (
        <div className="space-y-4">
          {checklist.isPending || !organization ? <LoadingSkeleton rows={6} /> : checklist.data ? (
            <RequirementsPanel
              checklist={checklist.data}
              subject={{
                kind: "organization",
                id: organization.id,
                label: organization.displayName,
              }}
              canUpload={canUpload}
              busy={action.isPending}
              onAdd={(item, file) => {
                // Replacing versions; adding creates. The service decides which
                // by looking at the slot, but saying so here keeps the intent
                // visible in the screen that triggered it.
                if (item.document) {
                  action.mutate({ kind: "replace", documentId: item.document.documentId, file });
                  return;
                }
                action.mutate({
                  kind: "add",
                  input: {
                    typeKey: item.requirement.typeKey,
                    subject: {
                      kind: "organization",
                      id: organization.id,
                      label: organization.displayName,
                    },
                    requirementKey: item.requirement.key,
                    file,
                  },
                });
              }}
            />
          ) : null}
          {action.error ? (
            <p role="alert" className="text-[0.8125rem] text-st-danger">{action.error.message}</p>
          ) : null}
          <MockUploadNotice />
        </div>
      ) : null}

      {tab === "sharing" ? <SharesPanel canManage={canApprove} /> : null}

      {tab === "upgrade" ? <UpgradePanel /> : null}
    </div>
  );
}
