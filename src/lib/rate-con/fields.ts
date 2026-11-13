/**
 * Rate Con field rules for the review screen (plan 13). Pure. The correction
 * formats mirror the backend's `validateCorrection`
 * (../antcolos/src/modules/loads/services/review-rules.ts, contract §7), so
 * the screen never sends a value the API would reject.
 */

const TOP: Record<string, string> = {
  brokerName: "Broker name",
  brokerMcNumber: "Broker MC",
  brokerDotNumber: "Broker DOT",
  brokerPhone: "Broker phone",
  brokerEmail: "Broker email",
  carrierName: "Carrier name",
  carrierMcNumber: "Carrier MC",
  carrierDotNumber: "Carrier DOT",
  loadNumber: "Load number",
  confirmationNumber: "Confirmation number",
  poNumber: "PO number",
  proNumber: "PRO number",
  equipmentType: "Equipment",
  commodity: "Commodity",
  weightLbs: "Weight (lbs)",
  pieces: "Pieces",
  linearFeet: "Linear feet",
  totalMiles: "Total miles",
  currency: "Currency",
  linehaulRate: "Linehaul rate",
  fuelSurcharge: "Fuel surcharge",
  totalRate: "Total rate",
  specialInstructions: "Special instructions",
};

const LEAF: Record<string, string> = {
  facilityName: "Facility",
  date: "Date",
  windowStart: "Window start",
  windowEnd: "Window end",
  contactName: "Contact",
  contactPhone: "Contact phone",
  notes: "Notes",
  kind: "Kind",
  name: "Name",
  amount: "Amount",
  "address.name": "Place name",
  "address.line1": "Street",
  "address.line2": "Street line 2",
  "address.city": "City",
  "address.state": "State",
  "address.postalCode": "ZIP",
  "address.country": "Country",
  "address.raw": "Address as written",
};

const LISTS: Record<string, string> = {
  pickups: "Pickup",
  deliveries: "Delivery",
  additionalStops: "Extra stop",
  accessorials: "Accessorial",
};

/** "Pickup 1 · City" for `pickups.0.address.city`; the path when unknown. */
export function fieldLabel(path: string): string {
  if (TOP[path]) return TOP[path];
  const ref = /^referenceNumbers\.(\d+)$/.exec(path);
  if (ref) return `Reference number ${Number(ref[1]) + 1}`;
  const list = /^(\w+)\.(\d+)\.(.+)$/.exec(path);
  if (list && LISTS[list[1]] && LEAF[list[3]]) {
    return `${LISTS[list[1]]} ${Number(list[2]) + 1} · ${LEAF[list[3]]}`;
  }
  const broker = /^brokerAddress\.(\w+)$/.exec(path);
  if (broker && LEAF[`address.${broker[1]}`]) {
    return `Broker address · ${LEAF[`address.${broker[1]}`]}`;
  }
  return path;
}

const DRAFT: Record<string, string> = {
  brokerName: "Broker name",
  brokerMcNumber: "Broker MC",
  brokerLoadNumber: "Load number",
  equipmentType: "Equipment",
  weightLbs: "Weight",
  rateTotal: "Rate",
  "stops.pickup": "A pickup stop",
  "stops.delivery": "A delivery stop",
};
const DRAFT_STOP: Record<string, string> = {
  city: "City",
  state: "State",
  timezone: "Time zone (from the state)",
  scheduledDate: "Date",
};

/** Names a load draft value from the load preview's `missing` list. */
export function stopLabel(field: string): string {
  if (DRAFT[field]) return DRAFT[field];
  const stop = /^stops\[(\d+)\]\.(\w+)$/.exec(field);
  if (stop) return `Stop ${Number(stop[1]) + 1} · ${DRAFT_STOP[stop[2]] ?? stop[2]}`;
  return field;
}

export type InputKind = "money" | "date" | "time" | "currency" | "mc" | "text";

const STOP = "(pickups|deliveries|additionalStops)\\.\\d+";
const MONEY = /^(totalRate|linehaulRate|fuelSurcharge|accessorials\.\d+\.amount)$/;
const DATE = new RegExp(`^${STOP}\\.date$`);
const TIME = new RegExp(`^${STOP}\\.(windowStart|windowEnd)$`);

export function inputKindFor(path: string): InputKind {
  if (MONEY.test(path)) return "money";
  if (DATE.test(path)) return "date";
  if (TIME.test(path)) return "time";
  if (path === "currency") return "currency";
  if (path === "brokerMcNumber") return "mc";
  return "text";
}

export type CorrectionCheck = { ok: true; value: string | null } | { ok: false; message: string };

const MAX_TEXT = 500;

export function checkCorrection(path: string, raw: string): CorrectionCheck {
  const text = raw.trim();
  if (!text) return { ok: true, value: null };
  if (text.length > MAX_TEXT) {
    return { ok: false, message: `Use at most ${MAX_TEXT} characters.` };
  }
  switch (inputKindFor(path)) {
    case "money":
      return /^\d+(\.\d{1,2})?$/.test(text)
        ? { ok: true, value: twoDecimals(text) }
        : { ok: false, message: "Enter an amount like 2500.00 (digits only)." };
    case "date":
      return isCalendarDate(text)
        ? { ok: true, value: text }
        : { ok: false, message: "Enter a date as YYYY-MM-DD." };
    case "time":
      return /^([01]\d|2[0-3]):[0-5]\d$/.test(text)
        ? { ok: true, value: text }
        : { ok: false, message: "Enter a 24-hour time like 08:00." };
    case "currency": {
      const code = text.toUpperCase();
      return /^[A-Z]{3}$/.test(code)
        ? { ok: true, value: code }
        : { ok: false, message: "Enter a 3-letter currency code like USD." };
    }
    case "mc":
      return /^\d{1,8}$/.test(text)
        ? { ok: true, value: text }
        : { ok: false, message: "Enter the MC number as digits only." };
    default:
      return { ok: true, value: text };
  }
}

/** `2500` → `2500.00`, `75.5` → `75.50`, keeping the string (no float rounding). */
function twoDecimals(text: string): string {
  const [whole, fraction = ""] = text.split(".");
  return `${whole}.${fraction.padEnd(2, "0")}`;
}

function isCalendarDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}
