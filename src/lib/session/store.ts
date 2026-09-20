import { create } from "zustand";

/** Ephemeral UI state only. Nothing identity- or permission-related lives here.
 *  The sidebar's *display mode* is a persisted preference and lives in
 *  ./sidebar-mode-store; what is kept here is only whether its drawer is
 *  currently open, which never outlives the page. */
interface UiState {
  mobileNavOpen: boolean;
  /** Desktop navigation drawer — only reachable while the mode is "hidden". */
  sidebarOverlayOpen: boolean;
  setMobileNavOpen: (v: boolean) => void;
  setSidebarOverlayOpen: (v: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  mobileNavOpen: false,
  sidebarOverlayOpen: false,
  setMobileNavOpen: (v) => set({ mobileNavOpen: v }),
  setSidebarOverlayOpen: (v) => set({ sidebarOverlayOpen: v }),
}));
