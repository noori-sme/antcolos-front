import { describe, expect, it } from "vitest";
import { toUsageReport } from "./usage";

/** Copied from ../antcolos/docs/requirements/usage-api-contract.md §Report. */
const CONTRACT = {
  from: "2026-10-23T00:00:00.000Z",
  to: "2026-11-22T00:00:00.000Z",
  rates: { storageUsdPerGbMonth: 0.015, emailUsdPerMessage: 0 },
  totals: {
    ai: { calls: 412, inputTokens: 1830000, outputTokens: 96000, costUsd: 3.4127 },
    storage: { files: 318, bytes: 912345678, estimatedMonthlyUsd: 0.0127 },
    email: { sent: 57, failed: 2, estimatedUsd: 0 },
    telegram: { sent: 230, failed: 1 },
    estimatedTotalUsd: 3.4254,
  },
  organizations: [],
  aiDaily: [{ day: "2026-11-21", calls: 14, costUsd: 0.1182 }],
  notMetered: ["fmcsa_lookups", "account_emails"],
};

describe("toUsageReport", () => {
  it("maps the contract report", () => {
    const r = toUsageReport(CONTRACT);
    expect(r.totals).toEqual(CONTRACT.totals);
    expect(r.rates).toEqual(CONTRACT.rates);
    expect(r.aiDaily).toEqual(CONTRACT.aiDaily);
    expect(r.notMetered).toEqual(["fmcsa_lookups", "account_emails"]);
  });

  it("reads missing numbers as zero", () => {
    expect(toUsageReport({ totals: { ai: {} } }).totals.ai).toEqual({ calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 });
  });
});
