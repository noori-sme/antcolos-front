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
  NEWCOMER_MEMBERSHIPS, NEWCOMER_ORGANIZATIONS, NEWCOMER_USER,
} from "./fixtures";
import { readSessionScenario, type SessionScenario } from "./scenarios";

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

/** The fixture set never changes within a tab, so there is nothing to notify. */
const subscribeNothing = () => () => {};
const serverScenario = (): SessionScenario => "demo";

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  /**
   * Which fixtures this tab runs on.
   *
   * Read through `useSyncExternalStore` for the same reason the active
   * membership is: the server has no window, so it answers "demo", and the
   * client picks up the real answer at hydration without a render-time read.
   * A tab's scenario never changes while it is open, so there is nothing to
   * subscribe to.
   */
  const scenario = useSyncExternalStore<SessionScenario>(
    subscribeNothing,
    readSessionScenario,
    serverScenario,
  );
  const newcomer = scenario === "newcomer";

  const user = newcomer ? NEWCOMER_USER : MOCK_USER;
  const memberships = newcomer ? NEWCOMER_MEMBERSHIPS : MOCK_MEMBERSHIPS;
  const organizations = newcomer ? NEWCOMER_ORGANIZATIONS : MOCK_ORGANIZATIONS;
  // Restored from storage after hydration; falls back to the default membership.
  const storedMembershipId = useSyncExternalStore(
    subscribeActiveMembership,
    getStoredActiveMembership,
    () => null,
  );
  const [switchedTo, setSwitchedTo] = useState<string | null>(null);

  const activeMembershipId =
    switchedTo ??
    (storedMembershipId && memberships.some((m) => m.id === storedMembershipId)
      ? storedMembershipId
      : MOCK_SESSION.activeMembershipId);
  const [density, setDensityState] = useState<DensityPreference>(
    MOCK_USER.preferences.density,
  );

  // Density is a User preference, so it survives organization switches.
  useEffect(() => {
    document.documentElement.dataset.density = density;
  }, [density]);

  // A person who belongs to nothing has no active membership, and therefore no
  // organization and no permissions. Every screen already treats that as a
  // possible answer; nothing here invents a workspace to avoid it.
  const activeMembership = useMemo(
    () => memberships.find((m) => m.id === activeMembershipId) ?? null,
    [memberships, activeMembershipId],
  );

  const activeOrganization = useMemo(
    () => organizations.find((o) => o.id === activeMembership?.organizationId) ?? null,
    [organizations, activeMembership],
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
      user,
      memberships,
      organizations,
      templates: MOCK_TEMPLATES,
      activeMembership,
      activeOrganization,
      permissions,
      isDriverMembership: Boolean(activeMembership?.driverProfileId),
      density,
      setDensity: setDensityState,
      switchOrganization,
    }),
    [user, memberships, organizations, activeMembership, activeOrganization, permissions, density, switchOrganization],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
