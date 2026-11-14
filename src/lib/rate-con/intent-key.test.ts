import { describe, expect, it } from "vitest";
import { createIntentKeys } from "./intent-key";

describe("createIntentKeys", () => {
  const keys = () => {
    let n = 0;
    return createIntentKeys(() => `k${++n}`);
  };

  it("reuses the key while the same intent is retried", () => {
    const k = keys();
    expect(k.keyFor("approve")).toBe("k1");
    expect(k.keyFor("approve")).toBe("k1");
  });

  it("gives a different intent a new key", () => {
    const k = keys();
    k.keyFor('[{"fieldId":"a"}]');
    expect(k.keyFor('[{"fieldId":"b"}]')).toBe("k2");
  });

  it("starts over after clear, even for the same intent", () => {
    const k = keys();
    k.keyFor("complete");
    k.clear();
    expect(k.keyFor("complete")).toBe("k2");
  });
});
