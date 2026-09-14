"use client";

import { ArrowLeft, CheckCircle2, FileCheck2, FileText } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ErrorState, LoadingSkeleton } from "@/components/data/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import type { DriverWorkflowView, MilestoneKind, UploadDescriptor } from "@/types";
import { ActivityPanel } from "./activity-panel";
import { DocumentPanel, UploadButtons } from "./document-actions";
import {
  useIdempotencyKeys, useIngestSignals, useTripByLoad, useWorkflowCommand,
} from "./hooks";
import { IntegrationPanel } from "./integration-panel";
import { TripStatusBadge } from "./labels";
import { LoadPostCard } from "./load-post";
import { MilestoneRail, NextActions, TripWarnings } from "./milestone-rail";
import { TripTimeline } from "./trip-timeline";

type Tab = "trip" | "post" | "history";

/**
 * One finalized load: its authorized post, its workflow, and everything the
 * driver can do on it.
 *
 * Completing the trip closes the workflow for writing and keeps every part of
 * it — timeline, documents, comments, corrections and audit trail. The next
 * load gets a new workflow of its own.
 */
export function TripScreen({ loadId }: { loadId: string }) {
  const trip = useTripByLoad(loadId);
  const command = useWorkflowCommand();
  const ingest = useIngestSignals();
  const { keyFor, rotate } = useIdempotencyKeys();
  const [tab, setTab] = useState<Tab>("trip");
  const [completing, setCompleting] = useState(false);

  const workflowId = trip.data?.workflow.id;
  const isActive = trip.data?.workflow.status === "active";

  // Pull whatever the signal boundary has once the trip is open. Anything it
  // suggests lands as inferred and waits for a person.
  useEffect(() => {
    if (workflowId && isActive) ingest.mutate(workflowId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowId, isActive]);

  if (trip.isPending) return <LoadingSkeleton rows={6} />;
  if (trip.isError) {
    return (
      <ErrorState
        title="This trip is not available"
        description={trip.error.message}
        onRetry={() => trip.refetch()}
      />
    );
  }

  const view = trip.data;
  const closed = view.workflow.status !== "active";

  function run(
    intent: string,
    build: (idempotencyKey: string) => Parameters<typeof command.mutate>[0],
  ) {
    const scoped = `${view.workflow.id}:${intent}`;
    command.mutate(build(keyFor(scoped)), { onSuccess: () => rotate(scoped) });
  }

  function recordMilestone(milestone: MilestoneKind, completionExceptionReason?: string) {
    if (milestone === "trip_completed" && view.completionBlockedReason && !completionExceptionReason) {
      setCompleting(true);
      return;
    }
    run(`milestone:${milestone}`, (idempotencyKey) => ({
      type: "record_milestone",
      workflowId: view.workflow.id,
      milestone,
      completionExceptionReason,
      idempotencyKey,
    }));
  }

  function attach(
    documentKind: "bill_of_lading" | "proof_of_delivery",
    milestone: MilestoneKind,
    upload: UploadDescriptor,
  ) {
    run(`doc:${documentKind}:${upload.fileName}`, (idempotencyKey) => ({
      type: "attach_document",
      workflowId: view.workflow.id,
      documentKind,
      upload,
      milestone,
      idempotencyKey,
    }));
  }

  return (
    <div className="space-y-stack">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/driver/loads">
            <ArrowLeft aria-hidden />
            My loads
          </Link>
        </Button>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="font-mono text-[1.375rem] leading-8 font-semibold tracking-[-0.015em] text-fg">
            {view.post.loadReference}
          </h1>
          <p className="mt-0.5 text-[0.875rem] text-fg-muted">
            {view.post.customerName} · {view.policyLabel}
          </p>
        </div>
        <TripStatusBadge status={view.workflow.status} />
      </header>

      {closed ? (
        <Card className="border-st-success/30">
          <CardContent className="flex items-start gap-3 pt-4">
            <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-st-success" />
            <div>
              <p className="text-[0.9375rem] font-semibold text-fg">This trip is finished</p>
              <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
                The workflow is closed. Its timeline, documents, comments, corrections and audit
                history are all kept. Your next load gets its own workflow.
              </p>
              {view.workflow.completionException ? (
                <p className="mt-1.5 text-[0.8125rem] text-st-warning">
                  Closed without a POD: {view.workflow.completionException}
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {command.isError ? (
        <p
          role="alert"
          className="rounded-md bg-st-danger-bg px-3 py-2.5 text-[0.875rem] text-st-danger"
        >
          {command.error.message}
        </p>
      ) : null}

      <nav className="flex gap-1 border-b border-border" aria-label="Trip sections">
        {([
          ["trip", "Trip"],
          ["post", "Load details"],
          ["history", "History"],
        ] as [Tab, string][]).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
            className={
              "-mb-px border-b-2 px-3 py-2 text-[0.875rem] font-medium transition-colors " +
              (tab === id
                ? "border-primary text-fg"
                : "border-transparent text-fg-muted hover:text-fg")
            }
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "trip" ? (
        <div className="space-y-stack">
          <NextActions
            view={view}
            pending={command.isPending}
            onRecord={(m) => recordMilestone(m)}
          />

          <TripWarnings view={view} />

          <PaperworkActions
            view={view}
            pending={command.isPending}
            onAttach={attach}
          />

          <MilestoneRail
            view={view}
            pending={command.isPending}
            onRecord={(m) => recordMilestone(m)}
            onConfirmInference={(eventId, milestone) =>
              run(`confirm:${milestone}`, (idempotencyKey) => ({
                type: "confirm_inference",
                workflowId: view.workflow.id,
                eventId,
                idempotencyKey,
              }))
            }
            onRejectInference={(eventId, milestone) =>
              run(`reject:${milestone}`, (idempotencyKey) => ({
                type: "reject_inference",
                workflowId: view.workflow.id,
                eventId,
                reason: "The driver says this did not happen.",
                idempotencyKey,
              }))
            }
          />

          <ActivityPanel
            view={view}
            pending={command.isPending}
            onRecord={({ activity, payload, upload }) =>
              run(`activity:${activity}:${Date.now()}`, (idempotencyKey) => ({
                type: "record_activity",
                workflowId: view.workflow.id,
                activity,
                payload,
                upload,
                idempotencyKey,
              }))
            }
          />

          <DocumentPanel
            documents={view.documents}
            closed={closed}
            pending={command.isPending}
            onCorrect={({ documentId, fieldKey, correctedValue, note }) =>
              run(`correct:${documentId}:${fieldKey}`, (idempotencyKey) => ({
                type: "correct_extraction",
                workflowId: view.workflow.id,
                documentId,
                fieldKey,
                correctedValue,
                note,
                idempotencyKey,
              }))
            }
          />

          <IntegrationPanel view={view} />
        </div>
      ) : null}

      {tab === "post" ? <LoadPostCard post={view.post} /> : null}

      {tab === "history" ? (
        <TripTimeline
          events={view.timeline}
          timeZone={view.post.stops[0]?.timeZone ?? "UTC"}
        />
      ) : null}

      <CompletionExceptionDialog
        open={completing}
        onOpenChange={setCompleting}
        reason={view.completionBlockedReason ?? ""}
        pending={command.isPending}
        onConfirm={(exceptionReason) => {
          setCompleting(false);
          recordMilestone("trip_completed", exceptionReason);
        }}
      />
    </div>
  );
}

/** BOL and POD get their own big buttons — they are what the load is paid on. */
function PaperworkActions({
  view, onAttach, pending,
}: {
  view: DriverWorkflowView;
  onAttach: (
    kind: "bill_of_lading" | "proof_of_delivery",
    milestone: MilestoneKind,
    upload: UploadDescriptor,
  ) => void;
  pending?: boolean;
}) {
  if (view.workflow.status !== "active") return null;

  const hasBol = view.documents.some((d) => d.kind === "bill_of_lading");
  const hasPod = view.documents.some((d) => d.kind === "proof_of_delivery");

  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>Paperwork</CardTitle>
          <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
            Upload whenever you have it. You do not have to have marked anything first.
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="flex items-center gap-2 text-[0.9375rem] font-medium text-fg">
            <FileText aria-hidden className="size-4 text-fg-subtle" />
            Bill of lading
            {hasBol ? <span className="text-[0.75rem] text-st-success">· on file</span> : null}
          </p>
          <div className="mt-2">
            <UploadButtons
              label="the bill of lading"
              disabled={pending}
              variant={hasBol ? "secondary" : "primary"}
              onPick={(upload) => onAttach("bill_of_lading", "bol_uploaded", upload)}
            />
          </div>
        </div>

        <div className="border-t border-border pt-4">
          <p className="flex items-center gap-2 text-[0.9375rem] font-medium text-fg">
            <FileCheck2 aria-hidden className="size-4 text-fg-subtle" />
            Proof of delivery
            {hasPod ? <span className="text-[0.75rem] text-st-success">· on file</span> : null}
          </p>
          <div className="mt-2">
            <UploadButtons
              label="the proof of delivery"
              disabled={pending}
              variant={hasPod ? "secondary" : "primary"}
              onPick={(upload) => onAttach("proof_of_delivery", "pod_uploaded", upload)}
            />
          </div>
        </div>

        <p className="text-[0.75rem] text-fg-subtle">
          Nothing is uploaded and no file leaves this device. Only the file&apos;s name, type
          and size are recorded, through the Document Center boundary.
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * The one genuine block in the trip, and its way through: a trip can still be
 * completed without a POD, but the reason goes on the record rather than being
 * swallowed to make the trip look clean.
 */
function CompletionExceptionDialog({
  open, onOpenChange, reason, onConfirm, pending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  reason: string;
  onConfirm: (exceptionReason: string) => void;
  pending?: boolean;
}) {
  const [text, setText] = useState("");
  const invalid = text.trim().length < 5;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Complete this trip without a POD?"
        description={reason}
      >
        <div className="mt-4">
          <Field
            label="Why there is no POD"
            htmlFor="completion-reason"
            hint="Goes on the trip's permanent record and to the office."
            error={
              text.length > 0 && invalid ? "Give a reason of at least 5 characters." : undefined
            }
          >
            <Textarea
              id="completion-reason"
              rows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Receiver kept the only signed copy — the broker is emailing it to the office."
            />
          </Field>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            variant="primary"
            disabled={invalid || pending}
            onClick={() => onConfirm(text.trim())}
          >
            {pending ? "Completing…" : "Complete with this reason"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
