"use client";

import { Truck } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { FleetProfile } from "@/types";
import { useSetFleetSize } from "./hooks";

/**
 * ★ THE ENTIRE SETUP FLOW ★
 *
 * One number, one field, skippable, inline on a working screen.
 *
 * The milestone's rule is specific enough to build to: "Do not present a large
 * responsibility or escalation setup wizard during onboarding. Ask only for the
 * number of Trucks when fleet-size differences matter, then automatically apply
 * sensible defaults." So:
 *
 *  • It is not a wizard, not a step, not a modal, and not a blocker. The queues
 *    are already working behind it, routed under defaults, before anybody types
 *    anything.
 *  • It only appears when the answer is not already known. A workspace with
 *    trucks in the registry has answered by registering them, and asking again
 *    would be the friction this rule exists to prevent — see
 *    `FleetProfile.sizeConfirmed`.
 *  • "Skip" is a real answer. The defaults for a workspace of one are correct
 *    for most new Carriers, and the question can be answered later in settings
 *    or never.
 *
 * Nothing about escalation, SLA, accountability or hierarchy is asked. Those
 * are derived from this number and from who joins, and a Carrier who never
 * opens settings never learns the words.
 */
export function FleetSizeQuestion({ profile }: { profile: FleetProfile }) {
  const setSize = useSetFleetSize();
  const [value, setValue] = useState("");
  const [dismissed, setDismissed] = useState(false);

  if (profile.sizeConfirmed || dismissed) return null;

  const parsed = Number.parseInt(value, 10);
  const valid = Number.isFinite(parsed) && parsed >= 0;

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-start gap-3">
        <Truck aria-hidden className="mt-0.5 size-5 shrink-0 text-fg-subtle" />
        <div className="min-w-0">
          <h2 className="text-[0.9375rem] font-semibold text-fg">
            How many trucks do you run?
          </h2>
          <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
            One number, and it is the only thing Antcolos needs to know about
            your shape. Team queues, oversight and escalation levels follow from
            it, and from who joins later. Your work is already being routed —
            this only makes it fit better.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Trucks" htmlFor="fleet-size-question" className="w-32">
          <Input
            id="fleet-size-question"
            inputMode="numeric"
            placeholder="1"
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
        <Button variant="ghost" onClick={() => setDismissed(true)}>
          Skip — the defaults are fine
        </Button>
      </div>

      {setSize.isError ? (
        <p role="alert" className="text-[0.8125rem] text-st-danger">
          {setSize.error.message}
        </p>
      ) : null}
    </Card>
  );
}
