"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { predictionErrorText } from "@/lib/fleet/availability";
import { useAvailabilityHistory } from "./hooks";
import { History } from "lucide-react";

const dateTime = new Intl.DateTimeFormat(undefined, {
  month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});
const when = (iso: string | null) => (iso ? dateTime.format(new Date(iso)) : "—");

/** Stored predictions for one truck against when it actually came empty (plan 23). */
export function AvailabilityHistoryDialog({
  truckId, unitNumber, open, onOpenChange,
}: {
  truckId: string;
  unitNumber?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, error, refetch } = useAvailabilityHistory(truckId, page, open);
  const rows = data?.data ?? [];
  const meta = data?.meta;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Empty-time predictions${unitNumber ? ` · Unit ${unitNumber}` : ""}`}
        description="What we expected and what happened, newest first. Times are in your time zone."
        className="max-w-2xl"
      >
        <div className="mt-4 space-y-4">
          {isLoading && <LoadingSkeleton rows={3} />}
          {isError && (
            <ErrorState
              title="Couldn't load the predictions"
              description={error?.message}
              onRetry={() => refetch()}
            />
          )}
          {!isLoading && !isError && rows.length === 0 && (
            <EmptyState
              icon={History}
              title="No predictions stored yet"
              description="An hourly job records one whenever a load's planned empty time changes."
            />
          )}
          {rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[0.8125rem]">
                <thead className="text-fg-muted">
                  <tr className="border-b border-border">
                    <th scope="col" className="py-2 pr-3 font-medium">Expected empty</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Recorded</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Actually empty</th>
                    <th scope="col" className="py-2 font-medium">Accuracy</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={`${row.loadId}-${row.predictedEmptyAt}`} className="border-b border-border/60">
                      <td className="py-2 pr-3 tabular-nums text-fg">{when(row.predictedEmptyAt)}</td>
                      <td className="py-2 pr-3 tabular-nums text-fg-muted">{when(row.recordedAt)}</td>
                      <td className="py-2 pr-3 tabular-nums text-fg">{when(row.actualEmptyAt)}</td>
                      <td className="py-2 text-fg">{predictionErrorText(row.errorMinutes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {meta && meta.totalPages > 1 && (
            <div className="flex items-center justify-end gap-2">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Newer
              </Button>
              <span className="text-[0.8125rem] tabular-nums text-fg-muted">
                Page {meta.page} of {meta.totalPages}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= meta.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Older
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
