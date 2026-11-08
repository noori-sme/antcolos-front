import type { UpdateTruckInput } from "@/types/fleet-truck";

/** Edit-form values as strings; "" means empty. */
export type TruckFormValues = Record<string, string>;

const UPPERCASE = new Set(["homeTerminalState", "licensePlateState"]);
const REQUIRED = new Set(["unitNumber"]);
const NUMERIC = new Set(["year"]);

/**
 * PATCH body for `PATCH /trucks/:id` (fleet contract §4) from the edit form:
 * only fields whose value changed (omitted = unchanged); a cleared optional
 * field becomes `null`; state codes are uppercased; the year is a number.
 * Required fields (`unitNumber`) are never sent as null; the form refuses
 * an empty one before this runs.
 */
export function buildTruckPatch(
  before: TruckFormValues,
  after: TruckFormValues,
  fields: readonly string[],
): UpdateTruckInput {
  const patch: Record<string, unknown> = {};
  for (const field of fields) {
    const value = after[field] ?? "";
    if ((before[field] ?? "") === value) continue;
    if (REQUIRED.has(field)) patch[field] = value;
    else if (value === "") patch[field] = null;
    else if (NUMERIC.has(field)) patch[field] = Number(value);
    else if (UPPERCASE.has(field)) patch[field] = value.toUpperCase();
    else patch[field] = value;
  }
  return patch as UpdateTruckInput;
}
