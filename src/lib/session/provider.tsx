"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  createContext, useCallback, useEffect, useMemo, useState,
  useSyncExternalStore, type ReactNode,
} from "react";
import { effectivePermissions } from "@/lib/permissions/effective";
import type {
  DensityPreference, Membership, Organization, PermissionKey,
  PermissionTemplate, User,
} from "@/types";
import {
  getStoredActiveMembership, setStoredActiveMembership,
  subscribeActiveMembership,
} from "./active-membership-store";
import {
  MOCK_MEMBERSHIPS, MOCK_ORGANIZATIONS, MOCK_SESSION, MOCK_TEMPLATES, MOCK_USER,
} from "./fixtures";

export interface SessionContextValue {
  /** Permanent. Identical across every organization switch. */
  user: User;
  memberships: Membership[];
  organizations: Organization[];
  templates: PermissionTemplate[];
  activeMembership: Membership | null;
  activeOrganization: Organization | null;
  permissions: ReadonlySet<PermissionKey>;
  /** True when this membership is linked to a driver profile. */
  isDriverMembership: boolean;
  density: DensityPreference;
  setDensity: (d: DensityPreference) => void;
  switchOrganization: (membershipId: string) => void;
}

export const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  // Restored from storage after hydration; falls back to the default membership.
  const storedMembershipId = useSyncExternalStore(
    subscribeActiveMembership,
    getStoredActiveMembership,
    () => null,
  );
  const [switchedTo, setSwitchedTo] = useState<string | null>(null);

  const activeMembershipId =
    switchedTo ??
    (storedMembershipId && MOCK_MEMBERSHIPS.some((m) => m.id === storedMembershipId)
      ? storedMembershipId
      : MOCK_SESSION.activeMembershipId);
  const [density, setDensityState] = useState<DensityPreference>(
    MOCK_USER.preferences.density,
  );

  // Density is a User preference, so it survives organization switches.
  useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);

  const activeMembership = useMemo(
    () => MOCK_MEMBERSHIPS.find((m) => m.id === activeMembershipId) ?? null,
    [activeMembershipId],
  );

  const activeOrganization = useMemo(
    () =>
      MOCK_ORGANIZATIONS.find((o) => o.id === activeMembership?.organizationId) ??
      null,
    [activeMembership],
  );

  const permissions = useMemo<ReadonlySet<PermissionKey>>(() => {
    if (!activeMembership || !activeOrganization) return new Set<PermissionKey>();
    return effectivePermissions(activeMembership, activeOrganization, MOCK_TEMPLATES);
  }, [activeMembership, activeOrganization]);

  const switchOrganization = useCallback(
    (membershipId: string) => {
      if (membershipId === activeMembershipId) return;
      // The entire cache is discarded, not merely re-fetched. Org A's data can
      // never be served to a screen rendered under Org B.
      queryClient.clear();
      setSwitchedTo(membershipId);
      setStoredActiveMembership(membershipId);
    },
    [activeMembershipId, queryClient],
  );

  const value = useMemo<SessionContextValue>(
    () => ({
      user: MOCK_USER,
      memberships: MOCK_MEMBERSHIPS,
      organizations: MOCK_ORGANIZATIONS,
      templates: MOCK_TEMPLATES,
      activeMembership,
      activeOrganization,
      permissions,
      isDriverMembership: Boolean(activeMembership?.driverProfileId),
      density,
      setDensity: setDensityState,
      switchOrganization,
    }),
    [activeMembership, activeOrganization, permissions, density, switchOrganization],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
