"use client";

import { AlertTriangle, FileWarning, Hourglass, Receipt, Truck, UserPlus } from "lucide-react";
import { Can } from "@/components/auth/can";
import { tileValue, truckCounts } from "@/lib/home/owner-overview";
import { useCanAny } from "@/lib/session/hooks";
import { useLoadStatusCount, useOpenExceptionsCount, useOverviewTrucks } from "./hooks";
import { StatTile } from "./stat-tile";

const hint = (q: { isError: boolean; isPending: boolean }, text: string) =>
  q.isError ? "Couldn't load this number" : q.isPending ? "Loading…" : text;

/**
 * Owner dashboard, first cut (F1.6): trucks at work, loads that wait on
 * someone, documents still missing, and open problems. Each tile shows only to
 * a membership that may open what it counts.
 */
export function LiveOwnerOverview() {
  const anything = useCanAny(["trucks:view", "loads:view"]);
  if (!anything) return null;
  return (
    <section aria-labelledby="owner-overview" className="space-y-3">
      <h2 id="owner-overview" className="text-[0.9375rem] font-semibold text-fg">
        Today
      </h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Can permission="trucks:view">
          <TrucksTile />
        </Can>
        <Can permission="loads:view">
          <LoadTiles />
        </Can>
      </div>
    </section>
  );
}

function TrucksTile() {
  const trucks = useOverviewTrucks();
  const counts = trucks.data ? truckCounts(trucks.data.data) : undefined;
  return (
    <StatTile
      icon={Truck}
      label="Trucks on a load"
      value={counts ? `${counts.onTrip} of ${counts.total}` : "—"}
      hint={hint(
        trucks,
        counts
          ? `${counts.available} available${counts.maintenance ? ` · ${counts.maintenance} in maintenance` : ""}`
          : "",
      )}
      href="/fleet/trucks"
    />
  );
}

function LoadTiles() {
  const needsDriver = useLoadStatusCount("rc_received");
  const podMissing = useLoadStatusCount("delivered");
  const docsMissing = useLoadStatusCount("pod_received");
  const readyToInvoice = useLoadStatusCount("invoice_ready");
  const problems = useOpenExceptionsCount();
  const warn = (n: number | undefined) => (n ? "warning" : "default");

  return (
    <>
      <StatTile
        icon={UserPlus}
        label="Need a driver"
        value={tileValue(needsDriver.data)}
        tone={warn(needsDriver.data)}
        hint={hint(needsDriver, "Booked, no driver yet")}
        href="/loads"
      />
      <StatTile
        icon={FileWarning}
        label="POD missing"
        value={tileValue(podMissing.data)}
        tone={warn(podMissing.data)}
        hint={hint(podMissing, "Delivered, waiting for the POD")}
        href="/loads"
      />
      <StatTile
        icon={Hourglass}
        label="Documents to invoice"
        value={tileValue(docsMissing.data)}
        tone={warn(docsMissing.data)}
        hint={hint(docsMissing, "POD in; Rate Con not accepted yet")}
        href="/loads"
      />
      <StatTile
        icon={Receipt}
        label="Ready to invoice"
        value={tileValue(readyToInvoice.data)}
        tone={readyToInvoice.data ? "success" : "default"}
        hint={hint(readyToInvoice, "Rate Con and POD on file")}
        href="/loads"
      />
      <StatTile
        icon={AlertTriangle}
        label="Open problems"
        value={tileValue(problems.data)}
        tone={problems.data ? "danger" : "default"}
        hint={hint(problems, "Reported on loads, not resolved")}
      />
    </>
  );
}
