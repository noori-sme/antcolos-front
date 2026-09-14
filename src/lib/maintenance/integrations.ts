import type {
  MaintenanceAdapters,
  MaintenanceIntegrationKind,
  MaintenanceIntegrationPoint,
} from "@/types";

/**
 * ███ NOTHING HERE IS CONNECTED ███
 *
 * The extension points maintenance will eventually plug into, declared so the
 * milestones that build them have a contract, and so the interface can list
 * them honestly instead of inventing a status.
 *
 * `MAINTENANCE_ADAPTERS` is every member `null`, and that is not a placeholder
 * waiting to be filled in with something plausible — it is the truth. Antcolos
 * reads no ELD, no telematics odometer, no engine-hour feed, no repair shop, no
 * parts catalogue, no tire sensor, no warranty registry and no roadside
 * network. Every meter reading in this build was typed in by a person, and
 * every screen that shows one says who typed it.
 *
 * The type of each member includes `null`, so a caller cannot write
 * `adapters.eld.readMeter(...)` and have it compile. Handling "not connected" is
 * not optional.
 */

export const MAINTENANCE_INTEGRATION_POINTS: readonly MaintenanceIntegrationPoint[] = [
  {
    kind: "eld",
    label: "Electronic logging device",
    description:
      "Would read odometer and engine hours off the truck's ELD, so mileage and "
      + "hour-based service falls due on real numbers instead of typed ones.",
    provides: "A MeterFeedAdapter returning odometer and engine hours per truck.",
    status: "not_connected",
  },
  {
    kind: "odometer_feed",
    label: "Odometer feed",
    description:
      "Would keep odometer readings current without anyone entering them. "
      + "Until then, mileage requirements are only as fresh as the last manual reading.",
    provides: "A MeterFeedAdapter returning odometer miles per truck.",
    status: "not_connected",
  },
  {
    kind: "engine_hours_feed",
    label: "Engine-hour feed",
    description:
      "Would keep hour-meter readings current for power units and reefer units.",
    provides: "A MeterFeedAdapter returning engine hours per truck or reefer trailer.",
    status: "not_connected",
  },
  {
    kind: "shop",
    label: "Repair shop",
    description:
      "Would send a repair order straight to the shop and take status back. "
      + "Today a repair order is a record in Antcolos and nothing leaves the system.",
    provides: "A ShopAdapter that submits a repair order and reports its status.",
    status: "not_connected",
  },
  {
    kind: "parts",
    label: "Parts catalogue",
    description:
      "Would look up part numbers, prices and availability while a repair order "
      + "is being built. Parts inventory and purchasing are a later milestone.",
    provides: "A PartsAdapter that resolves a part number to price and availability.",
    status: "not_connected",
  },
  {
    kind: "tire",
    label: "Tire management",
    description:
      "Would track tread depth and pressure by wheel position. Full tire "
      + "management is a later milestone and is not started.",
    provides: "A TireAdapter returning per-position tread and pressure readings.",
    status: "not_connected",
  },
  {
    kind: "warranty",
    label: "Warranty",
    description:
      "Would say whether a repair is covered before the bill is paid. "
      + "Nothing in Antcolos knows what is under warranty today.",
    provides: "A WarrantyAdapter that answers coverage per component.",
    status: "not_connected",
  },
  {
    kind: "roadside",
    label: "Roadside assistance",
    description:
      "Would raise a roadside ticket from a breakdown report. Reporting a "
      + "defect today notifies nobody outside Antcolos.",
    provides: "A RoadsideAdapter that opens an assistance ticket.",
    status: "not_connected",
  },
] as const;

/**
 * The adapter set the service layer consults. Every member is null.
 *
 * When an adapter is genuinely built, it is assigned here and the service layer
 * starts using it — no other file has to change, because every consumer already
 * had to handle the null case to compile.
 */
export const MAINTENANCE_ADAPTERS: MaintenanceAdapters = {
  eld: null,
  odometer: null,
  engineHours: null,
  shop: null,
  parts: null,
  tire: null,
  warranty: null,
  roadside: null,
};

/** True only when a real adapter has been wired in. Always false in this build. */
export function isIntegrationConnected(kind: MaintenanceIntegrationKind): boolean {
  switch (kind) {
    case "eld": return MAINTENANCE_ADAPTERS.eld !== null;
    case "odometer_feed": return MAINTENANCE_ADAPTERS.odometer !== null;
    case "engine_hours_feed": return MAINTENANCE_ADAPTERS.engineHours !== null;
    case "shop": return MAINTENANCE_ADAPTERS.shop !== null;
    case "parts": return MAINTENANCE_ADAPTERS.parts !== null;
    case "tire": return MAINTENANCE_ADAPTERS.tire !== null;
    case "warranty": return MAINTENANCE_ADAPTERS.warranty !== null;
    case "roadside": return MAINTENANCE_ADAPTERS.roadside !== null;
  }
}
