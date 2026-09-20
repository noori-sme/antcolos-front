"use client";

/**
 * How the left sidebar is displayed, and it survives a reload.
 *
 * Backed by an external store for the same reason the active membership is:
 * the server has no window, so it answers with the default, and the client
 * picks up the stored answer at hydration — no render-time read, no mismatch,
 * no setState-in-effect. Nothing but the display mode is written here; this is
 * a per-device view preference, not a profile setting and not a permission.
 */

export const SIDEBAR_MODES = ["expanded", "icon", "hidden"] as const;

/** The three shapes the shell's left sidebar can take. */
export type SidebarMode = (typeof SIDEBAR_MODES)[number];

export const DEFAULT_SIDEBAR_MODE: SidebarMode = "expanded";

const KEY = "antcolos.sidebarMode";

function parse(value: string | null): SidebarMode {
  return (SIDEBAR_MODES as readonly string[]).includes(value ?? "")
    ? (value as SidebarMode)
    : DEFAULT_SIDEBAR_MODE;
}

let cached: SidebarMode | undefined;
const listeners = new Set<() => void>();

function read(): SidebarMode {
  if (cached !== undefined) return cached;
  try {
    cached = parse(window.localStorage.getItem(KEY));
  } catch {
    cached = DEFAULT_SIDEBAR_MODE; // private mode, blocked storage
  }
  return cached;
}

export function subscribeSidebarMode(onChange: () => void) {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cached = parse(e.newValue);
      listeners.forEach((l) => l());
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function getStoredSidebarMode(): SidebarMode {
  return read();
}

/** The server cannot know the preference, so it renders the docked sidebar. */
export function getServerSidebarMode(): SidebarMode {
  return DEFAULT_SIDEBAR_MODE;
}

export function setStoredSidebarMode(mode: SidebarMode) {
  if (cached === mode) return;
  cached = mode;
  try {
    window.localStorage.setItem(KEY, mode);
  } catch {
    // Storage unavailable — the choice still applies for this session.
  }
  listeners.forEach((l) => l());
}
