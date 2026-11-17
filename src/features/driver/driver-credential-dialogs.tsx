"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useIdempotencyKey } from "@/lib/api/use-idempotency-key";
import {
  CREDENTIAL_STATUS_LABELS,
  CREDENTIAL_TYPE_LABELS,
  credentialTitle,
  needsReason,
  nextStatuses,
} from "@/lib/driver-credentials/status";
import {
  CREDENTIAL_TYPES,
  INITIAL_CREDENTIAL_STATUSES,
  type CredentialStatus,
  type CredentialType,
  type DriverCredential,
  type UpdateCredentialInput,
} from "@/types/driver-credential";
import {
  useChangeCredentialStatus,
  useCreateCredential,
  useUpdateCredential,
} from "./hooks";

const SELECT =
  "h-control w-full rounded-md border border-border bg-surface px-3 text-[0.875rem] text-fg shadow-e1 " +
  "hover:border-border-strong focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35";

/**
 * `<input type="date">` value ↔ ISO instant. A printed expiry date is valid
 * through that day, so expiry is sent as the day's last instant (UTC); issue
 * dates as its first. Days are read back in UTC.
 */
const toDay = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const startOfDay = (day: string) => (day ? `${day}T00:00:00.000Z` : undefined);
const endOfDay = (day: string) => (day ? `${day}T23:59:59.999Z` : undefined);

function ErrorLine({ error }: { error: Error | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="mt-3 text-[0.8125rem] text-st-danger">
      {error.message}
    </p>
  );
}

function DateFields({
  idPrefix,
  issuedAt,
  expiresAt,
  onIssued,
  onExpires,
}: {
  idPrefix: string;
  issuedAt: string;
  expiresAt: string;
  onIssued: (v: string) => void;
  onExpires: (v: string) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Issued" htmlFor={`${idPrefix}-issued`}>
        <Input
          id={`${idPrefix}-issued`}
          type="date"
          value={issuedAt}
          onChange={(e) => onIssued(e.target.value)}
        />
      </Field>
      <Field
        label="Expires"
        htmlFor={`${idPrefix}-expires`}
        hint="Valid through this date; Antcolos marks it expired after it."
      >
        <Input
          id={`${idPrefix}-expires`}
          type="date"
          value={expiresAt}
          onChange={(e) => onExpires(e.target.value)}
        />
      </Field>
    </div>
  );
}

export function AddCredentialDialog({
  userId,
  driverName,
  open,
  onOpenChange,
}: {
  userId: string;
  driverName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreateCredential();
  const { keyFor } = useIdempotencyKey();
  const [type, setType] = useState<CredentialType>("CDL");
  const [label, setLabel] = useState("");
  const [status, setStatus] =
    useState<(typeof INITIAL_CREDENTIAL_STATUSES)[number]>("ACTIVE");
  const [issuedAt, setIssuedAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  const submit = () => {
    const input = {
      userId,
      type,
      status,
      ...(label.trim() ? { label: label.trim() } : {}),
      ...(issuedAt ? { issuedAt: startOfDay(issuedAt) } : {}),
      ...(expiresAt ? { expiresAt: endOfDay(expiresAt) } : {}),
    };
    create.mutate(
      { input, idempotencyKey: keyFor({ route: "POST /credentials", input }) },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Add a credential"
        description={`Recorded on ${driverName}'s file in this organization.`}
      >
        <div className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type" htmlFor="credential-type" required>
              <select
                id="credential-type"
                className={SELECT}
                value={type}
                onChange={(e) => setType(e.target.value as CredentialType)}
              >
                {CREDENTIAL_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {CREDENTIAL_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Status" htmlFor="credential-status">
              <select
                id="credential-status"
                className={SELECT}
                value={status}
                onChange={(e) =>
                  setStatus(
                    e.target
                      .value as (typeof INITIAL_CREDENTIAL_STATUSES)[number],
                  )
                }
              >
                {INITIAL_CREDENTIAL_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {CREDENTIAL_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field
            label="Detail"
            htmlFor="credential-label"
            hint="Class or endorsements, or the site for an access badge."
          >
            <Input
              id="credential-label"
              maxLength={100}
              value={label}
              placeholder="Class A"
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
          <DateFields
            idPrefix="credential"
            issuedAt={issuedAt}
            expiresAt={expiresAt}
            onIssued={setIssuedAt}
            onExpires={setExpiresAt}
          />
        </div>
        <ErrorLine error={create.error} />
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={create.isPending}
          >
            {create.isPending ? "Saving…" : "Add credential"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function EditCredentialDialog({
  credential,
  open,
  onOpenChange,
}: {
  credential: DriverCredential;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const update = useUpdateCredential();
  const [label, setLabel] = useState(credential.label);
  const [issuedAt, setIssuedAt] = useState(toDay(credential.issuedAt));
  const [expiresAt, setExpiresAt] = useState(toDay(credential.expiresAt));

  const submit = () => {
    // Send only what changed: an untouched date keeps its exact stored instant.
    const input: UpdateCredentialInput = {};
    if (label.trim() !== credential.label) input.label = label.trim();
    if (issuedAt !== toDay(credential.issuedAt))
      input.issuedAt = startOfDay(issuedAt) ?? null;
    if (expiresAt !== toDay(credential.expiresAt))
      input.expiresAt = endOfDay(expiresAt) ?? null;
    if (Object.keys(input).length === 0) {
      onOpenChange(false);
      return;
    }
    update.mutate(
      { id: credential.id, input },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Edit ${credentialTitle(credential)}`}
        description="Change the detail and dates. The status has its own action."
      >
        <div className="mt-4 space-y-4">
          <Field label="Detail" htmlFor="edit-credential-label">
            <Input
              id="edit-credential-label"
              maxLength={100}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>
          <DateFields
            idPrefix="edit-credential"
            issuedAt={issuedAt}
            expiresAt={expiresAt}
            onIssued={setIssuedAt}
            onExpires={setExpiresAt}
          />
        </div>
        <ErrorLine error={update.error} />
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={update.isPending}
          >
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ChangeStatusDialog({
  credential,
  open,
  onOpenChange,
}: {
  credential: DriverCredential;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const change = useChangeCredentialStatus();
  const { keyFor } = useIdempotencyKey();
  const options = nextStatuses(credential);
  const [to, setTo] = useState<CredentialStatus | "">(options[0] ?? "");
  const [reason, setReason] = useState("");
  const reasonRequired = to !== "" && needsReason(to);

  const submit = () => {
    if (!to) return;
    const vars = {
      id: credential.id,
      status: to,
      reason: reason.trim() || undefined,
    };
    change.mutate(
      {
        ...vars,
        idempotencyKey: keyFor({ route: "POST /credentials/:id/status", vars }),
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Change status of ${credentialTitle(credential)}`}
        description={`Now ${CREDENTIAL_STATUS_LABELS[credential.status].toLowerCase()}. Every change is kept in its history.`}
      >
        {options.length === 0 ? (
          <p className="mt-4 text-[0.8125rem] text-fg-muted">
            No status change is possible right now. If it has expired, set a new
            expiry date first.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            <Field label="New status" htmlFor="credential-next-status">
              <select
                id="credential-next-status"
                className={SELECT}
                value={to}
                onChange={(e) => setTo(e.target.value as CredentialStatus)}
              >
                {options.map((s) => (
                  <option key={s} value={s}>
                    {CREDENTIAL_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label={reasonRequired ? "Reason" : "Reason (optional)"}
              htmlFor="credential-reason"
              required={reasonRequired}
              hint="Kept in the credential's history."
            >
              <Textarea
                id="credential-reason"
                rows={3}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
          </div>
        )}
        <ErrorLine error={change.error} />
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={
              to === "REVOKED" || to === "SUSPENDED" ? "danger" : "primary"
            }
            onClick={submit}
            disabled={
              change.isPending || !to || (reasonRequired && !reason.trim())
            }
          >
            {change.isPending
              ? "Saving…"
              : to
                ? `Mark ${CREDENTIAL_STATUS_LABELS[to].toLowerCase()}`
                : "Change status"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
