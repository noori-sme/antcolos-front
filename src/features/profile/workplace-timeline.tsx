import { Building2, ShieldQuestion } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatDuration, formatPeriod, daysBetween } from "@/lib/profile/tenure";
import { cn } from "@/lib/utils";
import { CAPACITY_LABEL, type WorkplaceAssociation } from "@/types";

/**
 * The employment timeline — where somebody has worked, in what capacity, and
 * for how long.
 *
 * ★ THE COMPANY NAME IS A SNAPSHOT ★
 * Rendered from `organizationNameSnapshot`, taken when the association opened,
 * so a carrier that rebrands or is sold cannot silently rewrite where somebody
 * worked. The row does not link anywhere: a profile reader has no right to an
 * organization's record, and a link that 403s for most people is worse than no
 * link at all.
 */
export function WorkplaceTimeline({
  associations,
  asOf,
}: {
  associations: WorkplaceAssociation[];
  asOf: string;
}) {
  if (associations.length === 0) {
    return (
      <Card className="px-5 py-5">
        <p className="text-[0.8125rem] text-fg-muted">
          No companies on this profile yet. A workplace is added automatically when somebody
          joins an organization on Antcolos, and it stays here after they leave.
        </p>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <ul className="divide-y divide-border">
        {associations.map((association) => {
          const current = !association.endedAt;
          const days = daysBetween(
            association.startedAt,
            association.endedAt ?? asOf,
          );
          return (
            <li key={association.id} className="flex gap-3.5 px-4 py-3.5">
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md",
                  current ? "bg-primary/12 text-primary" : "bg-surface-sunken text-fg-subtle",
                )}
              >
                <Building2 className="size-[1.125rem]" />
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <p className="min-w-0 text-[0.875rem] font-semibold text-fg">
                    {association.positionTitle ?? CAPACITY_LABEL[association.capacity]}
                    <span className="font-normal text-fg-muted"> at </span>
                    {association.organizationNameSnapshot}
                  </p>
                  {current ? (
                    <span className="shrink-0 rounded-sm bg-st-success-bg px-1.5 py-0.5 text-[0.6875rem] font-medium text-st-success">
                      Current
                    </span>
                  ) : null}
                </div>

                <p className="tnum mt-0.5 text-[0.8125rem] text-fg-muted">
                  {formatPeriod(association.startedAt, association.endedAt)}
                  {days >= 31 ? <span className="text-fg-subtle"> · {formatDuration(days)}</span> : null}
                </p>

                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.75rem] text-fg-subtle">
                  <span>{CAPACITY_LABEL[association.capacity]}</span>
                  {!association.verified ? (
                    <span className="inline-flex items-center gap-1 text-st-warning" title="Added by the person, not confirmed by Antcolos">
                      <ShieldQuestion aria-hidden className="size-3.5" />
                      Unverified
                    </span>
                  ) : null}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
