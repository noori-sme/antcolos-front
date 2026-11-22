"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bot, HardDrive, Mail, Send, type LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Chip } from "@/components/ui/chip";
import { ErrorState, LoadingSkeleton } from "@/components/data/states";
import { useServiceContext } from "@/lib/api/use-service-context";
import { bytes, notMeteredLabel, RANGE_PRESETS, rangeFor, usd, type RangePreset } from "@/lib/usage/format";
import { useOrganizationUsage } from "./hooks";

const PRESET_LABELS: Record<RangePreset, string> = { "7d": "7 days", "30d": "30 days", "90d": "90 days" };

function Tile({ icon: Icon, label, value, detail }: { icon: LucideIcon; label: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-e1">
      <div className="flex items-center gap-2 text-[0.8125rem] text-fg-muted">
        <Icon aria-hidden className="size-4" />
        {label}
      </div>
      <p className="mt-2 text-[1.25rem] font-semibold tabular-nums text-fg">{value}</p>
      <p className="mt-1 text-[0.8125rem] text-fg-muted">{detail}</p>
    </div>
  );
}

/** What this organization used and what it is estimated to cost (M6.3, plan 26). */
export function UsageScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const ctx = useServiceContext();
  const preset: RangePreset =
    (Object.keys(RANGE_PRESETS) as RangePreset[]).find((p) => p === params.get("range")) ?? "30d";
  // Stable for the day: the range is whole UTC days.
  const range = useMemo(() => rangeFor(preset, new Date()), [preset]);
  const { data, isLoading, isError, error, refetch, isPlaceholderData } = useOrganizationUsage(range);

  const select = (next: RangePreset) => {
    const qs = new URLSearchParams(params.toString());
    if (next === "30d") qs.delete("range");
    else qs.set("range", next);
    const query = qs.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const t = data?.totals;
  const maxDaily = Math.max(0, ...(data?.aiDaily ?? []).map((d) => d.costUsd));

  return (
    <div className="space-y-section">
      <PageHeader
        title="Usage & costs"
        description="What your organization used, and what it is estimated to cost. AI cost is what each call recorded; storage and email use the rates below."
      />
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Period">
        {(Object.keys(RANGE_PRESETS) as RangePreset[]).map((p) => (
          <Chip key={p} label={PRESET_LABELS[p]} selected={preset === p} onToggle={() => select(p)} />
        ))}
      </div>

      {(isLoading || !ctx) && <LoadingSkeleton rows={3} />}
      {isError && !data && <ErrorState title="Couldn't load usage" description={error?.message} onRetry={() => refetch()} />}

      {t && (
        <div aria-busy={isPlaceholderData} className={isPlaceholderData ? "space-y-section opacity-60" : "space-y-section"}>
          <div className="rounded-lg border border-border bg-surface p-5 shadow-e1">
            <p className="text-[0.8125rem] text-fg-muted">Estimated total, last {PRESET_LABELS[preset]}</p>
            <p className="mt-1 text-[1.75rem] font-semibold tabular-nums text-fg">{usd(t.estimatedTotalUsd)}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile
              icon={Bot}
              label="AI"
              value={usd(t.ai.costUsd)}
              detail={`${t.ai.calls.toLocaleString()} calls · ${(t.ai.inputTokens + t.ai.outputTokens).toLocaleString()} tokens`}
            />
            <Tile
              icon={HardDrive}
              label="Storage (per month)"
              value={usd(t.storage.estimatedMonthlyUsd)}
              detail={`${t.storage.files.toLocaleString()} files · ${bytes(t.storage.bytes)}`}
            />
            <Tile
              icon={Mail}
              label="Email"
              value={usd(t.email.estimatedUsd)}
              detail={`${t.email.sent.toLocaleString()} sent${t.email.failed ? ` · ${t.email.failed} failed` : ""}`}
            />
            <Tile
              icon={Send}
              label="Telegram"
              value="Free"
              detail={`${t.telegram.sent.toLocaleString()} sent${t.telegram.failed ? ` · ${t.telegram.failed} failed` : ""}`}
            />
          </div>

          <section aria-labelledby="usage-daily" className="rounded-lg border border-border bg-surface p-5 shadow-e1">
            <h2 id="usage-daily" className="text-[0.9375rem] font-semibold text-fg">AI cost by day</h2>
            {data.aiDaily.length === 0 ? (
              <p className="mt-2 text-[0.8125rem] text-fg-muted">No AI calls in this period.</p>
            ) : (
              <table className="mt-3 w-full text-[0.8125rem]">
                <caption className="sr-only">AI calls and cost per day</caption>
                <thead className="sr-only">
                  <tr>
                    <th scope="col">Day</th>
                    <th scope="col">Cost</th>
                    <th scope="col">Calls</th>
                  </tr>
                </thead>
                <tbody>
                  {data.aiDaily.map((d) => (
                    <tr key={d.day}>
                      <td className="w-24 py-1 pr-3 tabular-nums text-fg-muted">{d.day.slice(5)}</td>
                      <td className="py-1 pr-3">
                        <div className="flex items-center gap-2">
                          <div
                            aria-hidden
                            className="h-2 rounded-full bg-primary"
                            style={{ width: `${maxDaily > 0 ? Math.max(2, (d.costUsd / maxDaily) * 100) : 2}%` }}
                          />
                          <span className="tabular-nums text-fg">{usd(d.costUsd)}</span>
                        </div>
                      </td>
                      <td className="w-20 py-1 text-right tabular-nums text-fg-muted">{d.calls} {d.calls === 1 ? "call" : "calls"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <p className="text-[0.8125rem] text-fg-muted">
            Rates: storage {usd(data.rates.storageUsdPerGbMonth)} per GB per month, email{" "}
            {usd(data.rates.emailUsdPerMessage)} per message.
            {data.notMetered.length > 0 && <> Not counted yet: {data.notMetered.map(notMeteredLabel).join(", ")}.</>}
          </p>
        </div>
      )}
    </div>
  );
}
