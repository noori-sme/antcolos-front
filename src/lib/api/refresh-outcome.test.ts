import { describe, expect, it } from "vitest";
import { refreshOutcome } from "./client";

describe("refreshOutcome", () => {
  it("ends the session only on the API's 401", () => {
    expect(refreshOutcome(200)).toBe("ok");
    expect(refreshOutcome(401)).toBe("expired");
    expect(refreshOutcome(503)).toBe("unavailable");
    expect(refreshOutcome(429)).toBe("unavailable");
    expect(refreshOutcome(null)).toBe("unavailable");
  });
});
