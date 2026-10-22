import Cookies from "js-cookie";
import { apiClient, logoutDueToPermissionsError } from "@/lib/api/client";
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
  const token = tokenOverride || Cookies.get("antcolos_token");
  if (!token) return null;

  try {
    if (tokenOverride) {
      Cookies.set("antcolos_token", tokenOverride, { path: "/", expires: 7 });
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

    if (data.roleId) {
      Cookies.set("antcolos_role_id", String(data.roleId), { path: "/", expires: 7 });
      Cookies.set("antcolos_user_role", String(data.roleId), { path: "/", expires: 7 });
    }
    if (data.roleName) {
      Cookies.set("antcolos_role_name", String(data.roleName), { path: "/", expires: 7 });
    }
    if (data.permissions) {
      const perms = Array.isArray(data.permissions)
        ? JSON.stringify(data.permissions)
        : String(data.permissions);
      Cookies.set("antcolos_permissions", perms, { path: "/", expires: 7 });
      Cookies.set("antcolos_user_permissions", perms, { path: "/", expires: 7 });
    }
    if (data.roleTemplate) {
      const tmpl = Array.isArray(data.roleTemplate)
        ? JSON.stringify(data.roleTemplate)
        : String(data.roleTemplate);
      Cookies.set("antcolos_role_template", tmpl, { path: "/", expires: 7 });
    }

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
