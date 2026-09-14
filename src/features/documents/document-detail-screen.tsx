"use client";

import {
  ArrowLeft, CircleCheck, CircleX, Download, FileText, History, Link2, Send, Share2,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { EmptyState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { documentTypeLabel } from "@/lib/documents/catalog";
import {
  DOCUMENT_EVENT_LABEL, DOCUMENT_STATUS_DESCRIPTION, SHARE_BASIS_LABEL,
  formatDocumentDate, formatFileSize,
} from "@/lib/documents/labels";
import { useActiveMembership, useCan, useSession } from "@/lib/session/hooks";
import { DocumentStatusBadge, MockUploadNotice, SharedBadge, SubjectBadge } from "./chips";
import { FilePicker } from "./file-picker";
import { useDocument, useDocumentAction } from "./hooks";
import { cn } from "@/lib/utils";

/**
 * One document, all of it.
 *
 * A document that has been replaced three times is four records with four
 * permanent ids, and every one of them is still here — the file that was
 * approved last year can be opened next to the one that replaced it. Nothing on
 * this screen deletes anything, because nothing in the model does.
 */
export function DocumentDetailScreen({ documentId }: { documentId: string }) {
  const { data, isPending, error } = useDocument(documentId);
  const action = useDocumentAction();
  const canUpload = useCan("documents:upload");
  const canApprove = useCan("documents:approve");

  if (isPending) return <LoadingSkeleton rows={6} />;

  if (error || !data) {
    return (
      <EmptyState
        icon={FileText}
        title="Document not found"
        description="This document does not exist, or your organization has no access to it. Those look the same from here on purpose."
        action={
          <Button variant="secondary" asChild>
            <Link href="/documents">Back to documents</Link>
          </Button>
        }
      />
    );
  }

  const { document, status, requirement, subject, shared, share, canDownload, canReview } = data;
  const label = requirement?.label ?? documentTypeLabel(document.typeKey);
  const primaryLink = document.links.find((l) => l.primary) ?? document.links[0];
  const otherLinks = document.links.filter((l) => l.id !== primaryLink?.id);
  const superseded = document.status === "superseded";

  return (
    <div className="space-y-section">
      <Button variant="ghost" size="sm" asChild className="-ml-2 w-fit">
        <Link href="/documents">
          <ArrowLeft aria-hidden />
          Documents
        </Link>
      </Button>

      <PageHeader
        title={label}
        description={`${subject.label} · version ${document.version} of ${data.versions.length}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <DocumentStatusBadge status={status} />
            <SubjectBadge kind={subject.kind} />
            {shared ? <SharedBadge from={document.owner.name} /> : null}
          </div>
        }
      />

      <p className="text-[0.8125rem] leading-relaxed text-fg-muted">
        {DOCUMENT_STATUS_DESCRIPTION[status]}
      </p>

      {shared && share ? (
        <Panel title="Why you can see this">
          <p className="text-[0.8125rem] leading-relaxed text-fg-muted">
            {document.owner.name} shared it with you: {share.purpose}
          </p>
          <p className="mt-1 text-[0.75rem] text-fg-subtle">
            {SHARE_BASIS_LABEL[share.basis.kind]} · {share.basis.label} · granted{" "}
            {formatDocumentDate(share.grantedAt)}
          </p>
          <p className="mt-2 text-[0.75rem] leading-relaxed text-fg-subtle">
            You can see this document. Reviewing it is theirs to do, and their own review decision
            is not shown to you.
            {canDownload ? "" : " Downloading was not included in this grant."}
          </p>
        </Panel>
      ) : null}

      <Panel title="The file">
        <dl className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface-sunken">
          <Row label="File name" value={document.file?.fileName ?? "—"} />
          <Row label="Type" value={document.file?.fileType ?? "—"} />
          <Row label="Size" value={formatFileSize(document.file?.sizeBytes)} />
          <Row label="Document ID" value={document.documentId} mono />
          <Row label="Document lineage" value={document.lineageId} mono />
          <Row label="Version" value={`${document.version}`} />
          <Row label="Expires" value={formatDocumentDate(document.expiresAt)} />
          <Row label="Added by" value={`${document.addedByName} · ${formatDocumentDate(document.createdAt)}`} />
        </dl>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {canDownload ? (
            <Button variant="secondary" size="sm" disabled title="There is no stored file to download in this build.">
              <Download aria-hidden />
              Download
            </Button>
          ) : null}
          {!shared && canUpload && !superseded ? (
            <FilePicker
              label="Replace with a new version"
              disabled={action.isPending}
              onPick={(file) => action.mutate({ kind: "replace", documentId, file })}
            />
          ) : null}
          {!shared && canUpload && !superseded && status === "selected_local" ? (
            <Button
              variant="primary"
              size="sm"
              disabled={action.isPending}
              onClick={() => action.mutate({ kind: "submit", documentId })}
            >
              <Send aria-hidden />
              Send for review
            </Button>
          ) : null}
        </div>
        <MockUploadNotice className="mt-3" />
      </Panel>

      {canReview && !superseded ? (
        <ReviewPanel documentId={documentId} status={status} />
      ) : null}

      <Panel title="What this is attached to">
        <ul className="space-y-2">
          <LinkRow link={primaryLink} primary />
          {otherLinks.map((link) => (
            <LinkRow key={link.id} link={link} />
          ))}
        </ul>
        <p className="mt-2.5 text-[0.75rem] leading-relaxed text-fg-subtle">
          A document that applies in more than one place is linked, never uploaded twice. Each link
          keeps its own review state and its own governing organization, so one context accepting it
          does not decide for another.
        </p>
      </Panel>

      {!shared && canApprove ? <SharePanel documentId={documentId} /> : null}

      <Panel title={`Version history (${data.versions.length})`}>
        <ul className="space-y-2">
          {data.versions.map((version) => (
            <li
              key={version.documentId}
              className={cn(
                "rounded-lg border p-3",
                version.documentId === document.documentId
                  ? "border-primary/40 bg-primary/[0.04]"
                  : "border-border bg-surface-sunken",
              )}
            >
              <p className="flex flex-wrap items-center gap-2">
                <span className="text-[0.8125rem] font-medium text-fg">
                  Version {version.version}
                </span>
                <DocumentStatusBadge status={version.status} />
                {version.documentId === document.documentId ? (
                  <Badge tone="outline">You are reading this one</Badge>
                ) : null}
              </p>
              <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
                {version.file?.fileName ?? "No file"} · added {formatDocumentDate(version.createdAt)}{" "}
                by {version.addedByName}
              </p>
              {version.documentId !== document.documentId ? (
                <Button variant="ghost" size="sm" asChild className="mt-1.5 -ml-2">
                  <Link href={`/documents/${version.documentId}`}>Open this version</Link>
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="mt-2.5 text-[0.75rem] leading-relaxed text-fg-subtle">
          Replacing a document creates a new version with its own permanent ID. Every earlier
          version is kept in full and is never deleted, not by a replacement and not by a
          relationship ending.
        </p>
      </Panel>

      <Panel title="History">
        {data.history.length === 0 ? (
          <p className="text-[0.8125rem] text-fg-muted">Nothing recorded yet.</p>
        ) : (
          <ol className="space-y-2.5">
            {[...data.history].reverse().map((event) => (
              <li key={event.id} className="flex gap-2.5">
                <History className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" aria-hidden />
                <div className="min-w-0">
                  <p className="text-[0.8125rem] font-medium text-fg">
                    {event.summary}{" "}
                    <span className="font-normal text-fg-subtle">
                      ({DOCUMENT_EVENT_LABEL[event.kind]})
                    </span>
                  </p>
                  {event.detail ? (
                    <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
                      {event.detail}
                    </p>
                  ) : null}
                  <p className="mt-0.5 text-[0.75rem] text-fg-subtle tabular-nums">
                    {formatDocumentDate(event.at)}
                    {event.actorName ? ` · ${event.actorName}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      {data.snapshots.length > 0 ? (
        <Panel title={`Snapshots (${data.snapshots.length})`}>
          <p className="mb-2 text-[0.8125rem] leading-relaxed text-fg-muted">
            What was held at a moment that mattered — a replacement, a relationship ending, access
            being withdrawn. Kept so the record of what was true at the time survives.
          </p>
          <ul className="space-y-1.5">
            {data.snapshots.map((snapshot) => (
              <li
                key={`${snapshot.documentId}-${snapshot.capturedAt}`}
                className="rounded-md bg-surface-sunken px-3 py-2 text-[0.75rem] text-fg-muted"
              >
                {snapshot.label} · {snapshot.fileName ?? "no file"} ·{" "}
                {formatDocumentDate(snapshot.capturedAt)} · {snapshot.reason.replace(/_/g, " ")}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <h2 className="mb-2.5 text-[0.9375rem] font-semibold text-fg">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3.5 py-2.5">
      <dt className="text-[0.75rem] text-fg-muted">{label}</dt>
      <dd
        className={cn(
          "min-w-0 text-[0.8125rem] font-medium break-all text-fg",
          mono ? "font-mono text-[0.75rem]" : "tabular-nums",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function LinkRow({
  link,
  primary,
}: {
  link?: { id: string; subject: { kind: string; label: string; href?: string }; contextOrganizationName: string; review: { state: string; rejectionReason?: string }; unlinkedAt?: string; unlinkReason?: string };
  primary?: boolean;
}) {
  if (!link) return null;
  return (
    <li className="rounded-md border border-border bg-surface-sunken px-3 py-2.5">
      <p className="flex flex-wrap items-center gap-2">
        <Link2 className="size-3.5 shrink-0 text-fg-subtle" aria-hidden />
        <span className="text-[0.8125rem] font-medium text-fg">{link.subject.label}</span>
        <Badge tone="outline">{primary ? "Primary" : "Linked"}</Badge>
        {link.unlinkedAt ? <Badge tone="neutral">Link ended</Badge> : null}
      </p>
      <p className="mt-0.5 text-[0.75rem] text-fg-subtle">
        Reviewed by {link.contextOrganizationName} · {link.review.state.replace(/_/g, " ")}
        {link.unlinkReason ? ` · ${link.unlinkReason}` : ""}
      </p>
      {link.subject.href ? (
        <Button variant="ghost" size="sm" asChild className="mt-1 -ml-2">
          <Link href={link.subject.href}>Open {link.subject.kind}</Link>
        </Button>
      ) : null}
    </li>
  );
}

function ReviewPanel({ documentId, status }: { documentId: string; status: string }) {
  const action = useDocumentAction();
  const [reason, setReason] = useState("");

  return (
    <Panel title="Review">
      <p className="mb-2.5 text-[0.8125rem] leading-relaxed text-fg-muted">
        A person decides. Nothing here has been checked automatically, and nothing was verified
        against any external register.
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          variant="primary"
          size="sm"
          disabled={action.isPending || status === "approved"}
          onClick={() => action.mutate({ kind: "approve", documentId })}
        >
          <CircleCheck aria-hidden />
          Approve
        </Button>

        <Dialog>
          <DialogTrigger asChild>
            <Button variant="secondary" size="sm" disabled={action.isPending}>
              <CircleX aria-hidden />
              Reject
            </Button>
          </DialogTrigger>
          <DialogContent
            title="Reject this document"
            description="Say what is wrong with it. The person who has to fix it reads this, so a rejection without a reason is refused."
          >
            <div className="mt-4 space-y-3">
              <Field label="Reason" htmlFor="reject-reason">
                <Textarea
                  id="reject-reason"
                  rows={4}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="The photo cuts off the expiry date. Send the whole page."
                />
              </Field>
              <div className="flex justify-end gap-2">
                <DialogClose asChild>
                  <Button variant="ghost" size="sm">Cancel</Button>
                </DialogClose>
                <DialogClose asChild>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={!reason.trim() || action.isPending}
                    onClick={() => action.mutate({ kind: "reject", documentId, reason })}
                  >
                    Reject
                  </Button>
                </DialogClose>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      {action.error ? (
        <p role="alert" className="mt-2 text-[0.8125rem] text-st-danger">{action.error.message}</p>
      ) : null}
    </Panel>
  );
}

/**
 * Granting another organization access.
 *
 * The recipient is chosen from organizations this person actually belongs to,
 * and the grant records what it is for. Viewing and downloading are separate,
 * because "they can see our insurance certificate" and "they have a copy of it"
 * are different decisions.
 */
function SharePanel({ documentId }: { documentId: string }) {
  const { memberships, organizations } = useSession();
  const { organization: active } = useActiveMembership();
  const action = useDocumentAction();
  const candidates = organizations.filter(
    (o) => o.id !== active?.id
      && memberships.some((m) => m.organizationId === o.id && m.status === "active"),
  );

  const [withId, setWithId] = useState(candidates[0]?.id ?? "");
  const [purpose, setPurpose] = useState("");
  const [canDownload, setCanDownload] = useState(false);

  if (candidates.length === 0) return null;
  const recipient = organizations.find((o) => o.id === withId);

  return (
    <Panel title="Share with another organization">
      <p className="mb-2.5 text-[0.8125rem] leading-relaxed text-fg-muted">
        A dispatch organization sees a carrier&apos;s document only because the carrier shared it,
        for work it actually does. Access ends when the grant is revoked or the relationship behind
        it ends.
      </p>
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="secondary" size="sm">
            <Share2 aria-hidden />
            Share this document
          </Button>
        </DialogTrigger>
        <DialogContent
          title="Share this document"
          description="The other organization gets exactly this document, for exactly this reason."
        >
          <div className="mt-4 space-y-3">
            <Field label="Organization" htmlFor="share-org">
              <select
                id="share-org"
                value={withId}
                onChange={(e) => setWithId(e.target.value)}
                className="h-control w-full rounded-md border border-border bg-surface px-2.5 text-[0.875rem] text-fg outline-none focus-visible:border-primary"
              >
                {candidates.map((o) => (
                  <option key={o.id} value={o.id}>{o.displayName}</option>
                ))}
              </select>
            </Field>
            <Field
              label="What do they need it for?"
              htmlFor="share-purpose"
              hint="Recorded with the grant, so it can be read back later."
            >
              <Input
                id="share-purpose"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="Broker onboarding packets for the loads they book for us."
              />
            </Field>
            <label className="flex items-center gap-2 text-[0.8125rem] text-fg">
              <input
                type="checkbox"
                checked={canDownload}
                onChange={(e) => setCanDownload(e.target.checked)}
                className="size-4 rounded border-border-strong"
              />
              Allow them to download it, not just view it
            </label>
            <div className="flex justify-end gap-2">
              <DialogClose asChild>
                <Button variant="ghost" size="sm">Cancel</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!purpose.trim() || !withId || action.isPending}
                  onClick={() =>
                    action.mutate({
                      kind: "share",
                      input: {
                        documentId,
                        withOrganizationId: withId,
                        basis: {
                          kind: "carrier_relationship",
                          id: withId,
                          label: recipient?.displayName ?? withId,
                        },
                        purpose,
                        canDownload,
                      },
                    })
                  }
                >
                  Share
                </Button>
              </DialogClose>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Panel>
  );
}
