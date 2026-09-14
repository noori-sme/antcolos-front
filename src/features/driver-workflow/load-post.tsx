"use client";

import {
  BadgeCheck, Clock3, FileSignature, Mail, MapPin, Phone, Truck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EQUIPMENT_LABEL } from "@/config/statuses";
import { dateTimeIn } from "@/lib/utils";
import type { DriverLoadPost } from "@/types";
import { RatePanel } from "./rate-panel";

/**
 * The finalized Driver Load Post — the authorized version of the load.
 *
 * It exists only because the rate confirmation was reviewed and approved by
 * dispatch, signed with the carrier's authorized signature, and sent back to
 * the broker. The header says so, because "is this actually mine to run" is the
 * first question a driver has and the paperwork is the only honest answer.
 */
export function LoadPostCard({ post }: { post: DriverLoadPost }) {
  return (
    <div className="space-y-stack">
      <Card className="border-st-success/30">
        <CardContent className="flex items-start gap-3 pt-4">
          <BadgeCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-st-success" />
          <div className="min-w-0">
            <p className="text-[0.9375rem] font-semibold text-fg">This load is final</p>
            <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
              The rate confirmation was reviewed and approved by dispatch, signed with the
              carrier&apos;s authorized signature, and sent back to the broker on{" "}
              {dateTimeIn(post.finalizedAt, post.stops[0]?.timeZone ?? "UTC")}.
            </p>
            <p className="mt-1.5 flex items-center gap-1.5 text-[0.75rem] text-fg-subtle">
              <FileSignature aria-hidden className="size-3.5" />
              Rate confirmation {post.rateConfirmationRef.externalId}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="min-w-0">
            <CardTitle className="font-mono text-[1.0625rem]">{post.loadReference}</CardTitle>
            <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
              {post.customerKind === "broker" ? "Broker" : "Shipper"} · {post.customerName}
            </p>
          </div>
          <Badge tone="outline">
            <Truck aria-hidden className="size-3" />
            {EQUIPMENT_LABEL[post.equipment.type] ?? post.equipment.type}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-5">
          <ol className="space-y-4">
            {post.stops.map((stop, i) => (
              <li key={stop.stopId} className="flex gap-3">
                <span className="flex flex-col items-center">
                  <span
                    aria-hidden
                    className={`mt-1 size-2.5 rounded-full ${stop.kind === "pickup" ? "bg-fg-subtle" : "bg-primary"}`}
                  />
                  {i < post.stops.length - 1 ? (
                    <span aria-hidden className="my-1 w-px flex-1 bg-border" />
                  ) : null}
                </span>
                <span className="min-w-0 flex-1 pb-1">
                  <span className="block text-[0.6875rem] font-semibold tracking-wider text-fg-subtle uppercase">
                    {stop.kind === "pickup" ? "Pick up" : "Deliver"}
                    {stop.facilityName ? ` · ${stop.facilityName}` : ""}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[1rem] font-semibold text-fg">
                    <MapPin aria-hidden className="size-4 shrink-0 text-fg-subtle" />
                    {[stop.address.line1, `${stop.address.city}, ${stop.address.state}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[0.875rem] text-fg-muted">
                    <Clock3 aria-hidden className="size-3.5 shrink-0" />
                    {dateTimeIn(stop.appointmentAt, stop.timeZone)}
                    {stop.appointmentEndAt
                      ? ` – ${dateTimeIn(stop.appointmentEndAt, stop.timeZone)}`
                      : ""}
                    <Badge tone="neutral">{appointmentLabel(stop.appointmentType)}</Badge>
                  </span>

                  {stop.referenceNumbers.length > 0 ? (
                    <span className="mt-1.5 flex flex-wrap gap-1.5">
                      {stop.referenceNumbers.map((r) => (
                        <Badge key={`${r.label}-${r.value}`} tone="outline">
                          {r.label} {r.value}
                        </Badge>
                      ))}
                    </span>
                  ) : null}

                  {stop.instructions ? (
                    <span className="mt-1.5 block rounded-md bg-surface-sunken px-3 py-2 text-[0.8125rem] leading-5 text-fg">
                      {stop.instructions}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-4 sm:grid-cols-3">
            {post.loadDetails.commodity ? (
              <Detail label="Commodity" value={post.loadDetails.commodity} />
            ) : null}
            {post.loadDetails.weightLbs ? (
              <Detail label="Weight" value={`${post.loadDetails.weightLbs.toLocaleString()} lb`} />
            ) : null}
            {post.equipment.truckUnit ? (
              <Detail label="Truck" value={post.equipment.truckUnit} />
            ) : null}
            {post.equipment.trailerUnit ? (
              <Detail label="Trailer" value={post.equipment.trailerUnit} />
            ) : null}
            {post.loadDetails.temperatureF ? (
              <Detail
                label="Temperature"
                value={`${post.loadDetails.temperatureF.min}–${post.loadDetails.temperatureF.max} °F`}
              />
            ) : null}
          </dl>
        </CardContent>
      </Card>

      {post.contacts.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Who to call</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <ul className="divide-y divide-border border-t border-border">
              {post.contacts.map((c, i) => (
                <li key={`${c.role}-${i}`} className="px-5 py-3">
                  <p className="text-[0.8125rem] text-fg-muted">{c.role}</p>
                  {c.name ? (
                    <p className="mt-0.5 text-[0.9375rem] font-medium text-fg">{c.name}</p>
                  ) : null}
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                    {c.phone ? (
                      <a
                        href={`tel:${c.phone.replace(/[^+0-9]/g, "")}`}
                        className="inline-flex items-center gap-1.5 text-[0.875rem] text-primary hover:underline"
                      >
                        <Phone aria-hidden className="size-3.5" />
                        {c.phone}
                      </a>
                    ) : null}
                    {c.email ? (
                      <a
                        href={`mailto:${c.email}`}
                        className="inline-flex items-center gap-1.5 text-[0.875rem] text-primary hover:underline"
                      >
                        <Mail aria-hidden className="size-3.5" />
                        {c.email}
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <div className="min-w-0">
            <CardTitle>What it pays</CardTitle>
            <p className="mt-0.5 text-[0.8125rem] text-fg-muted">{post.engagementType === "owner_operator" ? "Owner-operator" : "Company driver"}</p>
          </div>
        </CardHeader>
        <CardContent>
          <RatePanel rate={post.rate} policyLabel={policyLabelOf(post)} />
        </CardContent>
      </Card>
    </div>
  );
}

function policyLabelOf(post: DriverLoadPost): string {
  return post.engagementType === "owner_operator"
    ? "your owner-operator agreement"
    : "this carrier's company driver policy";
}

function appointmentLabel(kind: string): string {
  switch (kind) {
    case "fcfs": return "First come, first served";
    case "window": return "Window";
    default: return "Appointment";
  }
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.6875rem] font-semibold tracking-wider text-fg-subtle uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 text-[0.9375rem] text-fg">{value}</dd>
    </div>
  );
}
