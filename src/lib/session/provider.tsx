"use client";

import { useQueryClient, useQuery } from "@tanstack/react-query";
import { apiClient, logoutDueToPermissionsError } from "@/lib/api/client";
import {
  readCookie, setAccountKind, setPermissionCookies, setUserRoleFromRoleId,
} from "@/lib/api/auth-cookies";
import { usePathname } from "next/navigation";
import {
  createContext, useCallback, useEffect, useMemo, useState,
  useSyncExternalStore, type ReactNode,
} from "react";
import { effectivePermissions } from "@/lib/permissions/effective";
import { normalizePermissionKey, migrateKey } from "@/lib/permissions/catalog";
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
import { isAuthPath, isPublicPath } from "./route-access";

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
  /**
   * An individual DRIVER account, which has no dashboard access yet (the shell
   * is shown locked). Comes from the account type the backend returned at
   * sign-in. The one place the UI interprets that value; screens read this.
   */
  isDriverAccount: boolean;
  density: DensityPreference;
  setDensity: (d: DensityPreference) => void;
  switchOrganization: (membershipId: string) => void;
}

export const SessionContext = createContext<SessionContextValue | null>(null);

/** The fixture set never changes within a tab, so there is nothing to notify. */
const subscribeNothing = () => () => {};
const serverScenario = (): SessionScenario => "demo";
const readDriverAccount = () => readCookie("antcolos_user_role") === "DRIVER";
const serverDriverAccount = () => false;

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

  const pathname = usePathname();
  // Public pages (tracking, shared, profiles) never load the session: a stale
  // token would 401 on /auth/me and the interceptor would send the visitor
  // to /sign-in.
  const onPublicPage = isPublicPath(pathname);

  const { data: fetchedUser, isLoading } = useQuery({
    queryKey: ['currentUser'],
    enabled: !onPublicPage,
    queryFn: async () => {
      const token = readCookie('antcolos_token');
      const nextStep = readCookie('antcolos_next_step');
      if (!token || nextStep) return null;
      
      const isOrgAdmin = readCookie('antcolos_org_type');
      const endpoint = isOrgAdmin ? '/auth/me' : '/auth/individual/me';
      
      const response = await apiClient.get(endpoint);
      const data = response.data?.user || response.data;
      
      if (data?.individualRole) {
        setAccountKind({ individualRole: data.individualRole });
      } else if (data?.organizationType) {
        setAccountKind({ orgType: data.organizationType, orgRole: data.role });
      } else {
        setAccountKind(null);
      }
      
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: userPermissionsData } = useQuery({
    queryKey: ['userPermissions'],
    enabled: !onPublicPage,
    queryFn: async () => {
      const token = readCookie('antcolos_token');
      const nextStep = readCookie('antcolos_next_step');
      if (!token || nextStep) return null;

      try {
        const response = await apiClient.get('/users/me/permissions');
        const data = response.data?.data || response.data;

        const isInvalid =
          !data ||
          data.error ||
          (typeof data.statusCode === "number" && data.statusCode >= 400) ||
          data.nextStep ||
          data.user?.nextStep ||
          data.scope === "onboarding" ||
          data.user?.scope === "onboarding" ||
          (!data.roleId && !data.permissions && !data.roleName);

        if (isInvalid) {
          logoutDueToPermissionsError();
          return null;
        }

        setPermissionCookies(data);
        if (data.roleId && !readCookie('antcolos_user_role')) {
          setUserRoleFromRoleId(String(data.roleId));
        }

        return data;
      } catch (err) {
        console.error('Failed to fetch user permissions:', err);
        logoutDueToPermissionsError();
        return null;
      }
    },
    staleTime: 5 * 60 * 1000,
  });

  const isAuthPage = isAuthPath(pathname) || onPublicPage;
  const isOnboardingPage = pathname.startsWith('/onboarding');

  useEffect(() => {
    const nextStep = readCookie('antcolos_next_step');
    if (!isLoading && !fetchedUser && !isAuthPage && !isOnboardingPage && !nextStep) {
      window.location.href = '/sign-in';
    }
  }, [isLoading, fetchedUser, isAuthPage, isOnboardingPage]);

  const baseUser = newcomer ? NEWCOMER_USER : MOCK_USER;
  const user = useMemo(() => {
    // Until /auth/me answers, show no identity rather than the fixture's, so
    // the header never flashes a placeholder name before the redirect.
    if (!fetchedUser) return { ...baseUser, displayName: "", email: "", phone: "" };
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

  // Read from the cookie on every render (cheap), so a sign-in in this tab is
  // picked up on the next render. The server answers false, as before.
  const isDriverAccount = useSyncExternalStore(
    subscribeNothing,
    readDriverAccount,
    serverDriverAccount,
  );

  const isDriverMembership = useMemo(() => {
    const roleId =
      userPermissionsData?.roleId ||
      readCookie('antcolos_role_id') ||
      readCookie('antcolos_user_role') ||
      readCookie('antcolos_org_role');
    if (roleId && String(roleId).toUpperCase() === 'DRIVER') {
      return true;
    }
    return Boolean(activeMembership?.driverProfileId);
  }, [userPermissionsData, activeMembership]);

  const permissions = useMemo<ReadonlySet<PermissionKey>>(() => {
    let rawList: string[] = [];

    if (userPermissionsData?.permissions) {
      rawList = Array.isArray(userPermissionsData.permissions)
        ? userPermissionsData.permissions
        : [String(userPermissionsData.permissions)];
    } else {
      const cookieVal = readCookie('antcolos_permissions') || readCookie('antcolos_user_permissions');
      if (cookieVal) {
        try {
          const parsed = JSON.parse(cookieVal);
          if (Array.isArray(parsed)) rawList = parsed;
        } catch {
          rawList = [cookieVal];
        }
      }
    }

    if (rawList.length === 0) {
      if (userPermissionsData?.roleTemplate) {
        rawList = Array.isArray(userPermissionsData.roleTemplate)
          ? userPermissionsData.roleTemplate
          : [String(userPermissionsData.roleTemplate)];
      } else {
        const tmplCookie = readCookie('antcolos_role_template');
        if (tmplCookie) {
          try {
            const parsed = JSON.parse(tmplCookie);
            if (Array.isArray(parsed)) rawList = parsed;
          } catch {}
        }
      }
    }

    const token = readCookie('antcolos_token');

    // Authenticated user with real permissions
    if (token) {
      const set = new Set<PermissionKey>();
      for (const item of rawList) {
        if (!item) continue;
        const s = String(item).trim();
        set.add(s as PermissionKey);
        const norm = normalizePermissionKey(s);
        if (norm) set.add(norm);
        const mig = migrateKey(s);
        if (mig) set.add(mig as PermissionKey);
        if (s.includes(".")) {
          set.add(s.replace(/\./g, ":") as PermissionKey);
        } else if (s.includes(":")) {
          set.add(s.replace(/:/g, ".") as PermissionKey);
        }
      }
      return set;
    }

    // Local unauthenticated mock / demo fallback
    if (!activeMembership || !activeOrganization) return new Set<PermissionKey>();
    return effectivePermissions(activeMembership, activeOrganization);
  }, [userPermissionsData, activeMembership, activeOrganization]);

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
      isDriverMembership,
      isDriverAccount,
      density,
      setDensity: setDensityState,
      switchOrganization,
    }),
    [user, memberships, organizations, activeMembership, activeOrganization, permissions, isDriverMembership, isDriverAccount, density, switchOrganization],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
