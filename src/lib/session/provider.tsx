"use client";

import { useQueryClient, useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import Cookies from "js-cookie";
import { usePathname } from "next/navigation";
import { SplashScreen } from "@/components/splash-screen";
import {
  createContext, useCallback, useEffect, useMemo, useState,
  useSyncExternalStore, type ReactNode,
} from "react";
import { effectivePermissions } from "@/lib/permissions/effective";
import type {
  DensityPreference, Membership, Organization, PermissionKey,
  User,
} from "@/types";
import {
  getStoredActiveMembership, setStoredActiveMembership,
  subscribeActiveMembership,
} from "./active-membership-store";
import {
  MOCK_SESSION, MOCK_USER, NEWCOMER_USER,
} from "./fixtures";
import {
  rosterServerSnapshot, rosterSnapshot, subscribeRoster,
} from "./membership-store";
import { readSessionScenario, type SessionScenario } from "./scenarios";

export interface SessionContextValue {
  /** Permanent. Identical across every organization switch. */
  user: User;
  /**
   * Readonly, because these come from a store now and a screen that spliced
   * this array would be editing the session out from under every other screen.
   */
  memberships: readonly Membership[];
  organizations: readonly Organization[];
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

  const { data: fetchedUser, isLoading } = useQuery({
    queryKey: ['currentUser'],
    queryFn: async () => {
      const token = Cookies.get('antcolos_token');
      const nextStep = Cookies.get('antcolos_next_step');
      if (!token || nextStep) return null;
      
      const isOrgAdmin = Cookies.get('antcolos_org_type');
      const endpoint = isOrgAdmin ? '/auth/me' : '/auth/individual/me';
      
      const response = await apiClient.get(endpoint);
      const data = response.data?.user || response.data;
      
      if (data?.individualRole) {
        Cookies.set('antcolos_user_role', data.individualRole, { path: '/', expires: 7 });
        Cookies.remove('antcolos_org_type', { path: '/' });
        Cookies.remove('antcolos_org_role', { path: '/' });
      } else if (data?.organizationType) {
        Cookies.set('antcolos_org_type', data.organizationType, { path: '/', expires: 7 });
        Cookies.set('antcolos_org_role', data.role, { path: '/', expires: 7 });
        Cookies.remove('antcolos_user_role', { path: '/' });
      } else {
        Cookies.remove('antcolos_user_role', { path: '/' });
        Cookies.remove('antcolos_org_type', { path: '/' });
        Cookies.remove('antcolos_org_role', { path: '/' });
      }
      
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });

  const pathname = usePathname();
  const isAuthPage = pathname === '/sign-in' || pathname === '/sign-up';
  const isOnboardingPage = pathname.startsWith('/onboarding');

  useEffect(() => {
    const nextStep = Cookies.get('antcolos_next_step');
    if (!isLoading && !fetchedUser && !isAuthPage && !isOnboardingPage && !nextStep) {
      window.location.href = '/sign-in';
    }
  }, [isLoading, fetchedUser, isAuthPage, isOnboardingPage]);

  const baseUser = newcomer ? NEWCOMER_USER : MOCK_USER;
  const user = useMemo(() => {
    if (!fetchedUser) return baseUser;
    return {
      ...baseUser,
      id: fetchedUser.id,
      email: fetchedUser.email,
      displayName: fetchedUser.name,
      username: fetchedUser.username,
      avatarUrl: fetchedUser.avatarUrl || baseUser.avatarUrl,
    };
  }, [baseUser, fetchedUser]);

  /**
   * The seats this person holds, READ FROM A STORE rather than from a frozen
   * array.
   *
   * This is the line that decides whether a seat granted while the tab is open
   * is usable. Everything downstream — the active membership, the organization,
   * the permission set, `isDriverMembership`, and therefore Home, the nav and
   * the driver portal — is derived from this, so making it observable makes all
   * of them observable at once. No screen had to learn anything new.
   */
  const getRoster = useCallback(() => rosterSnapshot(scenario), [scenario]);
  const getServerRoster = useCallback(() => rosterServerSnapshot(scenario), [scenario]);
  const roster = useSyncExternalStore(subscribeRoster, getRoster, getServerRoster);
  const memberships = roster.memberships;
  const organizations = roster.organizations;
  // Restored from storage after hydration; falls back to the default membership.
  const storedMembershipId = useSyncExternalStore(
    subscribeActiveMembership,
    getStoredActiveMembership,
    () => null,
  );
  const [switchedTo, setSwitchedTo] = useState<string | null>(null);

  /**
   * Which seat is active, resolved against the roster the person ACTUALLY holds.
   *
   * Two things here are load-bearing now that the roster can change while the
   * tab is open.
   *
   * It resolves against USABLE seats only. A suspended or ended membership is
   * not a seat somebody is working from — the organization switcher has always
   * said so by listing only active ones — and before this it could still be the
   * active membership, quietly producing a full permission set for a workspace
   * the switcher refused to offer. While the roster was frozen that could never
   * happen; it can now, so it is ruled out here rather than left to each screen.
   *
   * And the last arm matters: the fixture default is a Northline membership,
   * which a person granted their first seat does not hold, so falling back to
   * it left them with no organization and no permissions while holding a
   * perfectly good seat. Only somebody holding nothing ends up with nothing.
   */
  const usable = useMemo(
    () => memberships.filter((m) => m.status === "active"),
    [memberships],
  );

  const held = (candidate: string | null): string | null =>
    candidate && usable.some((m) => m.id === candidate) ? candidate : null;

  const activeMembershipId =
    held(switchedTo)
    ?? held(storedMembershipId)
    ?? held(MOCK_SESSION.activeMembershipId)
    ?? usable[0]?.id
    ?? null;
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
    () => usable.find((m) => m.id === activeMembershipId) ?? null,
    [usable, activeMembershipId],
  );

  const activeOrganization = useMemo(
    () => organizations.find((o) => o.id === activeMembership?.organizationId) ?? null,
    [organizations, activeMembership],
  );

  const permissions = useMemo<ReadonlySet<PermissionKey>>(() => {
    if (!activeMembership || !activeOrganization) return new Set<PermissionKey>();
    return effectivePermissions(activeMembership, activeOrganization);
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
