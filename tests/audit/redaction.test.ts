import { beforeEach, describe, expect, it } from "vitest";
import {
  classifyValue, diffRecords, isSensitiveField, sanitizeChanges,
  containsCredentialShape, MAX_AUDIT_VALUE_LENGTH,
} from "@/lib/audit/redaction";
import {
  NORTHLINE_OWNER, allEvents, audit, contextFor, resetAuditAndRisk,
} from "./helpers";

/**
 * Redaction is enforced at the SERVICE BOUNDARY. These tests prove both halves:
 * that the sanitizer is right, and that a caller cannot get past it.
 */

beforeEach(resetAuditAndRisk);

describe("the sensitive-field list", () => {
  it("catches credentials, money routing, identifiers and document bodies", () => {
    const sensitive = [
      "password", "passwordHash", "user.password", "apiKey", "api_key",
      "accessToken", "refresh_token", "sessionId", "cookie",
      "bank.accountNumber", "payout.routingNumber", "iban", "cardNumber", "cvv",
      "ssn", "driver.socialSecurityNumber", "taxId", "passportNumber", "dateOfBirth",
      "document.content", "file_content", "extractedText", "ocrText", "rawText",
    ];
    for (const field of sensitive) {
      expect(isSensitiveField(field), field).toBe(true);
    }
  });

  it("leaves ordinary operational fields alone", () => {
    for (const field of ["status", "gallons", "assignment.driver", "dueAt", "severity"]) {
      expect(isSensitiveField(field), field).toBe(false);
    }
  });

  it("keeps the fact and drops both values", () => {
    const { changes, redactedCount } = sanitizeChanges([
      { field: "payout.accountNumber", before: "111122223333", after: "999988887777" },
    ]);
    expect(redactedCount).toBe(1);
    expect(changes[0].redacted).toBe(true);
    expect(changes[0].redactionReason).toBe("sensitive_field");
    // Not hashed, not truncated, not "last four" — absent.
    expect(changes[0].before).toBeUndefined();
    expect(changes[0].after).toBeUndefined();
    // The field still shows up, because "the payout account changed" is the
    // part an auditor needs.
    expect(changes[0].label).toBe("Account number");
  });
});

describe("only scalars are carried", () => {
  it("refuses objects and arrays rather than serializing them", () => {
    expect(classifyValue({ nested: "value" }).ok).toBe(false);
    expect(classifyValue(["a", "b"]).ok).toBe(false);
    expect(classifyValue(() => null).ok).toBe(false);
  });

  it("drops a long string instead of truncating it", () => {
    const body = "x".repeat(MAX_AUDIT_VALUE_LENGTH + 1);
    const result = classifyValue(body);
    expect(result.ok).toBe(false);
    // A truncated document body is still a document body.
    if (!result.ok) expect(result.reason).toBe("too_long");
  });

  it("accepts the shapes an audit trail actually needs", () => {
    expect(classifyValue("draft")).toEqual({ ok: true, value: "draft" });
    expect(classifyValue(18.4)).toEqual({ ok: true, value: 18.4 });
    expect(classifyValue(false)).toEqual({ ok: true, value: false });
    expect(classifyValue(null)).toEqual({ ok: true, value: null });
    expect(classifyValue(undefined)).toEqual({ ok: true, value: null });
  });
});

describe("diffs record only what moved", () => {
  it("skips fields that did not change", () => {
    const diff = diffRecords(
      { status: "draft", amount: 100, note: "same" },
      { status: "issued", amount: 100, note: "same" },
    );
    expect(diff.map((d) => d.field)).toEqual(["status"]);
  });

  it("counts an added or removed field as a change", () => {
    const diff = diffRecords({ a: 1 }, { b: 2 });
    expect(diff.map((d) => d.field).sort()).toEqual(["a", "b"]);
  });
});

describe("the boundary refuses what the caller hands it", () => {
  it("never stores a password, token or full account number, however it is passed", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const event = await audit.record(ctx, {
      module: "access",
      action: "access.role_changed",
      entity: { kind: "membership", id: "mem_x", label: "Somebody" },
      summary: "Changed a membership",
      changes: [
        { field: "password", before: "hunter2", after: "correct-horse" },
        { field: "apiToken", before: "tok_live_abc123", after: "tok_live_def456" },
        { field: "bank.accountNumber", before: "111122223333", after: "444455556666" },
        { field: "title", before: "Dispatcher", after: "Senior dispatcher" },
      ],
    });

    const serialized = JSON.stringify(event);
    for (const secret of ["hunter2", "correct-horse", "tok_live_abc123", "111122223333"]) {
      expect(serialized).not.toContain(secret);
    }
    // The non-sensitive change survives in full.
    const title = event.changes!.changes.find((c) => c.field === "title")!;
    expect(title.before).toBe("Dispatcher");
    expect(title.after).toBe("Senior dispatcher");
    expect(event.changes!.redactedCount).toBe(3);
  });

  it("never stores document contents", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const event = await audit.record(ctx, {
      module: "documents",
      action: "documents.uploaded",
      entity: { kind: "document", id: "doc_x", label: "Medical card" },
      summary: "Uploaded a medical card",
      changes: [
        { field: "fileContent", after: "JVBERi0xLjQKJeLjz9MK" },
        { field: "extractedText", after: "Name: A Person; DOB: 1 Jan 1970" },
        { field: "fileName", after: "medical-card.pdf" },
      ],
    });
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("JVBERi0xLjQ");
    expect(serialized).not.toContain("DOB: 1 Jan 1970");
    expect(serialized).toContain("medical-card.pdf");
  });

  it("holds for the seeded history too, not only for new writes", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const events = await allEvents(ctx);
    const payout = events.find((e) => e.action === "banking.payout_details_changed")!;
    const account = payout.changes!.changes.find((c) => c.field === "payout.accountNumber")!;
    expect(account.redacted).toBe(true);
    expect(account.before).toBeUndefined();
    // The safe part of the same change is kept, so the event still means something.
    const method = payout.changes!.changes.find((c) => c.field === "payout.method")!;
    expect(method.after).toBe("ach");
  });

  it("exports the field names of what was withheld, and not the values", async () => {
    const ctx = contextFor(NORTHLINE_OWNER);
    const view = await audit.exportView(ctx, { module: ["banking"] });
    const row = view.rows.find((r) => r.redactedFields.length > 0)!;
    expect(row.redactedFields).toContain("Account number");
    expect(JSON.stringify(view)).not.toContain("111122223333");
  });
});

describe("free text is checked for pasted credentials", () => {
  it("recognizes the shapes people paste into a note", () => {
    expect(containsCredentialShape("password: hunter2")).toBe(true);
    expect(containsCredentialShape("Authorization: Bearer abcdefghijklmnopqrst")).toBe(true);
    expect(containsCredentialShape("token=sk_live_abcdefghijkl")).toBe(true);
    expect(containsCredentialShape("Approved the settlement on Tuesday")).toBe(false);
  });
});
