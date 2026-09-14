"use client";

import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ReportId, ReportView } from "@/types";
import { DEFAULT_PRESET_ID } from "@/lib/reports/range";

/**
 * Reading preferences, per person and per report.
 *
 * Which view somebody reads a report in is a preference, not data: it is kept
 * in the browser, never sent to a service, and never allowed to change what a
 * report calculates. Losing it loses nothing but a click.
 */
interface ReportPreferences {
  viewByReport: Partial<Record<ReportId, ReportView>>;
  rangePresetId: string;
  setView: (reportId: ReportId, view: ReportView) => void;
  setRangePresetId: (presetId: string) => void;
}

export const useReportPreferences = create<ReportPreferences>()(
  persist(
    (set) => ({
      viewByReport: {},
      rangePresetId: DEFAULT_PRESET_ID,
      setView: (reportId, view) =>
        set((state) => ({ viewByReport: { ...state.viewByReport, [reportId]: view } })),
      setRangePresetId: (rangePresetId) => set({ rangePresetId }),
    }),
    { name: "antcolos.reports.preferences", version: 1 },
  ),
);

const noSubscription = () => () => {};

/** True once the persisted store has been read, so the server and the first
 *  client render agree and a remembered view does not cause a hydration flash. */
export function useHydratedPreferences(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}

/** The remembered view for a report, falling back to the definition's default. */
export function useRememberedView(
  reportId: ReportId,
  fallback: ReportView,
  allowed: ReportView[],
): ReportView {
  const hydrated = useHydratedPreferences();
  const remembered = useReportPreferences((s) => s.viewByReport[reportId]);
  if (!hydrated) return fallback;
  // A remembered view that this report cannot carry is ignored, not forced.
  return remembered && allowed.includes(remembered) ? remembered : fallback;
}
