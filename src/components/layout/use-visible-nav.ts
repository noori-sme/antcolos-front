"use client";

import { useMemo } from "react";
import {
  ACCOUNT_NAV, DRIVER_NAV, PRODUCT_NAV, SETTINGS_NAV,
  type NavItem, type NavSection,
} from "@/config/nav";
import { canAll } from "@/lib/permissions/can";
import { useActiveMembership, usePermissions } from "@/lib/session/hooks";

/**
 * Nav items the active membership may actually reach. Hidden items never
 * render — they are not disabled, they are absent.
 */
export function useVisibleNav() {
  const permissions = usePermissions();
  const { isDriverMembership } = useActiveMembership();

  return useMemo(() => {
    const filterSections = (sections: NavSection[]): NavSection[] =>
      sections
        .map((section) => ({
          ...section,
          items: section.items.filter(
            (item) =>
              (!item.driverOnly || isDriverMembership) &&
              canAll(permissions, item.requires),
          ),
        }))
        .filter((section) => section.items.length > 0);

    // A driver membership has its own Home and its own load list. Showing the
    // organization-wide equivalents beside them duplicates the destination and
    // the label, so they are dropped rather than shown twice.
    const DRIVER_REPLACED = new Set(["/home", "/loads", "/dispatch"]);
    const productSource = isDriverMembership
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
    const main = isDriverMembership ? [...driver, ...product] : [...product, ...driver];

    const mobilePrimary: NavItem[] = main
      .flatMap((s) => s.items)
      .filter((i) => i.primaryMobile)
      .slice(0, 4);

    return { main, settings, account, mobilePrimary };
  }, [permissions, isDriverMembership]);
}
