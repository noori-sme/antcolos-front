"use client";

import { EyeOff, Lock } from "lucide-react";
import type { DisclosedRate } from "@/types";
import { money, ratePerMile } from "@/lib/utils";

/**
 * What the driver is allowed to see of the money, and — just as important —
 * what they are not.
 *
 * The service already removed the withheld fields; this renders what arrived
 * and then says plainly which numbers exist but are not shared, and under which
 * carrier rulebook. A blank where a number should be invites the driver to
 * assume the worst about their carrier; naming the rule does not.
 */
export function RatePanel({
  rate,
  policyLabel,
  className,
}: {
  rate?: DisclosedRate;
  policyLabel: string;
  className?: string;
}) {
  if (!rate) {
    return (
      <div className={className}>
        <p className="flex items-start gap-2 rounded-md bg-surface-sunken px-3 py-2.5 text-[0.8125rem] text-fg-muted">
          <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" />
          <span>
            No rate information is shared with you on this load under {policyLabel}.
          </span>
        </p>
      </div>
    );
  }

  const rows: { label: string; value: string; strong?: boolean }[] = [];
  if (rate.totalRateCents != null) {
    rows.push({ label: "Total rate", value: money(rate.totalRateCents), strong: true });
  }
  if (rate.linehaulCents != null) {
    rows.push({ label: "Linehaul", value: money(rate.linehaulCents) });
  }
  if (rate.ratePerMileCents != null) {
    rows.push({ label: "Rate per mile", value: ratePerMile(rate.ratePerMileCents) });
  }
  if (rate.driverShareCents != null) {
    rows.push({ label: "Your share", value: money(rate.driverShareCents), strong: true });
  }
  if (rate.loadedMiles != null) {
    rows.push({ label: "Loaded miles", value: `${rate.loadedMiles.toLocaleString()} mi` });
  }
  if (rate.deadheadMiles != null) {
    rows.push({ label: "Deadhead", value: `${rate.deadheadMiles.toLocaleString()} mi` });
  }

  return (
    <div className={className}>
      {rows.length > 0 ? (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3">
          {rows.map((row) => (
            <div key={row.label}>
              <dt className="text-[0.6875rem] font-semibold tracking-wider text-fg-subtle uppercase">
                {row.label}
              </dt>
              <dd
                className={
                  row.strong
                    ? "tnum mt-0.5 text-[1.0625rem] font-semibold text-fg"
                    : "tnum mt-0.5 text-[0.9375rem] text-fg"
                }
              >
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {rate.accessorials && rate.accessorials.length > 0 ? (
        <ul className="mt-3 space-y-1 border-t border-border pt-3">
          {rate.accessorials.map((a) => (
            <li key={a.code} className="flex justify-between text-[0.8125rem]">
              <span className="text-fg-muted">{a.label}</span>
              <span className="tnum text-fg">{money(a.amountCents)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {rate.withheld.length > 0 ? (
        <p className="mt-3 flex items-start gap-2 border-t border-border pt-3 text-[0.75rem] text-fg-subtle">
          <EyeOff aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Not shown to you under {policyLabel}:{" "}
            {rate.withheld.map((w) => w.field).join(", ")}.
          </span>
        </p>
      ) : null}
    </div>
  );
}
