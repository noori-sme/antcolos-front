import {
  accessorialLineItems, missingInvoiceDocuments, rejectedInvoiceDocuments,
  type DocumentKind, type Invoice, type InvoiceReadiness,
  type InvoiceReadinessCheck,
} from "@/types";

/**
 * Readiness is the question "may this invoice be sent to the payer?", answered
 * as a list of named checks rather than a boolean, because a biller who is
 * blocked needs to know WHICH thing to go and fix.
 *
 * A failing check blocks. A warning does not — it is something the biller
 * should know before sending, not something Antcolos refuses to do for them.
 *
 * Every check reads the invoice's own SNAPSHOT. It does not call the Loads,
 * Documents or Broker modules: readiness must give the same answer next year
 * when those profiles have moved on.
 */

function check(
  id: InvoiceReadinessCheck["id"],
  label: string,
  state: InvoiceReadinessCheck["state"],
  detail: string,
  blocking = state === "fail",
): InvoiceReadinessCheck {
  return { id, label, state, detail, blocking };
}

export function evaluateReadiness(invoice: Invoice): InvoiceReadiness {
  const checks: InvoiceReadinessCheck[] = [];

  // 1. The freight actually moved.
  checks.push(
    invoice.load.deliveredAt
      ? check("load_delivered", "Load delivered", "pass",
          "The Loads module has a delivery recorded for this load.")
      : check("load_delivered", "Load delivered", "fail",
          "The load has no delivery recorded. Billing before delivery is how a carrier loses a customer."),
  );

  // 2. There is an agreement behind the money.
  if (!invoice.rateConfirmation) {
    checks.push(check("rate_confirmation", "Rate confirmation on file", "fail",
      "No rate confirmation is linked. The payer has agreed to nothing this invoice can point at."));
  } else if (!invoice.rateConfirmation.verifiedAt) {
    checks.push(check("rate_confirmation", "Rate confirmation on file", "warn",
      "The rate confirmation is linked but has not been verified by a person."));
  } else {
    checks.push(check("rate_confirmation", "Rate confirmation on file", "pass",
      "Linked and verified."));
  }

  // 3. The linehaul matches what was agreed.
  if (invoice.rateConfirmation) {
    const agreed = invoice.rateConfirmation.agreedLinehaulCents;
    const difference = invoice.linehaulCents - agreed;
    checks.push(
      difference === 0
        ? check("linehaul_matches_rate_con", "Linehaul matches the rate confirmation", "pass",
            "The billed linehaul is exactly the agreed rate.")
        : check("linehaul_matches_rate_con", "Linehaul matches the rate confirmation", "fail",
            `Billed linehaul differs from the agreed rate by ${
              difference > 0 ? "+" : "−"
            }$${(Math.abs(difference) / 100).toFixed(2)}. A mismatch is the most common reason an invoice is disputed.`),
    );
  }

  // 4. Required paperwork is present.
  const missing = missingInvoiceDocuments(invoice);
  checks.push(
    missing.length === 0
      ? check("required_documents", "Required documents attached", "pass",
          "Every document this payer requires is attached.")
      : check("required_documents", "Required documents attached", "fail",
          `${missing.length} required document${missing.length > 1 ? "s are" : " is"} missing.`),
  );

  // 5. Nothing attached has been rejected, and nothing is still awaiting review.
  const rejected = rejectedInvoiceDocuments(invoice);
  const pending = invoice.documents.filter(
    (d) => d.documentId && d.verificationStateSnapshot === "pending",
  );
  if (rejected.length > 0) {
    checks.push(check("documents_verified", "Attached documents accepted", "fail",
      `${rejected.length} attached document${rejected.length > 1 ? "s were" : " was"} rejected and does not satisfy the requirement.`));
  } else if (pending.length > 0) {
    checks.push(check("documents_verified", "Attached documents accepted", "warn",
      `${pending.length} document${pending.length > 1 ? "s are" : " is"} still awaiting review.`));
  } else {
    checks.push(check("documents_verified", "Attached documents accepted", "pass",
      "Nothing attached is rejected or waiting on review."));
  }

  // 6. Every accessorial was approved somewhere upstream.
  const accessorials = accessorialLineItems(invoice);
  const preApproved = new Set(invoice.rateConfirmation?.preApprovedAccessorialCodes ?? []);
  const unapproved = accessorials.filter(
    (line) => !line.source.approvedBy && !preApproved.has(line.kind),
  );
  if (accessorials.length === 0) {
    checks.push(check("accessorials_approved", "Accessorials approved", "pass",
      "Linehaul only — there is nothing to approve."));
  } else if (unapproved.length > 0) {
    checks.push(check("accessorials_approved", "Accessorials approved", "fail",
      `${unapproved.length} accessorial line${unapproved.length > 1 ? "s have" : " has"} no recorded approval: ${
        unapproved.map((l) => l.label).join(", ")
      }.`));
  } else {
    checks.push(check("accessorials_approved", "Accessorials approved", "pass",
      `All ${accessorials.length} accessorial line${accessorials.length > 1 ? "s are" : " is"} approved upstream.`));
  }

  // 7. There is somewhere to send it and terms to count days against.
  const party = invoice.billingParty;
  const reachable = Boolean(party.billingContact?.email || party.submissionPortal);
  if (party.paymentTermsDays <= 0) {
    checks.push(check("billing_party_billable", "Billing party is billable", "fail",
      `${party.name} has no payment terms on file, so there is no due date to hold them to.`));
  } else if (!reachable) {
    checks.push(check("billing_party_billable", "Billing party is billable", "warn",
      `${party.name} has no billing email and no submission portal recorded.`));
  } else if (party.requiresOriginalDocuments) {
    checks.push(check("billing_party_billable", "Billing party is billable", "warn",
      `${party.name} requires original documents by mail as well as this submission.`));
  } else {
    checks.push(check("billing_party_billable", "Billing party is billable", "pass",
      `Net ${party.paymentTermsDays} to ${party.name}.`));
  }

  // 8. It asks for money.
  checks.push(
    invoice.totalCents > 0
      ? check("total_positive", "Invoice has a positive total", "pass",
          "The invoice asks for a positive amount.")
      : check("total_positive", "Invoice has a positive total", "fail",
          "The total is zero. There is nothing to bill."),
  );

  const missingDocumentKinds: DocumentKind[] = missing.map((d) => d.kind);

  return {
    ready: checks.every((c) => !(c.blocking && c.state === "fail")),
    checks,
    missingDocumentKinds,
  };
}

/** The failing checks only — what a "cannot send yet" message should list. */
export function blockingReasons(readiness: InvoiceReadiness): InvoiceReadinessCheck[] {
  return readiness.checks.filter((c) => c.state === "fail" && c.blocking);
}
