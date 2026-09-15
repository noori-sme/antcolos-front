"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { services } from "@/lib/api";
import type { WorkKey } from "@/lib/api/contracts/responsibility";
import { useServiceContext } from "@/lib/api/use-service-context";
import { queryKeys } from "@/lib/query/keys";
import { HolderLine, SlaBadge, SourceBadge } from "./chips";

/**
 * Who holds this, on a screen that belongs to another module.
 *
 * The integration rule says feature components must not hardcode names or role
 * labels, and the way to honour that is not to forbid other modules from
 * showing responsibility — a Needs You drawer that cannot say who owns the item
 * is a worse drawer — but to give them ONE component that asks the
 * responsibility service and renders what it returns.
 *
 * So this is deliberately thin: it takes a work key, reads the record, and
 * renders the holders. It routes nothing, decides nothing, and has no opinion
 * about who anybody is. Everything it can do is also available on My work,
 * which is where the actions live.
 *
 * It renders NOTHING when the record cannot be read — a person who may not see
 * the roster should not learn the shape of it from a drawer.
 */
export function ResponsibilitySummary({ work }: { work: WorkKey }) {
  const ctx = useServiceContext();
  const query = useQuery({
    queryKey: ctx
      ? queryKeys.responsibilityItem(ctx.organizationId, ctx.membershipId, work.id)
      : ["responsibility", "item", "no-context"],
    queryFn: () => services.responsibility.get(ctx!, work),
    enabled: Boolean(ctx),
    // A drawer is not the place to show a routing failure: the item's own
    // content is what the person came for.
    retry: false,
  });

  const assignment = query.data;
  if (!assignment) return null;

  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[0.8125rem] font-semibold text-fg">Who holds this</h3>
        <Link
          href="/work"
          className="inline-flex items-center gap-1 text-[0.75rem] text-primary hover:underline"
        >
          My work
          <ArrowRight aria-hidden className="size-3" />
        </Link>
      </div>

      <HolderLine holder={assignment.responsible} showReason={false} />
      {assignment.accountable.membershipId !== assignment.responsible.membershipId ? (
        <HolderLine holder={assignment.accountable} showReason={false} />
      ) : null}

      <div className="flex flex-wrap items-center gap-1.5">
        <SourceBadge source={assignment.responsible.source} />
        <SlaBadge state={assignment.sla.worst} />
      </div>

      <p className="text-[0.75rem] text-fg-subtle">
        {assignment.responsible.reason}
      </p>
    </section>
  );
}
