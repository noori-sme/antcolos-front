import { describe, expect, it } from "vitest";
import type { ExtractionRunStatus, RateConDocument, RateConDocumentStatus } from "@/types/rate-con-intake";
import { rateConDisplayStatus } from "./status";

const doc = (status: RateConDocumentStatus, run: ExtractionRunStatus | null): Pick<RateConDocument, "status" | "latestRun"> => ({
  status,
  latestRun: run
    ? { id: "r", attempt: 1, status: run, provider: null, model: null, errorCode: null, startedAt: null, finishedAt: null }
    : null,
});

describe("rateConDisplayStatus", () => {
  it("says the read failed when the latest run failed and nothing was read (the reported bug)", () => {
    expect(rateConDisplayStatus(doc("received", "failed"))).toBe("read_failed");
  });

  it("says reading while the run is queued or running, or before any run", () => {
    expect(rateConDisplayStatus(doc("received", "pending"))).toBe("received");
    expect(rateConDisplayStatus(doc("received", "running"))).toBe("received");
    expect(rateConDisplayStatus(doc("received", null))).toBe("received");
  });

  it("keeps the document's own status once fields exist, even if a later retry failed", () => {
    expect(rateConDisplayStatus(doc("extracted", "failed"))).toBe("extracted");
    expect(rateConDisplayStatus(doc("reviewed", "succeeded"))).toBe("reviewed");
    expect(rateConDisplayStatus(doc("accepted", "succeeded"))).toBe("accepted");
  });
});
