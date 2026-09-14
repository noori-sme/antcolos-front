import type {
  FuelStopLocation, FuelType, IftaJurisdictionSummary, IftaPeriod, IsoDateTime,
  Jurisdiction,
} from "@/types";

/**
 * ███ EXTENSION POINTS — NOTHING HERE IS CONNECTED ███
 *
 * Every integration a fuel and IFTA product eventually needs, declared as a
 * typed interface with no implementation behind it.
 *
 * The reason they exist now, before any of them is real: the shape of what an
 * adapter returns decides the shape of the record it writes. Deciding that
 * later means either rewriting the ledger or bending the adapter, and the
 * ledger is the thing that must not move. Writing the contracts first also
 * makes the honesty enforceable — every descriptor below reports
 * `status: "not_connected"`, and there is no code path that can report
 * anything else, so no screen can imply a connection that does not exist.
 *
 * When a real adapter lands it implements one of these interfaces and
 * registers a descriptor. Nothing else in the module changes.
 */

export type IntegrationKind =
  | "fuel_card"
  | "eld"
  | "gps"
  | "telematics"
  | "receipt_ocr"
  | "toll"
  | "accounting"
  | "ifta_provider";

/**
 * The only status this build can produce. Written as a union with one member
 * rather than a boolean so adding "connected" later is a deliberate, reviewed
 * change to this file rather than a flag somebody flips.
 */
export type IntegrationStatus = "not_connected";

export interface IntegrationDescriptor {
  id: string;
  kind: IntegrationKind;
  label: string;
  /** What it would do, in the words an owner would use. Not a promise. */
  description: string;
  status: IntegrationStatus;
  /** What the adapter would be able to supply once somebody builds it. */
  capabilities: readonly string[];
  /** What Antcolos would write into the ledger from it. */
  writes: readonly ("fuel_transaction" | "mileage_record" | "document" | "nothing")[];
}

/* -------------------------------------------------------------------------- */
/* Import envelopes                                                            */
/* -------------------------------------------------------------------------- */

/**
 * What every adapter hands back. The batch is the unit of provenance: a row
 * can always be traced to the pull that produced it, which is what makes a
 * re-import detectable instead of duplicating the quarter.
 */
export interface ImportBatch<T> {
  batchId: string;
  adapterId: string;
  pulledAt: IsoDateTime;
  /** The window the adapter was asked for. */
  from: IsoDateTime;
  to: IsoDateTime;
  rows: T[];
  /** Rows the adapter could not parse. Never silently dropped. */
  rejected: { externalId: string; reason: string }[];
}

/**
 * A fuel purchase as an outside system knows it.
 *
 * Note what is absent: no carrier, no attribution, no state. An adapter
 * reports what happened at a pump; deciding whose it was and whether it is
 * accepted belongs to Antcolos and happens in the service layer.
 */
export interface ExternalFuelPurchase {
  externalId: string;
  /** Whatever the outside system calls the vehicle. Matched to a truckId here. */
  vehicleReference: string;
  /** Card, driver number or badge, when the feed carries one. */
  driverReference?: string;
  purchasedAt: IsoDateTime;
  location: FuelStopLocation;
  fuelType: FuelType;
  gallonsThousandths: number;
  pricePerGallonMills: number;
  totalCostCents: number;
  odometerMiles?: number;
  /** Some feeds carry a scan of the receipt. Handed to the Documents system. */
  receiptUrl?: string;
}

/** A stretch of travel inside one jurisdiction, as an ELD or GPS reports it. */
export interface ExternalMileageSegment {
  externalId: string;
  vehicleReference: string;
  driverReference?: string;
  jurisdiction: Jurisdiction;
  startedAt: IsoDateTime;
  endedAt: IsoDateTime;
  totalMiles: number;
  /** Absent when the source cannot distinguish taxable from total. */
  taxableMiles?: number;
  odometerStartMiles?: number;
  odometerEndMiles?: number;
}

/* -------------------------------------------------------------------------- */
/* Adapter interfaces                                                          */
/* -------------------------------------------------------------------------- */

/** A fuel-card processor. Would supply purchases, and nothing else. */
export interface FuelCardAdapter {
  readonly descriptor: IntegrationDescriptor;
  pullPurchases(from: IsoDateTime, to: IsoDateTime): Promise<ImportBatch<ExternalFuelPurchase>>;
}

/**
 * An electronic logging device. Would supply jurisdiction mileage — and only
 * mileage. An ELD does not know what fuel cost, and a design that lets one
 * write a purchase is how the two record types get merged by accident.
 */
export interface EldAdapter {
  readonly descriptor: IntegrationDescriptor;
  pullMileage(from: IsoDateTime, to: IsoDateTime): Promise<ImportBatch<ExternalMileageSegment>>;
}

/** Raw position history, from which jurisdiction segments would be derived. */
export interface GpsAdapter {
  readonly descriptor: IntegrationDescriptor;
  pullSegments(from: IsoDateTime, to: IsoDateTime): Promise<ImportBatch<ExternalMileageSegment>>;
}

/** A telematics platform: odometer, engine hours, and mileage segments. */
export interface TelematicsAdapter {
  readonly descriptor: IntegrationDescriptor;
  pullMileage(from: IsoDateTime, to: IsoDateTime): Promise<ImportBatch<ExternalMileageSegment>>;
  readOdometer(vehicleReference: string, at: IsoDateTime): Promise<number | null>;
}

/**
 * Receipt reading. Would return FIELDS and a confidence, never a decision:
 * extraction is not verification, and the existing Document type already draws
 * that line for every other kind of paperwork.
 */
export interface ReceiptOcrAdapter {
  readonly descriptor: IntegrationDescriptor;
  extract(documentId: string): Promise<{
    documentId: string;
    /** 0–1, as on Document.ocr. */
    confidence: number;
    fields: Partial<
      Pick<
        ExternalFuelPurchase,
        "purchasedAt" | "fuelType" | "gallonsThousandths" | "pricePerGallonMills" | "totalCostCents" | "odometerMiles"
      >
    > & { merchantName?: string; jurisdiction?: Jurisdiction };
  }>;
}

/**
 * Tolls. Not fuel, and not on a return — but toll miles are frequently the
 * difference between total and taxable miles in a jurisdiction, which is why
 * the seam is here rather than in an expenses module.
 */
export interface TollAdapter {
  readonly descriptor: IntegrationDescriptor;
  pullTollMiles(from: IsoDateTime, to: IsoDateTime): Promise<
    ImportBatch<{
      externalId: string;
      vehicleReference: string;
      jurisdiction: Jurisdiction;
      occurredAt: IsoDateTime;
      miles: number;
      costCents: number;
    }>
  >;
}

/** Accounting. Reads fuel out of Antcolos; never writes a fuel record in. */
export interface AccountingAdapter {
  readonly descriptor: IntegrationDescriptor;
  pushFuelExpenses(
    from: IsoDateTime,
    to: IsoDateTime,
  ): Promise<{ exported: number; reference: string }>;
}

/**
 * An IFTA filing provider.
 *
 * The one adapter that would ever submit anything, and the one with the
 * loudest warning: Antcolos does not file, does not pay, and does not hold a
 * jurisdiction rate table. `fetchRates` exists so the net-gallons figure can
 * one day become money — and until something implements it, every summary
 * reports `taxRatesAvailable: false`.
 */
export interface IftaProviderAdapter {
  readonly descriptor: IntegrationDescriptor;
  fetchRates(year: number, quarter: number): Promise<Record<Jurisdiction, number>>;
  submit(
    period: IftaPeriod,
    lines: readonly IftaJurisdictionSummary[],
  ): Promise<{ confirmationReference: string; submittedAt: IsoDateTime }>;
}

/* -------------------------------------------------------------------------- */
/* The registry                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Everything the fuel module is designed to accept, and the honest status of
 * each. The Integrations screen renders this list; it cannot render anything
 * else, so it cannot claim a connection.
 */
export const FUEL_INTEGRATIONS: readonly IntegrationDescriptor[] = [
  {
    id: "fuel_card",
    kind: "fuel_card",
    label: "Fuel card",
    description: "Pulls fuel purchases straight from the card processor, so nobody types a receipt in twice.",
    status: "not_connected",
    capabilities: ["Purchases", "Gallons and price", "Merchant and jurisdiction", "Card odometer prompt"],
    writes: ["fuel_transaction"],
  },
  {
    id: "eld",
    kind: "eld",
    label: "ELD",
    description: "Supplies the miles each truck ran in each state or province. Mileage only — an ELD knows nothing about what fuel cost.",
    status: "not_connected",
    capabilities: ["Jurisdiction mileage", "Odometer readings", "Driver on the truck"],
    writes: ["mileage_record"],
  },
  {
    id: "gps",
    kind: "gps",
    label: "GPS tracking",
    description: "Turns position history into jurisdiction segments where no ELD is fitted.",
    status: "not_connected",
    capabilities: ["Position history", "Derived jurisdiction crossings"],
    writes: ["mileage_record"],
  },
  {
    id: "telematics",
    kind: "telematics",
    label: "Telematics",
    description: "Engine and odometer data, used to check mileage against what the truck itself reported.",
    status: "not_connected",
    capabilities: ["Odometer", "Engine hours", "Jurisdiction mileage"],
    writes: ["mileage_record"],
  },
  {
    id: "receipt_ocr",
    kind: "receipt_ocr",
    label: "Receipt reading",
    description: "Reads gallons, price and odometer off a photographed receipt. Reading is not approving — a person still accepts it.",
    status: "not_connected",
    capabilities: ["Field extraction", "Confidence score"],
    writes: ["fuel_transaction", "document"],
  },
  {
    id: "toll",
    kind: "toll",
    label: "Tolls",
    description: "Toll transactions and the toll miles that separate taxable miles from total miles in some jurisdictions.",
    status: "not_connected",
    capabilities: ["Toll transactions", "Toll miles by jurisdiction"],
    writes: ["mileage_record"],
  },
  {
    id: "accounting",
    kind: "accounting",
    label: "Accounting",
    description: "Sends fuel spend out to the books. Reads from Antcolos; never writes a fuel record back in.",
    status: "not_connected",
    capabilities: ["Fuel expense export"],
    writes: ["nothing"],
  },
  {
    id: "ifta_provider",
    kind: "ifta_provider",
    label: "IFTA filing provider",
    description: "Would supply the quarterly jurisdiction tax rates and submit the return. Until one is connected Antcolos calculates net gallons and stops there — it does not file and it does not pay.",
    status: "not_connected",
    capabilities: ["Quarterly tax rates", "Return submission"],
    writes: ["nothing"],
  },
] as const;

export function integrationsOfKind(kind: IntegrationKind): IntegrationDescriptor[] {
  return FUEL_INTEGRATIONS.filter((i) => i.kind === kind);
}

/**
 * Whether jurisdiction tax rates can be loaded. Always false: no provider is
 * connected. Every summary reads this rather than assuming.
 */
export function taxRatesAvailable(): boolean {
  return FUEL_INTEGRATIONS.some(
    (i) => i.kind === "ifta_provider" && i.status !== "not_connected",
  );
}
