"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Wrench } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Can } from "@/components/auth/can";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { MaintenanceTaskBadge } from "@/components/common/status-badge";
import { taskDueSummary } from "@/lib/maintenance/due";
import {
  OPEN_TASK_STATUSES, type MaintenanceTask, type MaintenanceTaskStatus,
} from "@/types/maintenance-live";
import { useAcknowledgeTask, useMaintenanceTasks } from "./hooks";
import { CompleteDialog, DeferDialog } from "./maintenance-dialogs";

const PAGE_SIZE = 50;
const VIEWS = {
  open: { label: "Open", status: OPEN_TASK_STATUSES },
  done: { label: "Completed", status: ["COMPLETED"] as const },
  all: { label: "All", status: undefined },
} satisfies Record<string, { label: string; status: readonly MaintenanceTaskStatus[] | undefined }>;
type View = keyof typeof VIEWS;
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** The fleet's maintenance tasks, open work first (F2.3, plan 24). */
export function ServiceDueScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const view: View = (Object.keys(VIEWS) as View[]).find((v) => v === params.get("view")) ?? "open";
  // The page belongs to the view it was chosen in; back/forward to another view starts at 1.
  const [paging, setPaging] = useState<{ view: View; page: number }>({ view, page: 1 });
  const page = paging.view === view ? paging.page : 1;
  const [dialog, setDialog] = useState<{ kind: "defer" | "complete"; task: MaintenanceTask } | null>(null);

  const { data, isLoading, isError, error, refetch, isPlaceholderData } = useMaintenanceTasks({
    status: VIEWS[view].status,
    page,
    pageSize: PAGE_SIZE,
  });
  const acknowledge = useAcknowledgeTask();
  const [ackKeys] = useState(() => new Map<string, string>());
  const tasks = data?.data ?? [];
  const meta = data?.meta;

  const select = (next: View) => {
    const qs = new URLSearchParams(params.toString());
    if (next === "open") qs.delete("view");
    else qs.set("view", next);
    const query = qs.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  return (
    <div className="space-y-section">
      <PageHeader title="Service due" description="Maintenance the fleet's trucks have come due for, open work first." />

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter tasks">
        {(Object.keys(VIEWS) as View[]).map((v) => (
          <Chip key={v} label={VIEWS[v].label} selected={view === v} onToggle={() => select(v)} />
        ))}
      </div>

      {isLoading && <LoadingSkeleton rows={4} />}
      {isError && !data && (
        <ErrorState title="Couldn't load maintenance tasks" description={error?.message} onRetry={() => refetch()} />
      )}
      {!isLoading && !(isError && !data) && tasks.length === 0 && (
        <EmptyState
          icon={Wrench}
          title={view === "open" ? "Nothing due" : "No tasks here"}
          description="Tasks appear when a truck's service interval comes due. Set intervals on each truck's page."
          action={
            <Button variant="secondary" asChild>
              <Link href="/fleet/trucks">Go to trucks</Link>
            </Button>
          }
        />
      )}

      {tasks.length > 0 && (
        <ul
          aria-busy={isPlaceholderData}
          className={`divide-y divide-border rounded-lg border border-border bg-surface ${isPlaceholderData ? "opacity-60" : ""}`}
        >
          {tasks.map((task) => (
            <li key={task.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/fleet/trucks/${task.truckId}`} className="font-semibold text-fg hover:text-primary">
                    Unit {task.unitNumber ?? "—"}
                  </Link>
                  <span className="text-fg">{task.title}</span>
                  <MaintenanceTaskBadge status={task.status} />
                </div>
                <p className="text-[0.8125rem] text-fg-muted">
                  {taskDueSummary(task)} · opened {day(task.openedAt)}
                  {task.status === "DEFERRED" && task.deferredUntil ? ` · deferred to ${day(task.deferredUntil)}` : ""}
                  {task.completedAt ? ` · done ${day(task.completedAt)}` : ""}
                </p>
              </div>
              {(OPEN_TASK_STATUSES as readonly string[]).includes(task.status) && (
                <Can permission="maintenance:manage">
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {task.status === "OPEN" && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={acknowledge.isPending}
                        onClick={() => {
                          if (!ackKeys.has(task.id)) ackKeys.set(task.id, crypto.randomUUID());
                          acknowledge.mutate(
                            { taskId: task.id, idempotencyKey: ackKeys.get(task.id)! },
                            { onSuccess: () => ackKeys.delete(task.id) },
                          );
                        }}
                      >
                        Acknowledge
                      </Button>
                    )}
                    {task.status !== "DEFERRED" && (
                      <Button variant="secondary" size="sm" onClick={() => setDialog({ kind: "defer", task })}>Defer</Button>
                    )}
                    <Button variant="primary" size="sm" onClick={() => setDialog({ kind: "complete", task })}>Complete</Button>
                  </div>
                </Can>
              )}
            </li>
          ))}
        </ul>
      )}
      {acknowledge.error && <p role="alert" className="text-[0.8125rem] text-st-danger">{acknowledge.error.message}</p>}

      {meta && meta.totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-[0.8125rem] tabular-nums text-fg-muted">
            Page {meta.page} of {meta.totalPages} · {meta.totalItems} tasks
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPaging({ view, page: page - 1 })}>Previous</Button>
            <Button variant="secondary" size="sm" disabled={page >= meta.totalPages} onClick={() => setPaging({ view, page: page + 1 })}>Next</Button>
          </div>
        </div>
      )}

      {dialog?.kind === "defer" && <DeferDialog task={dialog.task} onClose={() => setDialog(null)} />}
      {dialog?.kind === "complete" && <CompleteDialog task={dialog.task} onClose={() => setDialog(null)} />}
    </div>
  );
}
