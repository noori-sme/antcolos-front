"use client";

import { useQuery } from "@tanstack/react-query";
import { Clock, MapPin, PackageCheck, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  PUBLIC_REFUSAL_MESSAGE, TRACKING_HEALTH_LABEL, TRACKING_UPDATE_KIND_LABEL,
  type PublicTrackingResult,
} from "@/types";
import { publicTracking } from "@/lib/api/mock/tracking-board";

/**
 * The public tracking page.
 *
 * Everything about it is deliberately small. It is reached with a token and
 * nothing else, it shows one load, it says when it expires, and it says in
 * plain words what it is: mock data, not a MacroPoint feed, not a live GPS
 * connection.
 *
 * It renders whatever the resolver hands back and asks no further questions.
 * There is no field it could request, no id it could vary and no organization
 * it could name — which is what makes a leaked token uninteresting.
 */
export function PublicTrackingScreen({ token }: { token: string }) {
  /**
   * Resolved in the browser, because the whole mock layer is in-memory and
   * per-session: a server render would look the token up in a process that has
   * never seen it minted. A real adapter resolves this server-side and the
   * page renders exactly the same shapes.
   */
  const lookup = useQuery<PublicTrackingResult>({
    queryKey: ["public-tracking", token],
    queryFn: async () => publicTracking(token),
    // A tracking link is looked up once per visit. Refetching on focus would
    // silently change what a customer is looking at mid-read.
    refetchOnWindowFocus: false,
    retry: false,
  });

  const result = lookup.data ?? null;

  if (!result) {
    return (
      <p className="text-[0.875rem] text-fg-muted" aria-busy="true">
        Looking up this tracking link…
      </p>
    );
  }

  if (!result.ok) {
    return (
      <div className="w-full max-w-md rounded-lg border border-border bg-surface p-6 text-center shadow-e1">
        <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-lg bg-surface-sunken text-fg-subtle">
          <ShieldAlert className="size-5" aria-hidden />
        </div>
        <h1 className="text-[1.0625rem] font-semibold text-fg">Tracking unavailable</h1>
        <p className="mt-1.5 text-[0.875rem] leading-relaxed text-fg-muted">
          {result.message || PUBLIC_REFUSAL_MESSAGE[result.refusal]}
        </p>
        <p className="mt-4 text-[0.75rem] leading-relaxed text-fg-subtle">
          If you still need an update on this shipment, contact the carrier or the broker who sent
          you this link. Antcolos cannot reopen it from here.
        </p>
      </div>
    );
  }

  const view = result.view;

  return (
    <div className="w-full max-w-2xl space-y-4">
      <header className="rounded-lg border border-border bg-surface p-5 shadow-e1">
        <p className="text-[0.6875rem] font-medium tracking-wide text-fg-subtle uppercase">
          Shipment tracking · {view.audience}
        </p>
        <h1 className="mt-1 text-[1.375rem] leading-8 font-semibold tracking-[-0.015em] text-fg">
          {view.reference}
        </h1>
        <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[0.8125rem] text-fg-muted">
          {view.carrierName ? <span>{view.carrierName}</span> : null}
          {view.equipmentType ? <Badge tone="outline">{view.equipmentType}</Badge> : null}
          {view.health ? (
            <Badge tone={view.health === "live" ? "success" : view.health === "stale" ? "warning" : "danger"}>
              {TRACKING_HEALTH_LABEL[view.health]}
            </Badge>
          ) : null}
        </p>
      </header>

      {view.stops.length > 0 ? (
        <section className="rounded-lg border border-border bg-surface p-5 shadow-e1">
          <h2 className="flex items-center gap-2 text-[0.875rem] font-semibold text-fg">
            <PackageCheck className="size-4 text-fg-subtle" aria-hidden />
            Progress
          </h2>
          <ol className="mt-3 space-y-3">
            {view.stops.map((stop) => (
              <li key={`${stop.kind}-${stop.city}`} className="border-l-2 border-border pl-3">
                <p className="text-[0.8125rem] font-medium text-fg">
                  {stop.kind === "pickup" ? "Pickup" : "Delivery"} —{" "}
                  {stop.facilityName ?? `${stop.city}, ${stop.state}`}
                </p>
                <p className="mt-0.5 text-[0.75rem] text-fg-muted">
                  {stop.city}, {stop.state}
                  {stop.appointmentAt
                    ? ` · scheduled ${new Date(stop.appointmentAt).toLocaleString()}`
                    : ""}
                </p>
                {stop.arrivedAt ? (
                  <p className="mt-0.5 text-[0.75rem] text-fg-muted">
                    Arrived {new Date(stop.arrivedAt).toLocaleString()}
                  </p>
                ) : null}
                {stop.departedAt ? (
                  <p className="mt-0.5 text-[0.75rem] text-fg-muted">
                    Departed {new Date(stop.departedAt).toLocaleString()}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {view.truckLocation || view.etaAt || view.lastUpdateAt ? (
        <section className="rounded-lg border border-border bg-surface p-5 shadow-e1">
          <h2 className="flex items-center gap-2 text-[0.875rem] font-semibold text-fg">
            <MapPin className="size-4 text-fg-subtle" aria-hidden />
            Where it is
          </h2>
          <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {view.truckLocation ? (
              <Fact
                label="Last reported near"
                value={[view.truckLocation.city, view.truckLocation.state].filter(Boolean).join(", ") || "Unknown"}
              />
            ) : null}
            {view.etaAt ? (
              <Fact label="Estimated arrival" value={new Date(view.etaAt).toLocaleString()} />
            ) : null}
            {view.lastUpdateAt ? (
              <Fact label="Last update" value={new Date(view.lastUpdateAt).toLocaleString()} />
            ) : null}
          </dl>
          {view.healthNote ? (
            <p className="mt-3 text-[0.75rem] leading-relaxed text-fg-muted">{view.healthNote}</p>
          ) : null}
        </section>
      ) : null}

      {view.status.length > 0 ? (
        <section className="rounded-lg border border-border bg-surface p-5 shadow-e1">
          <h2 className="text-[0.875rem] font-semibold text-fg">Updates</h2>
          <ul className="mt-2 divide-y divide-border">
            {view.status.map((s, i) => (
              <li key={`${s.kind}-${i}`} className="py-2.5">
                <p className="text-[0.8125rem] leading-relaxed text-fg">{s.message}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[0.6875rem] text-fg-subtle">
                  {TRACKING_UPDATE_KIND_LABEL[s.kind]} · {new Date(s.at).toLocaleString()}
                  <Badge tone={s.basis === "confirmed" ? "success" : "warning"}>
                    {s.basis === "confirmed" ? "Confirmed" : "Inferred"}
                  </Badge>
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="rounded-lg border border-border bg-surface-sunken p-5">
        <p className="flex items-center gap-2 text-[0.8125rem] font-medium text-fg">
          <Clock className="size-4 text-fg-subtle" aria-hidden />
          This link expires {new Date(view.expiresAt).toLocaleString()}
        </p>
        <p className="mt-2 text-[0.75rem] leading-relaxed text-fg-muted">{view.disclosure}</p>
        <p className="mt-2 text-[0.75rem] leading-relaxed text-fg-muted">
          It shows this shipment only. It carries no rate, no driver details, no hours of service,
          no internal notes and nothing about any other load or carrier, and it can be withdrawn at
          any time.
        </p>
      </footer>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.6875rem] font-medium tracking-wide text-fg-subtle uppercase">{label}</dt>
      <dd className="mt-0.5 text-[0.875rem] text-fg">{value}</dd>
    </div>
  );
}
