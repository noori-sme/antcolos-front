"use client";

import { LoaderCircle, ShieldAlert, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState, LoadingSkeleton } from "@/components/data/states";
import {
  AVAILABILITY_IMPACT_DESCRIPTION, AVAILABILITY_IMPACT_LABEL, DEFECT_AREA_LABEL,
  DEFECT_SEVERITY_DESCRIPTION, DEFECT_SEVERITY_LABEL, formatMaintenanceDateTime,
} from "@/lib/maintenance/labels";
import {
  listDefects, maintainableEquipment, equipmentSummary, reportDefect,
} from "@/lib/api/mock/maintenance-registry";
import type {
  DefectArea, DefectSeverity, EquipmentAvailabilityImpact,
  MaintenanceEquipmentSummary, ReportedDefect,
} from "@/types";
import { AvailabilityImpactChip, DefectSeverityChip, DefectStateChip } from "./chips";
import { useMaintenanceContext } from "./use-maintenance-context";
import { cn } from "@/lib/utils";

const AREAS: DefectArea[] = [
  "brakes", "tires_wheels", "lights_electrical", "steering_suspension", "engine",
  "transmission_driveline", "coupling", "reefer_unit", "body_doors",
  "safety_equipment", "other",
];

const SEVERITIES: DefectSeverity[] = ["minor", "major", "critical", "out_of_service"];
const IMPACTS: EquipmentAvailabilityImpact[] = ["none", "reduced", "out_of_service"];

/**
 * The driver's own defect surface.
 *
 * A driver reaches exactly the equipment they are assigned to — not because
 * this screen filters a list, but because the registry will not give them
 * anything else. Reporting a fault as "should not be driven" parks the
 * equipment on the spot, and the form says so before it is submitted rather
 * than after.
 */
export function DriverDefectScreen() {
  const ctx = useMaintenanceContext();
  const uid = useId();

  // Null until the first load resolves, so the effect never sets state
  // synchronously and there is no separate flag to fall out of step with it.
  const [data, setData] = useState<{
    equipment: MaintenanceEquipmentSummary[];
    mine: ReportedDefect[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [equipmentId, setEquipmentId] = useState<string>("");
  const [area, setArea] = useState<DefectArea>("brakes");
  const [severity, setSeverity] = useState<DefectSeverity>("minor");
  const [impact, setImpact] = useState<EquipmentAvailabilityImpact>("none");
  const [summary, setSummary] = useState("");
  const [detail, setDetail] = useState("");
  const [odometer, setOdometer] = useState("");

  const load = useCallback(() => {
    if (!ctx) return;
    let cancelled = false;
    const summaries = maintainableEquipment(ctx).map((ref) => equipmentSummary(ref, ctx));
    listDefects(ctx, { mineOnly: true }).then((defects) => {
      if (cancelled) return;
      setData({ equipment: summaries, mine: defects });
      setEquipmentId((current) => current || summaries[0]?.equipmentId || "");
    });
    return () => { cancelled = true; };
  }, [ctx]);

  useEffect(() => load(), [load]);

  const equipment = data?.equipment ?? [];
  const mine = data?.mine ?? [];

  /**
   * The two fields are genuinely different questions, but one answer forces the
   * other: saying the equipment should not be driven IS saying it cannot be
   * used. The form keeps them consistent so the service layer never has to
   * reject the submission for contradicting itself.
   */
  function chooseSeverity(next: DefectSeverity) {
    setSeverity(next);
    if (next === "out_of_service") setImpact("out_of_service");
  }

  async function submit() {
    if (!ctx) return;
    const chosen = equipment.find((e) => e.equipmentId === equipmentId);
    if (!chosen) return;

    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await reportDefect({
        equipment: { kind: chosen.kind, equipmentId: chosen.equipmentId },
        area,
        severity,
        availabilityImpact: impact,
        summary,
        detail: detail.trim() || undefined,
        meterAtReport: odometer.trim() ? { odometerMiles: Number(odometer) } : undefined,
      }, ctx);

      setMessage(
        severity === "out_of_service"
          ? "Reported. The equipment has been parked and maintenance has been notified inside Antcolos."
          : "Reported. Maintenance will see it on their board.",
      );
      setSummary(""); setDetail(""); setOdometer("");
      setSeverity("minor"); setImpact("none");
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!ctx || data === null) return <LoadingSkeleton rows={5} />;

  if (equipment.length === 0) {
    return (
      <div className="space-y-section">
        <PageHeader title="Report a defect" description="Tell maintenance what is wrong with your equipment." />
        <EmptyState
          icon={TriangleAlert}
          title="You are not on any equipment"
          description="Defects are reported against the truck or trailer you are assigned to. When your carrier puts you on one, it appears here."
        />
      </div>
    );
  }

  return (
    <div className="space-y-section">
      <PageHeader
        title="Report a defect"
        description="Tell maintenance what is wrong. What you report goes on the equipment's permanent record and stays with it."
      />

      {error ? (
        <p role="alert" className="rounded-md border border-st-danger/40 bg-st-danger-bg/50 px-3.5 py-2.5 text-[0.8125rem] text-fg">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="rounded-md border border-st-success/40 bg-st-success-bg/50 px-3.5 py-2.5 text-[0.8125rem] text-fg">
          {message}
        </p>
      ) : null}

      <form
        className="space-y-4 rounded-lg border border-border bg-surface p-4 shadow-e1"
        onSubmit={(e) => { e.preventDefault(); submit(); }}
      >
        <Field label="Which equipment" htmlFor={`${uid}-eq`}>
          <select
            id={`${uid}-eq`}
            value={equipmentId}
            onChange={(e) => setEquipmentId(e.target.value)}
            className="h-control w-full rounded-md border border-border bg-surface px-3 text-[0.875rem] text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {equipment.map((item) => (
              <option key={item.equipmentId} value={item.equipmentId}>
                {item.unit} · {item.typeLabel}
              </option>
            ))}
          </select>
        </Field>

        <Field label="What part of it" htmlFor={`${uid}-area`}>
          <select
            id={`${uid}-area`}
            value={area}
            onChange={(e) => setArea(e.target.value as DefectArea)}
            className="h-control w-full rounded-md border border-border bg-surface px-3 text-[0.875rem] text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {AREAS.map((value) => (
              <option key={value} value={value}>{DEFECT_AREA_LABEL[value]}</option>
            ))}
          </select>
        </Field>

        <Field label="What is wrong" htmlFor={`${uid}-summary`}>
          <Input
            id={`${uid}-summary`}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="Rear door latch not catching"
            required
          />
        </Field>

        <Field label="Anything else worth knowing" htmlFor={`${uid}-detail`} hint="Optional.">
          <Textarea
            id={`${uid}-detail`}
            rows={3}
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            placeholder="When it started, what it sounds like, whether it is getting worse"
          />
        </Field>

        <fieldset>
          <legend className="text-[0.8125rem] font-medium text-fg">How bad is it</legend>
          <div className="mt-2 space-y-2">
            {SEVERITIES.map((value) => (
              <label
                key={value}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition-colors",
                  severity === value
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-border-strong",
                )}
              >
                <input
                  type="radio"
                  name={`${uid}-severity`}
                  value={value}
                  checked={severity === value}
                  onChange={() => chooseSeverity(value)}
                  className="mt-1"
                />
                <span className="min-w-0">
                  <span className="block text-[0.8125rem] font-medium text-fg">
                    {DEFECT_SEVERITY_LABEL[value]}
                  </span>
                  <span className="mt-0.5 block text-[0.75rem] leading-relaxed text-fg-muted">
                    {DEFECT_SEVERITY_DESCRIPTION[value]}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {severity === "out_of_service" ? (
          <p className="flex items-start gap-2 rounded-md border border-st-danger/40 bg-st-danger-bg/40 px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-fg">
            <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-st-danger" />
            <span>
              This parks the equipment straight away. Nobody can put a load on it until
              maintenance resolves the fault, and it cannot be deferred.
            </span>
          </p>
        ) : null}

        <fieldset>
          <legend className="text-[0.8125rem] font-medium text-fg">Can it still be used</legend>
          <div className="mt-2 space-y-2">
            {IMPACTS.map((value) => {
              const forced = severity === "out_of_service" && value !== "out_of_service";
              return (
                <label
                  key={value}
                  className={cn(
                    "flex items-start gap-3 rounded-md border px-3 py-2.5 transition-colors",
                    forced ? "cursor-not-allowed opacity-50" : "cursor-pointer",
                    impact === value ? "border-primary bg-primary/5" : "border-border",
                  )}
                >
                  <input
                    type="radio"
                    name={`${uid}-impact`}
                    value={value}
                    checked={impact === value}
                    disabled={forced}
                    onChange={() => setImpact(value)}
                    className="mt-1"
                  />
                  <span className="min-w-0">
                    <span className="block text-[0.8125rem] font-medium text-fg">
                      {AVAILABILITY_IMPACT_LABEL[value]}
                    </span>
                    <span className="mt-0.5 block text-[0.75rem] leading-relaxed text-fg-muted">
                      {AVAILABILITY_IMPACT_DESCRIPTION[value]}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <Field
          label="Odometer right now (mi)"
          htmlFor={`${uid}-odo`}
          hint="Optional, and typed in by you — Antcolos does not read it off the truck."
        >
          <Input
            id={`${uid}-odo`}
            inputMode="numeric"
            value={odometer}
            onChange={(e) => setOdometer(e.target.value)}
          />
        </Field>

        <Button type="submit" variant="primary" disabled={busy || !summary.trim()}>
          {busy ? <LoaderCircle aria-hidden className="animate-spin" /> : null}
          Report it
        </Button>
      </form>

      <section>
        <h2 className="text-[0.9375rem] font-semibold text-fg">What you have reported</h2>
        {mine.length === 0 ? (
          <p className="mt-2 text-[0.8125rem] text-fg-muted">
            You have not reported anything yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {mine.map((defect) => (
              <li key={defect.id} className="rounded-lg border border-border bg-surface px-4 py-3 shadow-e1">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                  <p className="text-[0.875rem] font-medium text-fg">{defect.summary}</p>
                  <p className="text-[0.75rem] text-fg-subtle">
                    {formatMaintenanceDateTime(defect.reportedAt)}
                  </p>
                </div>
                <p className="mt-2 flex flex-wrap items-center gap-1.5 text-[0.75rem] text-fg-subtle">
                  <DefectSeverityChip severity={defect.severity} />
                  <AvailabilityImpactChip impact={defect.availabilityImpact} />
                  <DefectStateChip state={defect.state} />
                  <span>{DEFECT_AREA_LABEL[defect.area]}</span>
                </p>
                {defect.resolutionNote ? (
                  <p className="mt-2 rounded-md border border-st-success/30 bg-st-success-bg/40 px-3 py-2 text-[0.75rem] text-fg">
                    {defect.resolutionNote}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
