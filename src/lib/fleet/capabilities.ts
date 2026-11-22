import type { FleetTruck } from "@/types/fleet-truck";

/** How a nullable capability flag reads: unknown is not "No". */
export function flagLabel(value: boolean | null | undefined): string | undefined {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return undefined;
}

/** Edit-form value for a flag: "" (not recorded), "yes", "no". */
export function flagFormValue(value: boolean | null | undefined): "" | "yes" | "no" {
  return value === true ? "yes" : value === false ? "no" : "";
}

/** "102 × 110 in" (interior width × height), or what is known. */
export function interiorLabel(truck: Pick<FleetTruck, "trailerWidthIn" | "trailerHeightIn">): string | undefined {
  const { trailerWidthIn: w, trailerHeightIn: h } = truck;
  if (w && h) return `${w} × ${h} in`;
  if (w) return `${w} in wide`;
  if (h) return `${h} in high`;
  return undefined;
}

/** "−10 °F to 70 °F", or one end. Only meaningful on a REEFER truck. */
export function reeferRangeLabel(truck: Pick<FleetTruck, "reeferMinTempF" | "reeferMaxTempF">): string | undefined {
  const { reeferMinTempF: min, reeferMaxTempF: max } = truck;
  const f = (t: number) => `${t < 0 ? "−" : ""}${Math.abs(t)} °F`;
  if (min !== undefined && max !== undefined) return `${f(min)} to ${f(max)}`;
  if (min !== undefined) return `from ${f(min)}`;
  if (max !== undefined) return `up to ${f(max)}`;
  return undefined;
}

/** Form-level checks mirroring the backend (plan 46): bounds and min ≤ max. */
export const CAPABILITY_BOUNDS = {
  trailerWidthIn: [1, 200],
  trailerHeightIn: [1, 200],
  strapCount: [0, 200],
  reeferMinTempF: [-40, 100],
  reeferMaxTempF: [-40, 100],
} as const;

export function capabilityError(field: keyof typeof CAPABILITY_BOUNDS, raw: string): string | undefined {
  if (raw.trim() === "") return undefined;
  if (!/^-?\d+$/.test(raw.trim())) return "Enter a whole number.";
  const [lo, hi] = CAPABILITY_BOUNDS[field];
  const n = Number(raw);
  return n < lo || n > hi ? `Between ${lo} and ${hi}.` : undefined;
}

/** The capability rows a truck profile shows, in order (unknown values read as not available). */
export function capabilityRows(truck: FleetTruck): { label: string; value: string | undefined }[] {
  const rows = [
    { label: "Interior (W × H)", value: interiorLabel(truck) },
    { label: "Liftgate", value: flagLabel(truck.hasLiftgate) },
    { label: "Pallet Jack", value: flagLabel(truck.hasPalletJack) },
    { label: "Load Straps", value: truck.strapCount !== undefined ? String(truck.strapCount) : undefined },
  ];
  if (truck.equipmentType === "REEFER") {
    rows.push({ label: "Reefer Range", value: reeferRangeLabel(truck) });
  }
  return rows;
}
