"use client";

import Link from "next/link";
import { useState } from "react";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useServiceContext } from "@/lib/api/use-service-context";
import {
  brokerPolicyDefaults, updateBrokerPolicyDefaults,
} from "@/lib/api/mock/broker-policy-registry";
import { memberIn, membersOf } from "@/lib/api/mock/membership-directory";
import { MAX_TEMPORARY_HOLD_HOURS, type BrokerPolicyDefaults } from "@/types";

/**
 * ★ SETTINGS HOLDS THE AUTHORITY, NOT THE POLICIES ★
 *
 * Who may propose, who may approve besides the Owner, how long a temporary hold
 * runs, whether a booking exception is allowed at all, and what a warning or an
 * unknown broker does at booking. That is the whole of it.
 *
 * The policies themselves — the hard blocks, the deprioritized brokers, the
 * proposals waiting on somebody — live in the broker directory, because they
 * are daily operating decisions and a settings page is not where a dispatcher
 * looks when a load did not come up. See `Directory → Brokers → Broker
 * policies`.
 *
 * Nothing here can loosen the two rules the product keeps for itself: the Owner
 * is always an approver and cannot be removed from the list, and a temporary
 * hold can never be configured to outlast `MAX_TEMPORARY_HOLD_HOURS`.
 */
export function BrokerPolicySettings() {
  const ctx = useServiceContext();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | undefined>();
  /*
   * `undefined` until somebody saves, then the record the save returned.
   *
   * The registry is synchronous, so the current settings are read while
   * rendering; only a save produces something React has to remember, and
   * remembering exactly that is why this is state and the read is not.
   */
  const [edited, setEdited] = useState<BrokerPolicyDefaults | undefined>();
  const defaults = edited ?? (ctx ? brokerPolicyDefaults(ctx.organizationId) : undefined);

  if (!ctx || !defaults) return null;

  const me = memberIn(ctx.organizationId, ctx.membershipId);
  const isOwner = me?.isOwner === true;
  const colleagues = membersOf(ctx.organizationId).filter(
    (m) => !m.isOwner && m.status === "active" && !m.driverProfileId,
  );

  async function save(patch: Parameters<typeof updateBrokerPolicyDefaults>[1]) {
    if (!ctx) return;
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      setEdited(await updateBrokerPolicyDefaults(ctx, patch));
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="broker-policy-authority"
      className="rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id="broker-policy-authority" className="text-[0.9375rem] font-semibold text-fg">
            Broker policy authority
          </h2>
          <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-fg-muted">
            Who may ask for a broker policy, who may approve one, and how long a
            temporary safety hold runs. The policies themselves live in{" "}
            <Link
              href="/directory/brokers/policies"
              className="font-medium text-st-info hover:underline"
            >
              Directory → Brokers → Broker policies
            </Link>
            .
          </p>
        </div>
      </div>

      {!isOwner ? (
        <p className="mt-3 rounded-md border border-border bg-canvas px-3 py-2 text-[0.8125rem] text-fg-muted">
          Only the Owner changes these. You can see what they are set to.
        </p>
      ) : null}

      <dl className="mt-4 space-y-4">
        <div>
          <dt className="text-[0.8125rem] font-medium text-fg">Who may propose</dt>
          <dd className="mt-0.5 text-[0.8125rem] text-fg-muted">
            Anybody holding{" "}
            <span className="font-medium text-fg">{defaults.proposeRequires}</span>.
            Proposing blocks nothing — it raises the decision for an approver.
          </dd>
        </div>

        <div>
          <dt className="text-[0.8125rem] font-medium text-fg">Who may approve</dt>
          <dd className="mt-1 text-[0.8125rem] text-fg-muted">
            The Owner, always — they are the final authority over whether this
            organization works with a broker, and cannot be taken off this list.
            Anybody ticked below may approve as well.
          </dd>
          <ul className="mt-2 space-y-1.5">
            {colleagues.map((member) => {
              const checked = defaults.additionalApproverMembershipIds
                .includes(member.membershipId);
              return (
                <li key={member.membershipId} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id={`approver-${member.membershipId}`}
                    checked={checked}
                    disabled={!isOwner || busy}
                    onChange={() => save({
                      additionalApproverMembershipIds: checked
                        ? defaults.additionalApproverMembershipIds
                          .filter((id) => id !== member.membershipId)
                        : [...defaults.additionalApproverMembershipIds, member.membershipId],
                    })}
                    className="size-4 rounded border-border"
                  />
                  <label
                    htmlFor={`approver-${member.membershipId}`}
                    className="text-[0.8125rem] text-fg"
                  >
                    {member.displayName}
                    {member.title ? (
                      <span className="text-fg-subtle"> · {member.title}</span>
                    ) : null}
                  </label>
                </li>
              );
            })}
            {colleagues.length === 0 ? (
              <li className="text-[0.8125rem] text-fg-subtle">
                Nobody else in this workspace yet.
              </li>
            ) : null}
          </ul>
        </div>

        <Field
          label="How long a temporary safety hold runs"
          htmlFor="hold-hours"
          hint={`Hours. At most ${MAX_TEMPORARY_HOLD_HOURS} — a hold that could run longer would be a permanent block by another name.`}
          error={error}
        >
          <Input
            id="hold-hours"
            type="number"
            min={1}
            max={MAX_TEMPORARY_HOLD_HOURS}
            defaultValue={defaults.temporaryHoldHours}
            disabled={!isOwner || busy}
            onBlur={(e) => {
              const hours = Number(e.target.value);
              if (Number.isFinite(hours) && hours !== defaults.temporaryHoldHours) {
                void save({ temporaryHoldHours: hours });
              }
            }}
            className="max-w-32"
          />
        </Field>

        <div>
          <dt className="text-[0.8125rem] font-medium text-fg">Booking exceptions</dt>
          <dd className="mt-1 flex items-center gap-2">
            <input
              type="checkbox"
              id="allow-exception"
              checked={defaults.allowOwnerBookingException}
              disabled={!isOwner || busy}
              onChange={() => save({
                allowOwnerBookingException: !defaults.allowOwnerBookingException,
              })}
              className="size-4 rounded border-border"
            />
            <label htmlFor="allow-exception" className="text-[0.8125rem] text-fg">
              The Owner may let a single booking through a block
            </label>
          </dd>
          <p className="mt-1 text-[0.75rem] text-fg-subtle">
            Every exception needs a reason and an expiry and writes one audit
            event. There is no standing exception, and a dispatch organization
            can never except a carrier&rsquo;s block whatever this is set to.
          </p>
        </div>

        <div>
          <dt className="text-[0.8125rem] font-medium text-fg">
            Warnings at booking
          </dt>
          <dd className="mt-1 flex items-center gap-2">
            <input
              type="checkbox"
              id="ack-warning"
              checked={defaults.warningBookingBehavior === "require_acknowledgement"}
              disabled={!isOwner || busy}
              onChange={() => save({
                warningBookingBehavior:
                  defaults.warningBookingBehavior === "require_acknowledgement"
                    ? "allow"
                    : "require_acknowledgement",
              })}
              className="size-4 rounded border-border"
            />
            <label htmlFor="ack-warning" className="text-[0.8125rem] text-fg">
              Make somebody say they read the warning before they book
            </label>
          </dd>
          <p className="mt-1 text-[0.75rem] text-fg-subtle">
            Either way the booking is allowed. A warning that could refuse would
            be a hard block nobody approved.
          </p>
        </div>

        <div>
          <dt className="text-[0.8125rem] font-medium text-fg">Unknown brokers</dt>
          <dd className="mt-1 flex items-center gap-2">
            <input
              type="checkbox"
              id="warn-unknown"
              checked={defaults.unknownBrokerBehavior === "warn"}
              disabled={!isOwner || busy}
              onChange={() => save({
                unknownBrokerBehavior:
                  defaults.unknownBrokerBehavior === "warn" ? "allow" : "warn",
              })}
              className="size-4 rounded border-border"
            />
            <label htmlFor="warn-unknown" className="text-[0.8125rem] text-fg">
              Flag freight whose broker cannot be matched to a profile
            </label>
          </dd>
          <p className="mt-1 text-[0.75rem] text-fg-subtle">
            A posting with no MC number cannot be tied to a broker profile, so no
            policy is applied to it — a policy is never applied on a name. This
            only decides whether the gap is pointed out. It never blocks.
          </p>
        </div>
      </dl>

      {saved ? (
        <p role="status" className="mt-3 text-[0.75rem] text-st-success">Saved.</p>
      ) : null}
    </section>
  );
}
