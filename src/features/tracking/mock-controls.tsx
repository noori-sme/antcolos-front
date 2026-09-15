"use client";

import { FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The mock adapter's controls, labelled as exactly that.
 *
 * These exist so a reviewer can put the interesting situations in front of the
 * engine without editing fixtures: a fresh position, a pass-by at highway
 * speed through the receiver's geofence, a duplicate of the last reading, and
 * a feed that goes silent.
 *
 * They are on the page rather than in a test file because the behaviour worth
 * checking is what the SCREEN does with each of them, and they are fenced off
 * visually because nothing here is an operational action.
 */
export function MockControls({
  busy, disabled, disabledReason, muted, onSimulate,
}: {
  busy?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  muted: boolean;
  onSimulate: (
    what: "near_receiver" | "pass_by" | "duplicate" | "stale" | "toggle_outage",
  ) => void;
}) {
  return (
    <section
      aria-labelledby="mock-heading"
      className="rounded-lg border border-dashed border-st-warning/50 bg-st-warning-bg/30 p-4"
    >
      <h2
        id="mock-heading"
        className="flex items-center gap-2 text-[0.875rem] font-semibold text-fg"
      >
        <FlaskConical className="size-4 text-st-warning" aria-hidden />
        Mock adapter controls
      </h2>
      <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
        Not an operational feature. These hand the mock location adapter a position as if a device
        had produced one, so the availability engine, the freshness states and the geofence guard
        can be exercised on screen. Everything they produce is stamped as a mock.
      </p>

      {disabled ? (
        <p className="mt-2 text-[0.75rem] text-fg-muted">{disabledReason}</p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => onSimulate("near_receiver")}>
            Report a position at the receiver
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => onSimulate("pass_by")}>
            Pass the receiver at 62 mph
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => onSimulate("duplicate")}>
            Send the last position again
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => onSimulate("stale")}>
            Report a position from six hours ago
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => onSimulate("toggle_outage")}>
            {muted ? "Bring the feed back" : "Silence the feed"}
          </Button>
        </div>
      )}
    </section>
  );
}
