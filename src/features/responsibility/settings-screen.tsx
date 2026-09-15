"use client";

import { Lock, Truck } from "lucide-react";
import { useState } from "react";
import { EmptyState, ErrorState, LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  ESCALATED_FROM_LEVEL, VISIBILITY_ONLY_TRIGGERS,
} from "@/config/responsibility";
import {
  ESCALATION_ACTION_LABEL, ESCALATION_ACTION_MOVES_WORK,
  ESCALATION_TRIGGER_DESCRIPTION, ESCALATION_TRIGGER_LABEL,
  FLEET_TIER_LABEL, RESPONSIBILITY_FUNCTION_LABEL,
  type EscalationPolicy, type SlaTarget,
} from "@/types";
import {
  useEscalationPolicies, useFleetProfile, useSetFleetSize, useUpdatePolicy,
} from "./hooks";

/**
 * The advanced settings, and the reason they are a separate screen.
 *
 * Nothing here is required to use Antcolos. A Carrier who never opens this page
 * gets working defaults, automatic structure as people join, and escalation
 * that fires without anybody configuring a rung. This is where somebody who
 * WANTS to change those numbers comes, and the one place the words "policy",
 * "SLA" and "escalation ladder" appear in the product.
 *
 * The fleet-size card at the top is the exception: it is the ONE question
 * onboarding asks, repeated here so it can be corrected without an onboarding
 * flow.
 */

export function ResponsibilitySettingsScreen() {
  const profile = useFleetProfile();
  const policies = useEscalationPolicies();

  return (
    <div className="space-y-section">
      <PageHeader
        title="Responsibility & escalation"
        description="Defaults that already work. Change them only if you want to."
      />

      {profile.isPending ? (
        <LoadingSkeleton rows={2} />
      ) : profile.isError ? (
        <ErrorState description={profile.error.message} onRetry={() => profile.refetch()} />
      ) : (
        <FleetSizeCard profile={profile.data!} />
      )}

      <section className="space-y-3">
        <div>
          <h2 className="text-[1rem] font-semibold text-fg">Escalation policies</h2>
          <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
            Which work each policy covers, how long somebody has, and what happens
            when nobody acts. Seeded policies can be edited and never deleted — a
            workspace with no policy is a workspace where nothing escalates.
          </p>
        </div>

        {policies.isPending ? (
          <LoadingSkeleton rows={3} />
        ) : policies.isError ? (
          <EmptyState
            icon={Lock}
            title="Not yours to change"
            description={policies.error.message}
          />
        ) : (policies.data ?? []).length === 0 ? (
          <EmptyState title="No policies in this workspace" />
        ) : (
          <div className="space-y-3">
            {policies.data!.map((policy) => (
              <PolicyCard key={policy.id} policy={policy} />
            ))}
          </div>
        )}
      </section>

      <p className="rounded-md border border-dashed border-border px-3 py-2.5 text-[0.75rem] text-fg-subtle">
        These settings shape what the screens show and what the frontend
        computes. They do not start timers, send reminders, or enforce anything:
        real escalation jobs, delivery and authorization belong to the backend.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The one question                                                            */
/* -------------------------------------------------------------------------- */

function FleetSizeCard({ profile }: { profile: ReturnType<typeof useFleetProfile>["data"] }) {
  const setSize = useSetFleetSize();
  const [value, setValue] = useState(String(profile?.truckCount ?? 0));
  if (!profile) return null;

  const parsed = Number.parseInt(value, 10);
  const valid = Number.isFinite(parsed) && parsed >= 0;

  return (
    <Card className="space-y-4 p-4">
      <div className="flex items-start gap-3">
        <Truck aria-hidden className="mt-0.5 size-5 shrink-0 text-fg-subtle" />
        <div className="min-w-0">
          <h2 className="text-[0.9375rem] font-semibold text-fg">How many trucks?</h2>
          <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
            The only thing Antcolos asks about your shape. Everything else — team
            queues, supervisors, how many escalation levels you get — follows from
            this and from who is actually in the workspace.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Trucks" htmlFor="fleet-size" className="w-32">
          <Input
            id="fleet-size"
            inputMode="numeric"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
        <Button
          disabled={!valid || setSize.isPending}
          onClick={() => setSize.mutate(parsed)}
        >
          {setSize.isPending ? "Saving…" : "Save"}
        </Button>
      </div>

      {setSize.isError ? (
        <p role="alert" className="text-[0.8125rem] text-st-danger">
          {setSize.error.message}
        </p>
      ) : null}

      <dl className="grid gap-3 sm:grid-cols-2">
        <Fact label="Shape" value={FLEET_TIER_LABEL[profile.tier]} />
        <Fact
          label="People who can hold work"
          value={String(profile.eligibleMemberCount)}
        />
        <Fact
          label="Team queues"
          value={profile.teamQueuesEnabled ? "On" : "Off — nobody to queue work to yet"}
        />
        <Fact
          label="Supervisors"
          value={profile.supervisorsEnabled ? "On" : "Off"}
        />
        <Fact
          label="Escalation levels"
          value={String(profile.escalationLevels)}
        />
      </dl>

      <p className="text-[0.75rem] text-fg-subtle">{profile.summary}</p>
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.75rem] text-fg-subtle">{label}</dt>
      <dd className="text-[0.8125rem] font-medium text-fg">{value}</dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Policies                                                                    */
/* -------------------------------------------------------------------------- */

function PolicyCard({ policy }: { policy: EscalationPolicy }) {
  const update = useUpdatePolicy();
  const [ack, setAck] = useState(String(policy.sla.acknowledgeMinutes));
  const [resolve, setResolve] = useState(String(policy.sla.resolveMinutes));

  const next: SlaTarget = {
    acknowledgeMinutes: Number.parseInt(ack, 10),
    resolveMinutes: Number.parseInt(resolve, 10),
  };
  const valid =
    Number.isFinite(next.acknowledgeMinutes) && next.acknowledgeMinutes > 0
    && Number.isFinite(next.resolveMinutes) && next.resolveMinutes > 0;
  const changed =
    next.acknowledgeMinutes !== policy.sla.acknowledgeMinutes
    || next.resolveMinutes !== policy.sla.resolveMinutes;

  return (
    <Card className="space-y-4 p-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[0.9375rem] font-semibold text-fg">{policy.name}</h3>
          {policy.seeded ? <Badge tone="outline">Built in</Badge> : null}
        </div>
        <p className="mt-0.5 text-[0.8125rem] text-fg-muted">{policy.description}</p>
        {policy.appliesToFunctions ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {policy.appliesToFunctions.map((f) => (
              <Badge key={f} tone="neutral">{RESPONSIBILITY_FUNCTION_LABEL[f]}</Badge>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Acknowledge within (min)" htmlFor={`${policy.id}-ack`} className="w-44">
          <Input
            id={`${policy.id}-ack`}
            inputMode="numeric"
            value={ack}
            onChange={(e) => setAck(e.target.value)}
          />
        </Field>
        <Field label="Resolve within (min)" htmlFor={`${policy.id}-res`} className="w-44">
          <Input
            id={`${policy.id}-res`}
            inputMode="numeric"
            value={resolve}
            onChange={(e) => setResolve(e.target.value)}
          />
        </Field>
        <Button
          variant="secondary"
          disabled={!valid || !changed || update.isPending}
          onClick={() => update.mutate({ policyId: policy.id, patch: { sla: next } })}
        >
          {update.isPending ? "Saving…" : "Save targets"}
        </Button>
      </div>

      {update.isError ? (
        <p role="alert" className="text-[0.8125rem] text-st-danger">{update.error.message}</p>
      ) : null}

      <div className="space-y-2">
        <h4 className="text-[0.8125rem] font-semibold text-fg">What starts an escalation</h4>
        <ul className="space-y-1">
          {policy.triggers.map((t) => (
            <li key={t} className="text-[0.75rem] text-fg-muted">
              <span className="font-medium text-fg">{ESCALATION_TRIGGER_LABEL[t]}</span>
              {" — "}
              {ESCALATION_TRIGGER_DESCRIPTION[t]}
              {VISIBILITY_ONLY_TRIGGERS.includes(t) ? (
                <span className="text-fg-subtle">
                  {" "}Gives the manager visibility once; it never climbs.
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        <h4 className="text-[0.8125rem] font-semibold text-fg">The ladder</h4>
        <ol className="space-y-1.5">
          {policy.steps.map((step) => (
            <li key={step.level} className="flex flex-wrap items-baseline gap-2">
              <Badge tone={step.level >= ESCALATED_FROM_LEVEL ? "warning" : "neutral"}>
                Level {step.level}
              </Badge>
              <span className="text-[0.8125rem] font-medium text-fg">
                {ESCALATION_ACTION_LABEL[step.action]}
              </span>
              <span className="text-[0.75rem] text-fg-subtle">
                after {step.afterMinutes} min · {step.detail}
              </span>
              {ESCALATION_ACTION_MOVES_WORK[step.action] ? (
                <Badge tone="danger">Moves the work</Badge>
              ) : null}
            </li>
          ))}
        </ol>
        <p className="text-[0.75rem] text-fg-subtle">
          No built-in ladder moves work off the person holding it. Escalation
          gives somebody else visibility and leaves the assignee responsible;
          only a step you add yourself, or a person choosing to reassign, changes
          who is doing it.
        </p>
      </div>
    </Card>
  );
}
