"use client";

import { Check, Inbox, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/data/states";
import { FormAlert } from "@/features/auth/form-alert";
import { ShareStateChip } from "@/features/driver/share-badges";
import { SharedDocumentCard } from "@/features/driver/shared-document-card";
import { formatDate } from "@/features/driver/driver-rules";
import { useActiveMembership, useSession } from "@/lib/session/hooks";
import {
  openNativePackage, packagesForOrganization, recordShareReview, shareState,
} from "@/lib/api/mock/document-shares";
import { documentById } from "@/lib/api/mock/document-store";
import { AdoptDialog } from "@/features/workforce/adopt-dialog";
import { useCan } from "@/lib/session/hooks";
import { SHARE_PURPOSE_LABEL } from "@/types";

/**
 * Documents drivers have sent this carrier, before anybody is anybody's driver.
 *
 * The smallest surface that does the job: who shared, why, exactly what, and a
 * place to record what this carrier thinks of each item. It is deliberately NOT
 * an onboarding workflow — accepting a driver still happens through the
 * invitation flow that already exists, and a review here creates no
 * relationship, no membership and no assignment. It exists because there was no
 * surface at all for "somebody who is not our driver sent us their licence",
 * and reviewing in the Document Center would have meant pretending the driver
 * already belonged to this carrier.
 */
export function SharedWithUsScreen() {
  const { organization, membership } = useActiveMembership();
  const { user } = useSession();
  // Inviting is the owner's, or somebody they have given the key to. Without
  // this the button showed to anybody who could open Documents, and led them
  // to a screen that refuses them.
  const canInvite = useCan("invitations:create");
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  void nonce;

  if (!organization || !membership) {
    return (
      <div className="space-y-section">
        <PageHeader title="Shared with us" />
        <EmptyState
          icon={Inbox}
          title="No workspace selected"
          description="Choose an organization to see what drivers have shared with it."
        />
      </div>
    );
  }

  const packages = packagesForOrganization(organization.id);

  return (
    <div className="space-y-section">
      <PageHeader
        title="Shared with us"
        description="Documents drivers sent this carrier directly. Nobody here is your driver until you invite them."
      />

      {packages.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Nothing has been shared with you yet"
          description="A driver can send their licence and medical card from their own Antcolos account, before any invitation exists."
        />
      ) : (
        <ul className="space-y-4">
          {packages.map((pkg) => {
            const opened = openNativePackage(organization.id, pkg.id);
            const usable = opened.status === "ok";
            return (
              <li
                key={pkg.id}
                data-share-id={pkg.id}
                className="space-y-3 rounded-lg border border-border bg-surface p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="text-[0.9375rem] font-semibold text-fg">{pkg.driverName}</span>
                      <ShareStateChip pkg={pkg} />
                    </p>
                    <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
                      {SHARE_PURPOSE_LABEL[pkg.purpose]} · shared {formatDate(pkg.createdAt)} · access
                      ends {formatDate(pkg.expiresAt)}
                    </p>
                    {pkg.note ? (
                      <p className="mt-1 text-[0.75rem] text-fg-subtle">“{pkg.note}”</p>
                    ) : null}
                  </div>
                  {canInvite ? (
                    <Button asChild variant="secondary" size="sm">
                      <Link href="/settings/invitations/new">Invite them to onboard</Link>
                    </Button>
                  ) : null}
                </div>

                {!usable ? (
                  <FormAlert tone="warning" role="none" title={`This share is ${shareState(pkg)}.`}>
                    The driver withdrew it or it ran out. What you reviewed before is still recorded;
                    ask them to share again if you need another look.
                  </FormAlert>
                ) : (
                  <ul className="space-y-3">
                    {pkg.items.map((item) => (
                      <div key={item.documentId} className="space-y-2">
                        <SharedDocumentCard item={item} pkg={pkg} />
                        <ReviewRow
                          documentId={item.documentId}
                          driverProfileId={pkg.driverProfileId}
                          driverName={pkg.driverName}
                          organizationId={organization.id}
                          packageId={pkg.id}
                          onReviewed={reload}
                          reviewerName={user.displayName}
                          organizationName={organization.displayName}
                        />
                      </div>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="rounded-md border border-dashed border-border px-3.5 py-3 text-[0.75rem] leading-relaxed text-fg-subtle">
        Everything here is self-provided by the driver and not source-verified: Antcolos has not
        checked a licence with a state, and an uploaded MVR is not an ordered background check. Your
        review is yours — it is recorded against this organization only, and no other carrier sees
        it.
      </p>
    </div>
  );
}

/**
 * This carrier's own verdict on one shared document, and — only once it has one
 * — the option to rely on that exact version.
 *
 * The order is the rule, not the layout. Reviewing comes first because adopting
 * evidence nobody looked at is the one claim a qualification file must never be
 * able to make, and the service refuses it regardless of what this screen
 * renders.
 */
function ReviewRow({
  documentId,
  driverProfileId,
  driverName,
  organizationId,
  organizationName,
  packageId,
  reviewerName,
  onReviewed,
}: {
  documentId: string;
  driverProfileId: string;
  driverName: string;
  organizationId: string;
  organizationName: string;
  packageId: string;
  reviewerName: string;
  onReviewed: () => void;
}) {
  const record = documentById(documentId);
  const link = record?.links.find((l) => !l.unlinkedAt && l.contextOrganizationId === organizationId);
  const state = link?.review.state;
  // Both hooks called unconditionally: `&&` would short-circuit the second and
  // change the hook order between renders.
  const canManageCompliance = useCan("compliance:manage");
  const canSeeQualificationFile = useCan("qualification:view");
  const canAdopt = canManageCompliance && canSeeQualificationFile;
  const [adoptOpen, setAdoptOpen] = useState(false);

  if (state === "approved" || state === "rejected") {
    return (
      <div className="space-y-2 px-1">
        <p data-review-state={state} className="text-[0.75rem] font-medium text-fg-muted">
          {state === "approved" ? "You accepted this document." : "You rejected this document."}
          {link?.review.reviewedByName ? ` — ${link.review.reviewedByName}` : ""}
        </p>
        {canAdopt ? (
          <>
            <Button
              variant="secondary"
              size="sm"
              data-testid="adopt-button"
              onClick={() => setAdoptOpen(true)}
            >
              Adopt into qualification file
            </Button>
            <AdoptDialog
              documentId={documentId}
              driverProfileId={driverProfileId}
              driverName={driverName}
              open={adoptOpen}
              onOpenChange={setAdoptOpen}
              onAdopted={onReviewed}
            />
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2 px-1">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => {
          recordShareReview(organizationId, organizationName, packageId, documentId, "accepted", reviewerName);
          onReviewed();
        }}
      >
        <Check aria-hidden />
        Accept
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          recordShareReview(
            organizationId, organizationName, packageId, documentId, "rejected", reviewerName,
            "Not readable enough to accept.",
          );
          onReviewed();
        }}
      >
        <X aria-hidden />
        Reject
      </Button>
    </div>
  );
}
