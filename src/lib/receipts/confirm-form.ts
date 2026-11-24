import { z } from "zod";
import type { ConfirmReceiptInput, PredictedField, Receipt } from "@/types/receipt";
import { isMoney, isQuantity, isUnitPrice } from "./receipt-rules";

/**
 * The confirm form (F2.1). Values are strings as typed; the schema mirrors the
 * contract (POST /receipts/:id/confirm) so the client never sends what the API
 * refuses. Only changed fields are sent: each one the backend receives is
 * recorded as a correction beside what the model read.
 */

const optional = (check: (v: string) => boolean, message: string) =>
  z.string().trim().refine((v) => v === "" || check(v), message);

const today = () => new Date().toISOString().slice(0, 10);

export const confirmFormSchema = z.object({
  purchasedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date on the receipt")
    .refine((v) => v <= today(), "The date can't be in the future"),
  totalAmount: z.string().trim().refine(isMoney, "Enter the total, like 412.50"),
  gallons: optional(isQuantity, "Up to 3 decimals, like 100.125"),
  unitPrice: optional(isUnitPrice, "Up to 4 decimals, like 4.125"),
  partsAmount: optional(isMoney, "An amount, like 220.00"),
  laborAmount: optional(isMoney, "An amount, like 180.00"),
  vendor: z.string().trim().max(200, "200 characters at most"),
  city: z.string().trim().max(100, "100 characters at most"),
  state: z.string().trim().max(50, "50 characters at most"),
  odometerMiles: optional((v) => /^\d{1,7}$/.test(v), "Whole miles"),
});

export type ConfirmFormValues = z.infer<typeof confirmFormSchema>;

const FORM_PATHS: Record<keyof ConfirmFormValues, string[]> = {
  purchasedOn: ["purchasedAt", "purchaseDate"],
  totalAmount: ["totalAmount"],
  gallons: ["quantity"],
  unitPrice: ["unitPrice"],
  partsAmount: ["partsAmount"],
  laborAmount: ["laborAmount"],
  vendor: ["merchantName"],
  city: ["merchantAddress.city"],
  state: ["merchantAddress.state"],
  odometerMiles: ["odometer"],
};

const asText = (v: PredictedField["value"] | undefined): string =>
  v === null || v === undefined ? "" : String(v);

/** What the form starts with: the receipt's own values, else what was read. */
export function toFormValues(receipt: Receipt, fields: PredictedField[]): ConfirmFormValues {
  const read = (key: keyof ConfirmFormValues): string => {
    for (const path of FORM_PATHS[key]) {
      const field = fields.find((f) => f.path === path);
      if (field && field.value !== null) return asText(field.value);
    }
    return "";
  };
  const own = (value: string | number | null, key: keyof ConfirmFormValues) =>
    value === null ? read(key) : String(value);
  const date = receipt.purchasedAt ?? read("purchasedOn");
  return {
    purchasedOn: date ? date.slice(0, 10) : "",
    totalAmount: own(receipt.totalAmount, "totalAmount"),
    gallons: own(receipt.gallons, "gallons"),
    unitPrice: own(receipt.unitPrice, "unitPrice"),
    partsAmount: own(receipt.partsAmount, "partsAmount"),
    laborAmount: own(receipt.laborAmount, "laborAmount"),
    vendor: own(receipt.vendor, "vendor"),
    city: own(receipt.city, "city"),
    state: own(receipt.state, "state"),
    odometerMiles: own(receipt.odometerMiles, "odometerMiles"),
  };
}

/**
 * Only what the person changed. A cleared optional field is `null`; the
 * date is sent as noon UTC on that day, as the backend reads printed dates.
 */
export function toConfirmInput(values: ConfirmFormValues, initial: ConfirmFormValues): ConfirmReceiptInput {
  const input: ConfirmReceiptInput = {};
  const changed = (key: keyof ConfirmFormValues) => values[key].trim() !== initial[key].trim();
  const orNull = (v: string) => (v.trim() === "" ? null : v.trim());
  if (changed("purchasedOn")) input.purchasedAt = `${values.purchasedOn}T12:00:00.000Z`;
  if (changed("totalAmount")) input.totalAmount = values.totalAmount.trim();
  if (changed("gallons")) input.gallons = orNull(values.gallons);
  if (changed("unitPrice")) input.unitPrice = orNull(values.unitPrice);
  if (changed("partsAmount")) input.partsAmount = orNull(values.partsAmount);
  if (changed("laborAmount")) input.laborAmount = orNull(values.laborAmount);
  if (changed("vendor")) input.vendor = orNull(values.vendor);
  if (changed("city")) input.city = orNull(values.city);
  if (changed("state")) input.state = orNull(values.state);
  if (changed("odometerMiles")) {
    const miles = orNull(values.odometerMiles);
    input.odometerMiles = miles === null ? null : Number.parseInt(miles, 10);
  }
  return input;
}
