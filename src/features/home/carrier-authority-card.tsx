"use client";

import { useState } from "react";
import { History, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Can } from "@/components/auth/can";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { CarrierAuthorityBadge } from "@/components/common/status-badge";
import { authorityAgeText, authorityList } from "@/lib/carrier-authority/format";
import { useCarrierAuthority, useCarrierAuthorityHistory, useRefreshCarrierAuthority } from "./hooks";

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** The carrier's stored FMCSA authority (plan 25). Rendered inside `<Can carrier:authority:view>`. */
export function CarrierAuthorityCard() {
  const { data, isLoading, isError, error, refetch } = useCarrierAuthority();
  const refresh = useRefreshCarrierAuthority();
  const [historyOpen, setHistoryOpen] = useState(false);

  const checkNow = (
    <Can permission="carrier:authority:refresh">
      <Button variant="secondary" size="sm" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
        <RefreshCw aria-hidden className={refresh.isPending ? "animate-spin" : undefined} />
        Check FMCSA now
      </Button>
    </Can>
  );

  return (
    <section aria-labelledby="carrier-authority" className="rounded-lg border border-border bg-surface p-5 shadow-e1">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="carrier-authority" className="text-[0.9375rem] font-semibold text-fg">FMCSA authority</h2>
        {data && (
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
              <History aria-hidden /> History
            </Button>
            {checkNow}
          </div>
        )}
      </div>

      {isLoading && <div className="mt-4"><LoadingSkeleton rows={1} /></div>}
      {isError && (
        <div className="mt-4"><ErrorState title="Couldn't load your authority" description={error?.message} onRetry={() => refetch()} /></div>
      )}
      {!isLoading && !isError && !data && (
        <div className="mt-4">
          <EmptyState icon={ShieldCheck} title="Never checked" description="Check FMCSA to store your operating authority and how long you have held it." action={checkNow} />
        </div>
      )}
      {data && (
        <dl className="mt-4 grid gap-3 text-[0.8125rem] sm:grid-cols-2">
          <div className="flex flex-wrap items-center gap-2">
            <dt className="sr-only">Status</dt>
            <dd><CarrierAuthorityBadge status={data.status} /></dd>
            <dd className="text-fg-muted">{data.allowedToOperate ? "Allowed to operate" : "Not allowed to operate"}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Authority for</dt>
            <dd className="font-medium text-fg">{authorityAgeText(data.authorityAgeDays)}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">MC / DOT</dt>
            <dd className="text-fg">{data.mcNumber ?? "—"} · {data.dotNumber}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">Last checked</dt>
            <dd className="text-fg">{day(data.checkedAt)}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-fg-muted">Authorities</dt>
            <dd className="text-fg">{authorityList(data.authorities)}</dd>
          </div>
        </dl>
      )}
      {refresh.isSuccess && (
        <p role="status" className="mt-3 text-[0.8125rem] text-fg-muted">
          {refresh.data.changed ? "Changed since the last check." : "No change since the last check."}
        </p>
      )}
      {refresh.error && <p role="alert" className="mt-3 text-[0.8125rem] text-st-danger">{refresh.error.message}</p>}

      {historyOpen && <AuthorityHistoryDialog onClose={() => setHistoryOpen(false)} />}
    </section>
  );
}

function AuthorityHistoryDialog({ onClose }: { onClose: () => void }) {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, error, refetch } = useCarrierAuthorityHistory(page, true);
  const rows = data?.data ?? [];
  const meta = data?.meta;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title="Authority checks" description="Every check against FMCSA, newest first." className="max-w-2xl">
        <div className="mt-4 space-y-3">
          {isLoading && <LoadingSkeleton rows={3} />}
          {isError && <ErrorState title="Couldn't load the checks" description={error?.message} onRetry={() => refetch()} />}
          {rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[0.8125rem]">
                <thead className="text-fg-muted">
                  <tr className="border-b border-border">
                    <th scope="col" className="py-2 pr-3 font-medium">Checked</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Status</th>
                    <th scope="col" className="py-2 pr-3 font-medium">MC</th>
                    <th scope="col" className="py-2 font-medium">Authorities</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-border/60">
                      <td className="py-2 pr-3 text-fg">{day(r.checkedAt)}</td>
                      <td className="py-2 pr-3"><CarrierAuthorityBadge status={r.status} /></td>
                      <td className="py-2 pr-3 text-fg">{r.mcNumber ?? "—"}</td>
                      <td className="py-2 text-fg-muted">{authorityList(r.authorities)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {meta && meta.totalPages > 1 && (
            <div className="flex items-center justify-end gap-2">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Newer</Button>
              <span className="text-[0.8125rem] tabular-nums text-fg-muted">Page {meta.page} of {meta.totalPages}</span>
              <Button variant="secondary" size="sm" disabled={page >= meta.totalPages} onClick={() => setPage((p) => p + 1)}>Older</Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
