"use client";

import { useMemo } from "react";
import {
  ACCOUNT_NAV, DRIVER_NAV, PRODUCT_NAV, SETTINGS_NAV,
  type NavItem, type NavSection,
} from "@/config/nav";
import { canAll } from "@/lib/permissions/can";
import { driverProfileSync } from "@/features/driver/mock-driver";
import { useActiveMembership, usePermissions } from "@/lib/session/hooks";

/**
 * Nav items the active membership may actually reach. Hidden items never
 * render — they are not disabled, they are absent.
 */
export function useVisibleNav() {
  const permissions = usePermissions();
  const { isDriverMembership, membership } = useActiveMembership();

  /**
   * The driver portal is reached two ways, and belonging to a carrier is only
   * one of them. A driver who signed up for themselves has a profile and no
   * membership at all: the portal is the only thing they have, and hiding it
   * behind a carrier's membership would lock them out of their own documents.
   */
  const unattachedDriver = !membership && Boolean(driverProfileSync());
  const driverPortal = isDriverMembership || unattachedDriver;

  return useMemo(() => {
    const filterSections = (sections: NavSection[]): NavSection[] =>
      sections
        .map((section) => ({
          ...section,
          items: section.items.filter(
            (item) =>
              (!item.driverOnly || driverPortal) &&
              canAll(permissions, item.requires),
          ),
        }))
        .filter((section) => section.items.length > 0);

    // A driver membership has its own Home and its own load list. Showing the
    // organization-wide equivalents beside them duplicates the destination and
    // the label, so they are dropped rather than shown twice.
    const DRIVER_REPLACED = new Set(["/home", "/loads", "/dispatch"]);
    const productSource = driverPortal
      ? PRODUCT_NAV.map((s) => ({
          ...s,
          items: s.items.filter((i) => !DRIVER_REPLACED.has(i.href)),
        }))
      : PRODUCT_NAV;

    const product = filterSections(productSource);
    const driver = filterSections(DRIVER_NAV);
    const settings = filterSections(SETTINGS_NAV);
    const account = filterSections(ACCOUNT_NAV);

    // A driver membership leads with the driver portal.
    const main = driverPortal ? [...driver, ...product] : [...product, ...driver];

    const mobilePrimary: NavItem[] = main
      .flatMap((s) => s.items)
      .filter((i) => i.primaryMobile)
      .slice(0, 4);

    return { main, settings, account, mobilePrimary };
  }, [permissions, driverPortal]);
}
