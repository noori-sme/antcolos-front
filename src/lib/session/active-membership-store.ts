"use client";

/**
 * The active membership survives a reload.
 *
 * Backed by an external store so React can hydrate with the server's value and
 * then re-render with the stored one — no mismatch, no setState-in-effect. Only
 * the membership ID is persisted; identity, profile and preferences are never
 * written here.
 */
const KEY = "antcolos.activeMembershipId";

let cached: string | null | undefined;
const listeners = new Set<() => void>();

function read(): string | null {
  if (cached !== undefined) return cached;
  try {
    cached = window.localStorage.getItem(KEY);
  } catch {
    cached = null; // private mode, blocked storage — fall back to the default
  }
  return cached;
}

export function subscribeActiveMembership(onChange: () => void) {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cached = e.newValue;
      listeners.forEach((l) => l());
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function getStoredActiveMembership(): string | null {
  return read();
}

export function setStoredActiveMembership(membershipId: string) {
  cached = membershipId;
  try {
    window.localStorage.setItem(KEY, membershipId);
  } catch {
    // Storage unavailable — the switch still applies for this session.
  }
  listeners.forEach((l) => l());
}
