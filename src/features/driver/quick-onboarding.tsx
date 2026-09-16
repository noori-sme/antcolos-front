"use client";

import { CircleCheck, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
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
  mockCreateOrGetDriverProfile,
  mockCreateRelationship,
  mockGetDriverProfile,
} from "./mock-driver";
import { cn } from "@/lib/utils";

type Stage = "details" | "review" | "done";

/**
 * Quick onboarding — the least we can ask and still have a driver profile.
 *
 * Only four things, and only once: the profile belongs to the driver, so a
 * driver who already has one and accepts a second carrier's invitation is never
 * asked for their licence again. They go straight to deciding what to share.
 */
export function QuickOnboarding({ invitation }: { invitation: Invitation }) {
  const router = useRouter();
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
    const profile = await mockCreateOrGetDriverProfile({
      legalName: shown.legalName,
      cdlNumber: shown.cdlNumber,
      cdlState: shown.cdlState,
      cdlExpiresAt: shown.cdlExpiresAt,
    });
    await mockCreateRelationship(profile.id, {
      carrierId: invitation.organizationId,
      carrierName: invitation.organizationName,
      engagementType: engagement,
      roleName: invitation.roleName,
      permissions: invitation.permissions,
      // Only what the driver just agreed to hand over.
      sharedDocumentKeys: requirements.filter((r) => r.applicability === "required").map((r) => r.key),
    });
    setSaving(false);
    setStage("done");
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
    done: {
      title: `You're set up with ${invitation.organizationName}`,
      description: "Your driver profile is created and the carrier has what you agreed to share.",
    },
  };

  return (
    <AuthShell
      title={heading[stage].title}
      description={heading[stage].description}
      headingRef={headingRef}
    >
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

      {stage === "done" ? (
        <div className="space-y-5">
          <div className="flex items-start gap-3 rounded-lg border border-st-success/35 bg-st-success-bg/50 px-4 py-3.5">
            <CircleCheck className="mt-px size-5 shrink-0 text-st-success" aria-hidden />
            <div className="min-w-0 text-[0.8125rem]">
              <p className="font-medium text-fg">
                {ENGAGEMENT_LABEL[engagement]} with {invitation.organizationName}.
              </p>
              <p className="mt-0.5 text-fg-muted">
                Next: upload the documents they need. You can start driving while you do it.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2.5 rounded-md border border-border bg-surface-sunken px-3.5 py-3">
            <ShieldCheck className="mt-px size-4 shrink-0 text-fg-subtle" aria-hidden />
            <p className="text-[0.75rem] leading-relaxed text-fg-muted">
              This profile is yours. If you ever leave this carrier, your account and profile stay
              with you — only their access ends.
            </p>
          </div>
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            onClick={() => router.push("/driver/documents")}
          >
            Go to my documents
          </Button>
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
