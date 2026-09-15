import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MOCK_STORES, mockStoreIds, resetAllMocks } from "@/lib/api/mock/registry";

/**
 * The registry cannot quietly fall behind.
 *
 * A central list of mock stores is only worth anything if adding a store without
 * adding it here fails. This test reads the mock folder and refuses to pass when
 * a module exports a reset the registry has never heard of — which is the exact
 * failure the registry exists to prevent.
 */

const MOCK_DIR = join(process.cwd(), "src/lib/api/mock");

/**
 * Resets that are deliberately NOT in the registry, with the reason.
 *
 * Both take arguments and are product actions rather than test resets: putting
 * one workspace's ranking weights or one carrier's visibility policy back to the
 * default, with the name of the person who did it. Calling either from a
 * whole-world reset would be recording a person's decision that nobody made.
 */
const DELIBERATELY_ABSENT = new Set([
  "resetRankingWeights",
  "resetPolicyToDefault",
]);

test("every reset in the mock folder is registered, or listed as deliberately absent", () => {
  const found = new Map<string, string>();
  for (const file of readdirSync(MOCK_DIR)) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
    if (file === "registry.ts") continue;
    const source = readFileSync(join(MOCK_DIR, file), "utf8");
    for (const match of source.matchAll(/export function (reset[A-Za-z]*)/g)) {
      found.set(match[1], file);
    }
  }
  assert.ok(found.size > 20, "the scan found the resets it was meant to");

  const registered = readFileSync(join(MOCK_DIR, "registry.ts"), "utf8");
  const missing: string[] = [];
  for (const [name, file] of found) {
    if (DELIBERATELY_ABSENT.has(name)) continue;
    if (!registered.includes(name)) missing.push(`${name} (${file})`);
  }

  assert.deepEqual(
    missing, [],
    "these mock stores are not in src/lib/api/mock/registry.ts. Add one line each, in the commit that created them.",
  );
});

test("the class-based stores are registered too", () => {
  // These have a `reset()` method rather than an exported function, so the scan
  // above cannot see them. Named explicitly so adding a third does not slip by.
  const registered = readFileSync(join(MOCK_DIR, "registry.ts"), "utf8");
  for (const name of [
    "mockStore.reset", "settlementStore.reset", "driverWorkflowStore.reset",
  ]) {
    assert.ok(registered.includes(name), `${name}() is in the registry`);
  }
});

test("every entry describes itself, and ids are unique", () => {
  const ids = mockStoreIds();
  assert.equal(new Set(ids).size, ids.length, "ids are unique");
  for (const store of MOCK_STORES) {
    assert.ok(store.id.length > 0);
    assert.ok(store.holds.length > 10, `${store.id} says what it holds`);
    assert.ok(store.module.endsWith(".ts"), `${store.id} says where to look`);
    assert.equal(typeof store.reset, "function");
  }
});

test("resetting everything runs every store and throws nothing", () => {
  // The propagation bus is last on purpose — rebuilding a seed above it can
  // publish, and clearing the bus first would record those against a world that
  // is already gone. Asserting the order keeps that reasoning from being lost.
  assert.equal(MOCK_STORES.at(-1)?.id, "propagation");
  assert.doesNotThrow(() => resetAllMocks());
  // Twice, because a reset that only works on a fresh world is not a reset.
  assert.doesNotThrow(() => resetAllMocks());
});
