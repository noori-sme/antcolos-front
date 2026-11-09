import { apiClient, logoutDueToPermissionsError } from "@/lib/api/client";
import {
  clearPermissionCookies, readCookie, setAccountKind, setPermissionCookies, setSessionToken,
  setUserRoleFromRoleId,
} from "@/lib/api/auth-cookies";
import type { QueryClient } from "@tanstack/react-query";
import { hasOrganizationPermissions, sessionTokenIndividualRole } from "@/lib/api/session-token";

/** What a session without an organization holds: no organization permissions. A fresh object each time. */
export const noOrgPermissions = () => ({ permissions: [] as string[] });

/**
 * A session with no organization (individual, onboarding, platform) gets no
 * organization permissions. Drop any permission cookies a previous tenant
 * session left behind, then restore the account kind from the token's own
 * `individualRole` claim: clearing the permission cookies also removes the
 * cookie that marks an individual driver, and nothing else would put it back.
 */
export function applyNoOrgSession(token: string) {
  clearPermissionCookies();
  const individualRole = sessionTokenIndividualRole(token);
  if (individualRole) setAccountKind({ individualRole });
  return noOrgPermissions();
}

/**
 * Calls GET /users/me/permissions, stores relevant details (roleId, roleName,
 * permissions, user_permissions, roleTemplate) in cookies, and populates
 * the queryClient cache for 'userPermissions'.
 */
export async function fetchAndStoreUserPermissions(
  queryClient?: QueryClient,
  tokenOverride?: string,
) {
  const token = tokenOverride || readCookie("antcolos_token");
  if (!token) return null;

  // Individual, onboarding and platform sessions have no organization
  // permissions: the endpoint answers 403 for them by contract, which is not
  // a broken session. Answer "no permissions" instead of logging out.
  if (!hasOrganizationPermissions(token)) {
    if (tokenOverride) setSessionToken(tokenOverride);
    const none = applyNoOrgSession(token);
    queryClient?.setQueryData(["userPermissions"], none);
    return none;
  }

  try {
    if (tokenOverride) {
      setSessionToken(tokenOverride);
    }

    const config = {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    };

    const response = await apiClient.get("/users/me/permissions", config);
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
      if (queryClient) {
        queryClient.clear();
      }
      return null;
    }

    setPermissionCookies(data);
    if (data.roleId) setUserRoleFromRoleId(String(data.roleId));

    if (queryClient) {
      queryClient.setQueryData(["userPermissions"], data);
    }

    return data;
  } catch (err) {
    console.error("Failed to fetch user permissions:", err);
    logoutDueToPermissionsError();
    if (queryClient) {
      queryClient.clear();
    }
    return null;
  }
}
