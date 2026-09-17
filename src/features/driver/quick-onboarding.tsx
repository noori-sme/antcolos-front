"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { AuthShell } from "@/features/auth/shell";
import { FormAlert } from "@/features/auth/form-alert";

import { PermissionSummary } from "@/features/access/permission-summary";
import { useStageFocus } from "@/features/auth/use-stage-focus";
import type { DriverProfile, Invitation } from "@/types";
import { ENGAGEMENT_LABEL, formatDate, maskCdl } from "./driver-rules";
import {
  type DriverIdentityDraft,
  driverIdentityErrors,
  driverIdentityIsComplete,
  emptyDriverIdentity,
  normalizeDriverIdentity,
} from "./identity";
import { DriverIdentityFields } from "./identity-fields";
import {
  documentRequirements,
  mockGetDriverProfile,
} from "./mock-driver";
import { cn } from "@/lib/utils";

type Stage = "details" | "review";

/**
 * Quick onboarding — the least we can ask and still have a driver profile.
 *
 * Only four things, and only once: the profile belongs to the driver, so a
 * driver who already has one and accepts a second carrier's invitation is never
 * asked for their licence again. They go straight to deciding what to share.
 */
export function QuickOnboarding({
  invitation,
  onConfirm,
  failureNote,
}: {
  invitation: Invitation;
  /**
   * Hands the person's decisions back. This screen COLLECTS; it no longer
   * creates anything.
   *
   * It used to make the driver profile and the carrier relationship itself,
   * from a feature, straight into two module stores. Acceptance now goes
   * through the Access service so that all five records it touches are made by
   * the modules that own them, in an order that can be resumed. What is left
   * here is the only part that was ever this screen's: asking the person what
   * they are willing to share.
   */
  onConfirm: (input: {
    licence?: { legalName: string; cdlNumber: string; cdlState: string; cdlExpiresAt: string };
    sharedDocumentKeys: string[];
  }) => Promise<void>;
  /** Shown when a previous attempt did not finish. */
  failureNote?: string;
}) {
  const [stage, setStage] = useState<Stage>("details");
  const headingRef = useStageFocus<HTMLHeadingElement>(stage);

  const [existing, setExisting] = useState<DriverProfile | null>(null);
  const [checked, setChecked] = useState(false);

  const [identity, setIdentity] = useState<DriverIdentityDraft>(emptyDriverIdentity);

  const [submitted, setSubmitted] = useState(false);
  const [consented, setConsented] = useState(false);
  const [saving, setSaving] = useState(false);

  // A returning driver already has a profile; skip straight past the questions.
  useEffect(() => {
    let cancelled = false;
    mockGetDriverProfile().then((profile) => {
      if (cancelled) return;
      setExisting(profile);
      setChecked(true);
      if (profile) setStage("review");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const engagement = invitation.engagementType ?? "company_driver";
  const requirements = documentRequirements(engagement, invitation.organizationId);

  const errors = submitted
    ? driverIdentityErrors(identity)
    : { legalName: null, cdlNumber: null, cdlState: null, cdlExpiresAt: null };

  const shown = existing
    ? {
        legalName: existing.legalName,
        cdlNumber: existing.cdlNumber,
        cdlState: existing.cdlState,
        cdlExpiresAt: existing.cdlExpiresAt,
      }
    : normalizeDriverIdentity(identity);

  function continueToReview() {
    setSubmitted(true);
    if (!driverIdentityIsComplete(identity)) return;
    setConsented(false);
    setStage("review");
  }

  async function confirm() {
    if (saving || !consented) return;
    setSaving(true);
    await onConfirm({
      // Absent when they already have a profile: a driver who has one is never
      // asked for their licence again, and the service resumes it.
      licence: existing ? undefined : {
        legalName: shown.legalName,
        cdlNumber: shown.cdlNumber,
        cdlState: shown.cdlState,
        cdlExpiresAt: shown.cdlExpiresAt,
      },
      // Only what they just agreed to hand over. Their decision, passed
      // explicitly, never derived from the carrier's requirement list.
      sharedDocumentKeys: requirements
        .filter((r) => r.applicability === "required").map((r) => r.key),
    });
    setSaving(false);
  }

  if (!checked) return null;

  const heading: Record<Stage, { title: string; description: React.ReactNode }> = {
    details: {
      title: "Set up your driver profile",
      description:
        "Four things, once. This profile is yours — it stays with you if you move carriers, and you never fill it in twice.",
    },
    review: {
      title: existing ? `Share your profile with ${invitation.organizationName}` : "Check this is right",
      description: existing
        ? "You already have an Antcolos driver profile. Here is exactly what this carrier will see."
        : "Confirm your details and what you are sharing before we set things up.",
    },
  };

  return (
    <AuthShell
      title={heading[stage].title}
      description={heading[stage].description}
      headingRef={headingRef}
    >
      {failureNote ? (
        <FormAlert tone="warning" role="none" title="Picking up where you left off">
          {failureNote}
        </FormAlert>
      ) : null}

      {stage === "details" ? (
        <form
          noValidate
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            continueToReview();
          }}
        >
          <DriverIdentityFields draft={identity} onChange={setIdentity} errors={errors} />

          <Button type="submit" variant="primary" size="lg" className="w-full">
            Continue
          </Button>
        </form>
      ) : null}

      {stage === "review" ? (
        <div className="space-y-4">
          <div className="overflow-hidden rounded-lg border border-border">
            <dl className="divide-y divide-border">
              <Row label="Carrier" value={invitation.organizationName} />
              <Row label="Engagement type" value={ENGAGEMENT_LABEL[engagement]} />
              <Row label="Legal name" value={shown.legalName} />
              <Row label="License number" value={maskCdl(shown.cdlNumber)} mono />
              <Row label="Issuing state" value={shown.cdlState} />
              <Row label="License expiration date" value={shown.cdlExpiresAt ? formatDate(shown.cdlExpiresAt) : "—"} />
              <Row label="Assigned role" value={invitation.roleName} />
            </dl>
          </div>

          <div>
            <h2 className="mb-2 text-[0.875rem] font-semibold text-fg">
              What this role lets you do
            </h2>
            <PermissionSummary permissions={invitation.permissions} />
          </div>

          <FormAlert tone="info" role="none" title={`What ${invitation.organizationName} will see`}>
            Your legal name, licence number, issuing state and expiry date, plus the documents you
            upload for them. They do not get your other carriers&apos; records, and they stop
            receiving updates if you end the relationship.
          </FormAlert>

          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-surface p-3.5">
            <input
              type="checkbox"
              checked={consented}
              onChange={(e) => setConsented(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-primary"
            />
            <span className="text-[0.8125rem] leading-relaxed text-fg">
              I agree to share this information with {invitation.organizationName}.
            </span>
          </label>

          <Button
            variant="primary"
            size="lg"
            className="w-full"
            disabled={!consented || saving}
            aria-busy={saving || undefined}
            onClick={confirm}
          >
            {saving ? "Setting up…" : "Confirm and join"}
          </Button>
          {!existing ? (
            <button
              type="button"
              onClick={() => setStage("details")}
              className="text-[0.8125rem] font-medium text-fg-muted underline-offset-4 hover:text-fg hover:underline"
            >
              Back
            </button>
          ) : null}

          <p className="text-[0.75rem] leading-relaxed text-fg-subtle">
            Preview build: nothing is verified or permanently stored.
          </p>
        </div>
      ) : null}

    </AuthShell>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3.5 py-2.5">
      <dt className="text-[0.75rem] text-fg-muted">{label}</dt>
      <dd className={cn("text-[0.8125rem] font-medium text-fg", mono && "font-mono")}>{value}</dd>
    </div>
  );
}
