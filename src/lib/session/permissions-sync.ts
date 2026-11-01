import { apiClient, logoutDueToPermissionsError } from "@/lib/api/client";
import {
  readCookie, setPermissionCookies, setSessionToken, setUserRoleFromRoleId,
} from "@/lib/api/auth-cookies";
import type { QueryClient } from "@tanstack/react-query";

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
