import { propagationBus } from "@/lib/propagation";
import {
  accountingProjection, directoryProjection, documentsProjection,
  driverWorkflowProjection, invoicePreparationProjection, mtLoopProjection,
  reportsProjection, trackingProjection,
} from "./load-finalized";
import {
  fuelAccountingProjection, fuelCostProjection, fuelEconomyProjection,
  fuelReportsProjection, iftaProjection, maintenanceMeterProjection,
} from "./fuel-confirmed";

/**
 * ★ WHO LISTENS TO WHAT ★
 *
 * The one place a projection is wired to an event. Registration order is run
 * order, so the same event replays identically every time — which matters more
 * than concurrency for a set of projections that write to shared stores.
 *
 * Registering is a side effect of importing this module, and it is imported by
 * the two modules that publish (`load-commands.ts` and `fuel-propagation.ts`).
 * That is deliberate: a publisher that could run without its subscribers
 * registered would drop events silently, which is the one failure mode a bus
 * must not have.
 *
 * Adding a destination means adding a subscriber here. It never means changing a
 * payload, and it never means touching the module that publishes.
 */

let registered = false;

export function registerProjections(): void {
  if (registered) return;
  registered = true;

  /* -- load.finalized ---------------------------------------------------- */
  // Ordered as a dispatcher would care: the driver first, then the money, then
  // the records that need a person, then what is merely informed.
  propagationBus.subscribe(driverWorkflowProjection as never);
  propagationBus.subscribe(accountingProjection as never);
  propagationBus.subscribe(invoicePreparationProjection as never);
  propagationBus.subscribe(directoryProjection as never);
  propagationBus.subscribe(mtLoopProjection as never);
  propagationBus.subscribe(trackingProjection as never);
  propagationBus.subscribe(documentsProjection as never);
  propagationBus.subscribe(reportsProjection as never);

  /* -- fuel_transaction.confirmed ---------------------------------------- */
  propagationBus.subscribe(fuelCostProjection as never);
  propagationBus.subscribe(fuelEconomyProjection as never);
  propagationBus.subscribe(iftaProjection as never);
  propagationBus.subscribe(fuelAccountingProjection as never);
  propagationBus.subscribe(fuelReportsProjection as never);

  /* -- equipment_meter.reading_recorded ---------------------------------- */
  propagationBus.subscribe(maintenanceMeterProjection as never);
}

// Registered on import. See the note above: a publisher with no subscribers is
// a silent data-loss bug, so this is not left to a caller to remember.
registerProjections();
