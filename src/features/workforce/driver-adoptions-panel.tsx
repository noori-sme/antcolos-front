"use client";

import { useQuery } from "@tanstack/react-query";
import { services } from "@/lib/api";
import { useServiceContext } from "@/lib/api/use-service-context";
import { orgKey } from "@/lib/query/keys";
import {
  QUALIFICATION_CATEGORY_LABEL, QUALIFICATION_PURPOSE_LABEL,
  RETENTION_STATE_LABEL,
} from "@/types";

/**
 * What the DRIVER is told about carriers holding their documents.
 *
 * A driver is entitled to know that a carrier pinned a specific version of
 * their licence, what for, when, and what that means for them if they later
 * withdraw the share. They are NOT shown the carrier's review, its reviewer,
 * its notes or its internal retention reasoning, and they cannot change any of
 * it: a carrier's qualification history is that carrier's record of a decision
 * it has to answer for.
 *
 * The narrowing is the service's, not this component's — `adoptionsForDriver`
 * returns a projection built field by field, so there is nothing private in the
 * data this panel receives to accidentally render.
 */
export function DriverAdoptionsPanel({ driverProfileId }: { driverProfileId: string }) {
  const ctx = useServiceContext();
  const adoptions = useQuery({
    queryKey: ctx
      ? [...orgKey(ctx.organizationId), "qualification", "driver", driverProfileId]
      : ["qualification", "no-context"],
    queryFn: () => services.qualification.adoptionsForDriver(ctx!, driverProfileId),
    enabled: Boolean(ctx),
  });

  if (!adoptions.data || adoptions.data.length === 0) return null;

  return (
    <section className="space-y-2" data-testid="driver-adoptions">
      <h2 className="text-[0.9375rem] font-semibold text-fg">
        Carriers keeping a copy of what you sent
      </h2>
      <ul className="space-y-2">
        {adoptions.data.map((a) => (
          <li
            key={`${a.organizationId}-${a.documentId}`}
            className="rounded-md border border-border bg-surface px-3.5 py-3"
          >
            <p className="text-[0.875rem] font-medium text-fg">{a.organizationName}</p>
            <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
              {QUALIFICATION_CATEGORY_LABEL[a.category]} — the exact version{" "}
              {a.documentVersion} you shared, for {QUALIFICATION_PURPOSE_LABEL[a.purpose].toLowerCase()},
              on {a.adoptedAt.slice(0, 10)}. Currently: {RETENTION_STATE_LABEL[a.retentionState].toLowerCase()}.
            </p>
            <p className="mt-1 text-[0.75rem] leading-relaxed text-fg-subtle">
              {a.retentionExplanation}
            </p>
          </li>
        ))}
      </ul>
      <p className="rounded-md border border-dashed border-border px-3.5 py-3 text-[0.75rem] leading-relaxed text-fg-subtle">
        You still own these documents and can replace them at any time. Replacing one does not
        change what a carrier already received: they keep the version they reviewed, and they can
        only move to a newer one by reviewing and adopting it explicitly.
      </p>
    </section>
  );
}
