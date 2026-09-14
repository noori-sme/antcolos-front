"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ACTIVITIES, activityMeta } from "@/lib/driver-workflow/catalog";
import type { ActivityPayload } from "@/lib/driver-workflow/commands";
import { money, dateTimeIn } from "@/lib/utils";
import type { ActivityKind, DriverWorkflowView, UploadDescriptor } from "@/types";
import { UploadButtons } from "./document-actions";
import { ACTIVITY_ICON } from "./labels";

/**
 * Rest, fuel, inspections, traffic, scales, delays, detention, damage.
 *
 * These are repeatable ACTIVITY events, not statuses: a driver can rest four
 * times and fuel twice on one trip, and every occurrence is its own record. Not
 * one of them replaces a milestone or closes another activity.
 */
export function ActivityPanel({
  view, onRecord, pending,
}: {
  view: DriverWorkflowView;
  onRecord: (input: {
    activity: ActivityKind;
    payload: ActivityPayload;
    upload?: UploadDescriptor;
  }) => void;
  pending?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const closed = view.workflow.status !== "active";
  const tz = view.post.stops[0]?.timeZone ?? "UTC";

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>Along the way</CardTitle>
          <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
            Repeatable updates. Log every one — none of them replaces another.
          </p>
        </div>
        {!closed ? (
          <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
            <Plus aria-hidden />
            Add
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="px-0 pb-0">
        {view.activities.length === 0 ? (
          <p className="border-t border-border px-5 py-8 text-[0.875rem] text-fg-muted">
            Nothing logged yet.
          </p>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {view.activities.map((entry) => {
              const meta = activityMeta(entry.kind);
              const Icon = ACTIVITY_ICON[entry.kind];
              return (
                <li key={entry.eventId} className="flex gap-3 px-5 py-3.5">
                  <span
                    className={
                      "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border " +
                      (meta.exception
                        ? "border-st-warning/40 bg-st-warning-bg text-st-warning"
                        : "border-border bg-surface text-fg-subtle")
                    }
                  >
                    <Icon aria-hidden className="size-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[0.9375rem] font-medium text-fg">{meta.label}</span>
                      {entry.durationMinutes ? (
                        <Badge tone="outline">{formatDuration(entry.durationMinutes)}</Badge>
                      ) : null}
                      {entry.amountCents != null ? (
                        <Badge tone="outline">{money(entry.amountCents)}</Badge>
                      ) : null}
                      {entry.gallons != null ? (
                        <Badge tone="outline">{entry.gallons} gal</Badge>
                      ) : null}
                      {entry.weightLbs != null ? (
                        <Badge tone="outline">{entry.weightLbs.toLocaleString()} lb</Badge>
                      ) : null}
                      {entry.documentId ? <Badge tone="neutral">Receipt attached</Badge> : null}
                    </div>
                    {entry.note ? (
                      <p className="mt-1 text-[0.8125rem] leading-5 text-fg-muted">{entry.note}</p>
                    ) : null}
                    <p className="mt-1 text-[0.75rem] text-fg-subtle">
                      {dateTimeIn(entry.occurredAt, tz)}
                      {entry.locationLabel ? ` · ${entry.locationLabel}` : ""} · {entry.byName}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <ActivityDialog
        open={open}
        onOpenChange={setOpen}
        allowReceipts={view.policy.allowReceiptUploads}
        pending={pending}
        onConfirm={(input) => {
          onRecord(input);
          setOpen(false);
        }}
      />
    </Card>
  );
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function ActivityDialog({
  open, onOpenChange, onConfirm, allowReceipts, pending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (input: {
    activity: ActivityKind;
    payload: ActivityPayload;
    upload?: UploadDescriptor;
  }) => void;
  allowReceipts: boolean;
  pending?: boolean;
}) {
  const [kind, setKind] = useState<ActivityKind>("rest");
  const [note, setNote] = useState("");
  const [duration, setDuration] = useState("");
  const [amount, setAmount] = useState("");
  const [gallons, setGallons] = useState("");
  const [weight, setWeight] = useState("");
  const [location, setLocation] = useState("");
  const [upload, setUpload] = useState<UploadDescriptor | null>(null);

  const meta = activityMeta(kind);

  function reset() {
    setNote("");
    setDuration("");
    setAmount("");
    setGallons("");
    setWeight("");
    setLocation("");
    setUpload(null);
  }

  const num = (v: string) => {
    const parsed = Number(v.replace(/[^0-9.]/g, ""));
    return v.trim() !== "" && Number.isFinite(parsed) ? parsed : undefined;
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent
        title="Log an update"
        description="Goes on the trip's record as its own entry. It does not change the trip's milestones."
      >
        <div className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <span className="block text-[0.8125rem] font-medium text-fg">What happened</span>
            <div className="flex flex-wrap gap-1.5">
              {ACTIVITIES.map((a) => (
                <Chip
                  key={a.kind}
                  label={a.label}
                  selected={kind === a.kind}
                  onToggle={() => setKind(a.kind)}
                />
              ))}
            </div>
            <p className="text-[0.75rem] text-fg-subtle">{meta.hint}</p>
          </div>

          {meta.hasDuration ? (
            <Field label="How long (minutes)" htmlFor="activity-duration">
              <Input
                id="activity-duration"
                inputMode="numeric"
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                placeholder="30"
              />
            </Field>
          ) : null}

          {meta.hasAmount ? (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount ($)" htmlFor="activity-amount">
                <Input
                  id="activity-amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="186.44"
                />
              </Field>
              <Field label="Gallons" htmlFor="activity-gallons">
                <Input
                  id="activity-gallons"
                  inputMode="decimal"
                  value={gallons}
                  onChange={(e) => setGallons(e.target.value)}
                  placeholder="42.1"
                />
              </Field>
            </div>
          ) : null}

          {meta.hasWeight ? (
            <Field label="Weight (lb)" htmlFor="activity-weight">
              <Input
                id="activity-weight"
                inputMode="numeric"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                placeholder="31220"
              />
            </Field>
          ) : null}

          <Field label="Where" htmlFor="activity-location" hint="Optional.">
            <Input
              id="activity-location"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Pilot #412, Albany, OR"
            />
          </Field>

          <Field label="Note" htmlFor="activity-note" hint="Optional.">
            <Textarea
              id="activity-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>

          {meta.allowsReceipt && allowReceipts ? (
            <div className="space-y-1.5">
              <span className="block text-[0.8125rem] font-medium text-fg">Receipt</span>
              <UploadButtons label={meta.label} onPick={setUpload} disabled={pending} />
              {upload ? (
                <p className="text-[0.75rem] text-fg-muted">
                  {upload.fileName} · {(upload.sizeBytes / 1_000_000).toFixed(1)} MB. Nothing is
                  uploaded — only the file&apos;s name, type and size are recorded.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            variant="primary"
            disabled={pending}
            onClick={() =>
              onConfirm({
                activity: kind,
                payload: {
                  note: note.trim() || undefined,
                  durationMinutes: num(duration),
                  amountCents: num(amount) != null ? Math.round(num(amount)! * 100) : undefined,
                  gallons: num(gallons),
                  weightLbs: num(weight),
                  locationLabel: location.trim() || undefined,
                },
                upload: upload ?? undefined,
              })
            }
          >
            {pending ? "Saving…" : "Log it"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
