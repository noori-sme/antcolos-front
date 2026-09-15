import type {
  AuditFieldChange, AuditRedactionReason, AuditValue,
} from "@/types";

/**
 * ★ REDACTION IS ENFORCED AT THE SERVICE BOUNDARY ★
 *
 * Not in the screen, not in the caller, not by convention. `sanitizeChanges`
 * runs inside the audit service on the way in, so a module that hands over a
 * password field gets an entry saying the field changed and no value — and
 * there is no code path that writes the value instead.
 *
 * What never enters an audit payload, in any form:
 *   passwords, password hashes, tokens, API keys, secrets, session ids,
 *   full bank account and routing numbers, card numbers, full government
 *   identifiers, document contents, file bytes, and free personal data that
 *   the event does not need in order to be meaningful.
 *
 * Redaction removes the VALUES and keeps the FACT. "Payout account changed" is
 * the audit-worthy part; the account number is not, and storing a hash or the
 * last four digits would still be storing part of it.
 */

/** Substrings that make a field name sensitive, matched case-insensitively. */
const SENSITIVE_FRAGMENTS: readonly string[] = [
  "password", "passphrase", "secret", "token", "apikey", "api_key",
  "accesskey", "access_key", "privatekey", "private_key", "credential",
  "authorization", "sessionid", "session_id", "cookie", "otp", "mfa",
  "pin", "cvv", "cvc",
  // Money routing. The fact that it changed is the audit record; the number
  // itself is never part of it.
  "accountnumber", "account_number", "routing", "iban", "swift", "bic",
  "cardnumber", "card_number", "pan",
  // Government and personal identifiers.
  "ssn", "socialsecurity", "social_security", "taxid", "tax_id", "ein",
  "passport", "dateofbirth", "date_of_birth", "dob",
  // Document payloads. A document's CONTENT never belongs in an audit trail;
  // the document reference does.
  "filecontent", "file_content", "filebytes", "content", "body", "base64",
  "rawtext", "raw_text", "extractedtext", "extracted_text", "ocrtext",
];

/**
 * Values longer than this are dropped rather than truncated. A truncated
 * document body is still a document body.
 */
export const MAX_AUDIT_VALUE_LENGTH = 240;

export function isSensitiveField(field: string): boolean {
  const normalized = field.toLowerCase().replace(/[^a-z0-9]/g, "");
  return SENSITIVE_FRAGMENTS.some((fragment) =>
    normalized.includes(fragment.replace(/[^a-z0-9]/g, "")),
  );
}

/**
 * Whether a value may be carried at all.
 *
 * Audit payloads hold scalars. Objects and arrays are refused outright rather
 * than serialized, because the one thing a nested object reliably smuggles past
 * a field-name check is the field it was nested under.
 */
export function classifyValue(
  value: unknown,
): { ok: true; value: AuditValue } | { ok: false; reason: AuditRedactionReason } {
  if (value === null || value === undefined) return { ok: true, value: null };
  if (typeof value === "number") {
    return Number.isFinite(value)
      ? { ok: true, value }
      : { ok: false, reason: "unsupported_type" };
  }
  if (typeof value === "boolean") return { ok: true, value };
  if (typeof value === "string") {
    return value.length > MAX_AUDIT_VALUE_LENGTH
      ? { ok: false, reason: "too_long" }
      : { ok: true, value };
  }
  return { ok: false, reason: "unsupported_type" };
}

export interface RawFieldChange {
  field: string;
  label?: string;
  before?: unknown;
  after?: unknown;
}

/** Turns a path into something an owner can read: `payoutAccount.last4`. */
export function humanizeField(field: string): string {
  const last = field.split(".").pop() ?? field;
  const spaced = last
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    // Sentence case, not title case: these are read in a sentence — "Account
    // number was withheld" — rather than as column headings.
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * The boundary. Every change summary the ledger stores has been through here.
 *
 * A change whose field name is sensitive keeps its name and loses both values.
 * A change whose value is a structure or a wall of text loses the values for a
 * different reason, and the reason is recorded so the screen can say which.
 */
export function sanitizeChanges(
  raw: readonly RawFieldChange[],
): { changes: AuditFieldChange[]; redactedCount: number } {
  const changes: AuditFieldChange[] = [];
  let redactedCount = 0;

  for (const entry of raw) {
    const label = entry.label ?? humanizeField(entry.field);

    if (isSensitiveField(entry.field)) {
      redactedCount += 1;
      changes.push({
        field: entry.field, label, redacted: true, redactionReason: "sensitive_field",
      });
      continue;
    }

    const before = classifyValue(entry.before);
    const after = classifyValue(entry.after);

    if (!before.ok || !after.ok) {
      redactedCount += 1;
      changes.push({
        field: entry.field,
        label,
        redacted: true,
        redactionReason: before.ok ? after.ok ? "unsupported_type" : after.reason : before.reason,
      });
      continue;
    }

    changes.push({
      field: entry.field,
      label,
      before: before.value,
      after: after.value,
      redacted: false,
    });
  }

  return { changes, redactedCount };
}

/**
 * A before/after summary built from two flat records.
 *
 * Only fields that actually moved are kept — an audit entry repeating the whole
 * record is an audit entry nobody reads. Fields present in one side and not the
 * other count as a change, with `null` for the missing side.
 */
export function diffRecords(
  before: Readonly<Record<string, unknown>> | undefined,
  after: Readonly<Record<string, unknown>> | undefined,
  labels: Readonly<Record<string, string>> = {},
): RawFieldChange[] {
  const fields = new Set<string>([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ]);
  const out: RawFieldChange[] = [];
  for (const field of [...fields].sort()) {
    const a = before?.[field];
    const b = after?.[field];
    if (Object.is(a, b)) continue;
    // Both sides absent-ish is not a change worth recording.
    if ((a === undefined || a === null) && (b === undefined || b === null)) continue;
    out.push({ field, label: labels[field], before: a ?? null, after: b ?? null });
  }
  return out;
}

/**
 * A last-resort guard for free text that reaches the ledger — a summary, a
 * note, a rationale. It cannot know what a person typed, so it does one narrow
 * thing well: it refuses text that looks like a credential was pasted into it.
 */
const CREDENTIAL_SHAPES: readonly RegExp[] = [
  /\b(?:password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*\S+/i,
  /\bbearer\s+[A-Za-z0-9._-]{16,}/i,
  /\beyJ[A-Za-z0-9._-]{20,}/, // a JWT
  /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{12,}/i,
  /\b\d{9,18}\b(?=\s*(?:routing|account))/i,
];

export const REDACTED_TEXT = "[redacted]";

export function redactFreeText(text: string): string {
  let out = text;
  for (const shape of CREDENTIAL_SHAPES) {
    out = out.replace(new RegExp(shape.source, shape.flags.includes("g") ? shape.flags : `${shape.flags}g`), REDACTED_TEXT);
  }
  return out;
}

export function containsCredentialShape(text: string): boolean {
  return CREDENTIAL_SHAPES.some((shape) => shape.test(text));
}
