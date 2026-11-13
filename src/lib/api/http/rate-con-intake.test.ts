import { describe, expect, it } from "vitest";
import {
  toApprovalResult, toDecisionsBody, toDocumentReview, toLoadDraftView, toRateConDocument,
} from "./rate-con-intake";

/** Copied from ../antcolos/docs/requirements/documents-api-contract.md §2. */
const CONTRACT_DOCUMENT = {
  id: "0b6f8c1e-2d3a-4f5b-9c7d-8e9f0a1b2c3d",
  type: "RATE_CONFIRMATION",
  status: "EXTRACTED",
  version: 1,
  supersedesDocumentId: null,
  loadId: null,
  source: "api",
  uploadedByUserId: "1a2b3c4d-5e6f-7890-abcd-ef1234567890",
  receivedAt: "2026-11-06T21:39:58.000Z",
  file: {
    id: "5d2c1b0a-9e8f-4a7b-8c6d-5e4f3a2b1c0d",
    filename: "ratecon-884213.pdf",
    mimeType: "application/pdf",
    sizeBytes: 184233,
  },
  latestExtraction: {
    id: "9a8b7c6d-5e4f-3a2b-1c0d-9e8f7a6b5c4d",
    attempt: 1,
    status: "SUCCEEDED",
    provider: "openrouter",
    model: "openai/gpt-4o",
    schemaVersion: "rate-confirmation.v1",
    cascadePolicyVersion: "RATE_CONFIRMATION-3f9a1c2e",
    errorCode: null,
    startedAt: "2026-11-06T21:40:00.000Z",
    finishedAt: "2026-11-06T21:40:21.000Z",
  },
};

/** §6, with a corrected field added beside the contract's example field. */
const CONTRACT_REVIEW = {
  documentId: "0b6f8c1e-2d3a-4f5b-9c7d-8e9f0a1b2c3d",
  documentStatus: "EXTRACTED",
  extractionId: "9a8b7c6d-5e4f-3a2b-1c0d-9e8f7a6b5c4d",
  summary: {
    high: { total: 18, unreviewed: 3, confirmed: 14, corrected: 1 },
    medium: { total: 15, unreviewed: 15, confirmed: 0, corrected: 0 },
    low: { total: 6, unreviewed: 6, confirmed: 0, corrected: 0 },
    highRiskPending: 3,
    canComplete: false,
  },
  fields: [
    {
      id: "7e6d5c4b-3a2f-1e0d-9c8b-7a6f5e4d3c2b",
      path: "deliveries.0.windowStart",
      tier: "HIGH",
      requiresConfirmation: true,
      reviewStatus: "UNREVIEWED",
      predictedValue: "8:00",
      currentValue: "8:00",
      correction: null,
      confidence: null,
      page: 1,
      box: { x: 0.61, y: 0.42, width: 0.05, height: 0.012 },
      locatedBy: "PDF_TEXT",
    },
    {
      id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      path: "totalRate",
      tier: "HIGH",
      requiresConfirmation: true,
      reviewStatus: "CORRECTED",
      predictedValue: "2500.00",
      currentValue: "2600.00",
      correction: {
        id: "3c2b1a0f-9e8d-4c7b-a6f5-e4d3c2b1a0f9",
        value: "2600.00",
        correctedByUserId: "4b3a2f1e-0d9c-4b8a-a7f6-e5d4c3b2a1f0",
        correctedAt: "2026-11-13T15:04:05.000Z",
      },
      confidence: 0.94,
      page: null,
      box: null,
      locatedBy: null,
    },
  ],
};

/** §9. */
const CONTRACT_DRAFT = {
  documentId: "0b6f8c1e-2d3a-4f5b-9c7d-8e9f0a1b2c3d",
  documentStatus: "REVIEWED",
  extractionId: "9a8b7c6d-5e4f-3a2b-1c0d-9e8f7a6b5c4d",
  action: "CREATE_LOAD",
  matchedLoadId: null,
  draft: {
    brokerName: "Acme Logistics LLC",
    brokerMcNumber: "123456",
    brokerLoadNumber: "AL-884213",
    equipmentType: "DRY_VAN",
    weightLbs: 42000,
    rateTotal: "2500.00",
    referenceNumbers: ["PO-77"],
    stops: [
      {
        type: "PICKUP",
        facilityName: "Joliet DC",
        addressLine1: "100 Industrial Dr",
        city: "Joliet",
        state: "IL",
        postalCode: "60431",
        timezone: "America/Chicago",
        scheduledDate: "2026-11-20",
        windowStart: "2026-11-20T14:00:00.000Z",
        windowEnd: null,
        appointmentConfirmed: false,
      },
    ],
  },
  warnings: ["Appointment times are marked unconfirmed; confirm them with the broker."],
  missing: [
    { field: "stops[1].state", paths: ["deliveries.0.address.state"], required: true },
    { field: "weightLbs", paths: ["weightLbs"], required: false },
  ],
  problems: [],
  canApprove: false,
};

describe("rate-con intake mappers", () => {
  it("maps a document and its latest run (§2)", () => {
    expect(toRateConDocument(CONTRACT_DOCUMENT)).toEqual({
      id: "0b6f8c1e-2d3a-4f5b-9c7d-8e9f0a1b2c3d",
      status: "extracted",
      version: 1,
      loadId: null,
      receivedAt: "2026-11-06T21:39:58.000Z",
      file: {
        id: "5d2c1b0a-9e8f-4a7b-8c6d-5e4f3a2b1c0d",
        filename: "ratecon-884213.pdf",
        mimeType: "application/pdf",
        sizeBytes: 184233,
      },
      latestRun: {
        id: "9a8b7c6d-5e4f-3a2b-1c0d-9e8f7a6b5c4d",
        attempt: 1,
        status: "succeeded",
        provider: "openrouter",
        model: "openai/gpt-4o",
        errorCode: null,
        startedAt: "2026-11-06T21:40:00.000Z",
        finishedAt: "2026-11-06T21:40:21.000Z",
      },
    });
  });

  it("maps a pending upload with no finished run", () => {
    const doc = toRateConDocument({
      ...CONTRACT_DOCUMENT,
      status: "RECEIVED",
      latestExtraction: { ...CONTRACT_DOCUMENT.latestExtraction, status: "PENDING", provider: null },
    });
    expect(doc.status).toBe("received");
    expect(doc.latestRun?.status).toBe("pending");
    expect(toRateConDocument({ ...CONTRACT_DOCUMENT, latestExtraction: null }).latestRun).toBeNull();
  });

  it("rejects an unknown status rather than guessing", () => {
    expect(() => toRateConDocument({ ...CONTRACT_DOCUMENT, status: "ARCHIVED" })).toThrow(
      /status/,
    );
  });

  it("maps the review, keeping the server order (§6)", () => {
    const review = toDocumentReview(CONTRACT_REVIEW);
    expect(review.documentStatus).toBe("extracted");
    expect(review.summary.high).toEqual({ total: 18, unreviewed: 3, confirmed: 14, corrected: 1 });
    expect(review.summary).toMatchObject({ highRiskPending: 3, canComplete: false });
    expect(review.fields.map((f) => f.path)).toEqual(["deliveries.0.windowStart", "totalRate"]);
    expect(review.fields[0]).toEqual({
      id: "7e6d5c4b-3a2f-1e0d-9c8b-7a6f5e4d3c2b",
      path: "deliveries.0.windowStart",
      tier: "high",
      requiresConfirmation: true,
      reviewStatus: "unreviewed",
      predictedValue: "8:00",
      currentValue: "8:00",
      correction: null,
      confidence: null,
      page: 1,
      box: { x: 0.61, y: 0.42, width: 0.05, height: 0.012 },
    });
    expect(review.fields[1]).toMatchObject({
      reviewStatus: "corrected",
      currentValue: "2600.00",
      correction: { value: "2600.00", correctedAt: "2026-11-13T15:04:05.000Z" },
      box: null,
    });
  });

  it("maps an empty review while no run has finished", () => {
    const review = toDocumentReview({
      ...CONTRACT_REVIEW,
      documentStatus: "RECEIVED",
      extractionId: null,
      fields: [],
    });
    expect(review).toMatchObject({ extractionId: null, fields: [] });
  });

  it("writes decisions in the API's shape (§7)", () => {
    expect(
      toDecisionsBody([
        { fieldId: "f-1", action: "confirm" },
        { fieldId: "f-2", action: "correct", value: "2600.00" },
        { fieldId: "f-3", action: "correct", value: null },
      ]),
    ).toEqual({
      decisions: [
        { fieldId: "f-1", action: "CONFIRM" },
        { fieldId: "f-2", action: "CORRECT", value: "2600.00" },
        { fieldId: "f-3", action: "CORRECT", value: null },
      ],
    });
  });

  it("maps the load draft (§9)", () => {
    const view = toLoadDraftView(CONTRACT_DRAFT);
    expect(view).toMatchObject({
      documentStatus: "reviewed",
      action: "create",
      matchedLoadId: null,
      canApprove: false,
      warnings: ["Appointment times are marked unconfirmed; confirm them with the broker."],
      missing: [
        { field: "stops[1].state", paths: ["deliveries.0.address.state"], required: true },
        { field: "weightLbs", paths: ["weightLbs"], required: false },
      ],
      problems: [],
    });
    expect(view.draft).toMatchObject({
      brokerName: "Acme Logistics LLC",
      brokerPhone: null,
      equipmentType: "DRY_VAN",
      weightLbs: 42000,
      rateTotal: "2500.00",
      referenceNumbers: ["PO-77"],
    });
    expect(view.draft?.stops[0]).toEqual({
      type: "pickup",
      facilityName: "Joliet DC",
      addressLine1: "100 Industrial Dr",
      city: "Joliet",
      state: "IL",
      postalCode: "60431",
      timezone: "America/Chicago",
      scheduledDate: "2026-11-20",
      windowStart: "2026-11-20T14:00:00.000Z",
      windowEnd: null,
    });
    expect(toLoadDraftView({ ...CONTRACT_DRAFT, action: "UPDATE_LOAD", draft: null })).toMatchObject({
      action: "update",
      draft: null,
    });
  });

  it("maps the approval result (§10)", () => {
    expect(
      toApprovalResult({
        action: "CREATE_LOAD",
        document: { ...CONTRACT_DOCUMENT, status: "ACCEPTED", loadId: "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f" },
        load: { id: "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f", status: "RC_RECEIVED" },
      }),
    ).toMatchObject({
      action: "create",
      loadId: "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f",
      document: { status: "accepted", loadId: "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f" },
    });
  });
});
