"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  getServerSidebarMode, getStoredSidebarMode, setStoredSidebarMode,
  subscribeSidebarMode, type SidebarMode,
} from "@/lib/session/sidebar-mode-store";
import { useUiStore } from "@/lib/session/store";

export interface SidebarModeController {
  /** The persisted display mode: docked and labelled, docked as an icon rail,
   *  or undocked entirely behind the logo. */
  mode: SidebarMode;
  setMode: (mode: SidebarMode) => void;
  /** The desktop drawer. Only reachable while the mode is "hidden". */
  overlayOpen: boolean;
  setOverlayOpen: (open: boolean) => void;
}

/**
 * The one place the shell reads or writes how the sidebar is displayed.
 *
 * The mode is read through `useSyncExternalStore`, so the server renders the
 * default and the client swaps in the stored preference at hydration.
 */
export function useSidebarMode(): SidebarModeController {
  const mode = useSyncExternalStore(
    subscribeSidebarMode,
    getStoredSidebarMode,
    getServerSidebarMode,
  );
  const overlayOpen = useUiStore((s) => s.sidebarOverlayOpen);
  const setOverlayOpen = useUiStore((s) => s.setSidebarOverlayOpen);

  const setMode = useCallback(
    (next: SidebarMode) => {
      setStoredSidebarMode(next);
      // Docking the sidebar makes the drawer redundant — leaving it open would
      // stack a drawer on top of the rail it was standing in for.
      if (next !== "hidden") setOverlayOpen(false);
    },
    [setOverlayOpen],
  );

  return { mode, setMode, overlayOpen, setOverlayOpen };
}
