import type {
  EldConnectionState, TelemetryDataQuality, TelemetryDiagnosticSeverity,
  TelemetryIngestionState,
} from "@/types";
import {
  CONNECTION_STATE_LABEL, DATA_QUALITY_LABEL,
} from "@/types";
import { cn } from "@/lib/utils";
import {
  CONNECTION_TONE, DIAGNOSTIC_TONE, INGESTION_LABEL, INGESTION_TONE, QUALITY_TONE,
} from "./labels";

const CHIP =
  "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium";

export function ConnectionStateChip({
  state, className,
}: { state: EldConnectionState; className?: string }) {
  return (
    <span className={cn(CHIP, CONNECTION_TONE[state], className)}>
      {CONNECTION_STATE_LABEL[state]}
    </span>
  );
}

/**
 * The most important chip in the module.
 *
 * Shown next to every value this layer produces, never behind a tooltip and
 * never optional. "Provider reported" and "Inferred" look different because
 * they ARE different: one is what a machine said, the other is what Antcolos
 * guessed from what a machine said, and nobody should have to hover to find out
 * which they are looking at before making a dispatch decision on it.
 */
export function QualityChip({
  quality, className,
}: { quality: TelemetryDataQuality; className?: string }) {
  return (
    <span className={cn(CHIP, QUALITY_TONE[quality], className)}>
      {DATA_QUALITY_LABEL[quality]}
    </span>
  );
}

export function IngestionChip({
  state, className,
}: { state: TelemetryIngestionState; className?: string }) {
  return (
    <span className={cn(CHIP, INGESTION_TONE[state], className)}>
      {INGESTION_LABEL[state]}
    </span>
  );
}

export function DiagnosticSeverityChip({
  severity, className,
}: { severity: TelemetryDiagnosticSeverity; className?: string }) {
  return (
    <span className={cn(CHIP, DIAGNOSTIC_TONE[severity], className)}>
      {severity === "critical" ? "Critical" : severity === "warning" ? "Warning" : "Info"}
    </span>
  );
}

/**
 * The banner every screen in this module carries.
 *
 * Not a disclaimer somebody can dismiss, and not a line in a footer. Every
 * provider in this build is simulated, and a dispatcher looking at a position
 * has to be able to tell that at a glance — otherwise the most useful-looking
 * screen in the product is also the most misleading one.
 */
export function MockProviderBanner({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        "rounded-md border border-dashed border-border bg-surface-sunken/60 px-3 py-2 "
        + "text-[0.75rem] leading-relaxed text-fg-muted",
        className,
      )}
    >
      <span className="font-semibold text-fg">Simulated providers only.</span>{" "}
      Every device, connection and signal on this screen comes from a labelled mock adapter.
      Antcolos is not connected to an ELD, a GPS receiver, a vehicle, an FMCSA system or any
      compliance service, and nothing here has been reported to anybody.
    </p>
  );
}
