import Cookies from "js-cookie";

/**
 * Every browser cookie the session uses, and the only code that writes or
 * clears them. Screens call these helpers, never `Cookies.set` directly, so a
 * new cookie cannot be forgotten by sign-out.
 *
 * These cookies are readable by page scripts (js-cookie, not httpOnly). Moving
 * the token to an httpOnly cookie set by the server is a backend change.
 */
export const AUTH_COOKIE = {
  token: "antcolos_token",
  nextStep: "antcolos_next_step",
  userRole: "antcolos_user_role",
  orgType: "antcolos_org_type",
  orgRole: "antcolos_org_role",
  roleId: "antcolos_role_id",
  roleName: "antcolos_role_name",
  permissions: "antcolos_permissions",
  userPermissions: "antcolos_user_permissions",
  roleTemplate: "antcolos_role_template",
  carrierData: "antcolos_carrier_data",
  /** A pending invitation for someone not signed in yet. Survives sign-out. */
  invitationToken: "antcolos_invitation_token",
} as const;

type CookieName = (typeof AUTH_COOKIE)[keyof typeof AUTH_COOKIE];

const SESSION_DAYS = 7;
const BASE = { path: "/" } as const;
const SECURE =
  typeof window !== "undefined" && window.location.protocol === "https:";

function set(name: CookieName, value: string, days = SESSION_DAYS) {
  Cookies.set(name, value, { ...BASE, expires: days, sameSite: "lax", secure: SECURE });
}

function remove(name: CookieName) {
  Cookies.remove(name, BASE);
}

export function readCookie(name: CookieName): string | undefined {
  return Cookies.get(name);
}

export function setSessionToken(token: string) {
  set(AUTH_COOKIE.token, token);
}

export function setNextStep(step: string) {
  set(AUTH_COOKIE.nextStep, step);
}

export function clearNextStep() {
  remove(AUTH_COOKIE.nextStep);
}

/** Which kind of account is signed in: an individual (driver…) or an org admin. */
export function setAccountKind(
  kind: { individualRole: string } | { orgType: string; orgRole?: string } | null,
) {
  if (kind && "individualRole" in kind) {
    set(AUTH_COOKIE.userRole, kind.individualRole);
    remove(AUTH_COOKIE.orgType);
    remove(AUTH_COOKIE.orgRole);
  } else if (kind) {
    set(AUTH_COOKIE.orgType, kind.orgType);
    // A missing role must not leave the previous account's role behind.
    if (kind.orgRole) set(AUTH_COOKIE.orgRole, kind.orgRole);
    else remove(AUTH_COOKIE.orgRole);
    remove(AUTH_COOKIE.userRole);
  } else {
    remove(AUTH_COOKIE.userRole);
    remove(AUTH_COOKIE.orgType);
    remove(AUTH_COOKIE.orgRole);
  }
}

/**
 * Legacy: an invited member's `roleId` (e.g. "DRIVER") is also stored as the
 * user role, which the driver-account check reads. Kept as one named call so
 * it can be removed in one place when the backend exposes an account kind.
 */
export function setUserRoleFromRoleId(roleId: string) {
  set(AUTH_COOKIE.userRole, roleId);
}

/** Store what /users/me/permissions returned. */
export function setPermissionCookies(data: {
  roleId?: unknown;
  roleName?: unknown;
  permissions?: unknown;
  roleTemplate?: unknown;
}) {
  if (data.roleId) set(AUTH_COOKIE.roleId, String(data.roleId));
  if (data.roleName) set(AUTH_COOKIE.roleName, String(data.roleName));
  if (data.permissions) {
    const perms = Array.isArray(data.permissions)
      ? JSON.stringify(data.permissions)
      : String(data.permissions);
    set(AUTH_COOKIE.permissions, perms);
    set(AUTH_COOKIE.userPermissions, perms);
  }
  if (data.roleTemplate) {
    const tmpl = Array.isArray(data.roleTemplate)
      ? JSON.stringify(data.roleTemplate)
      : String(data.roleTemplate);
    set(AUTH_COOKIE.roleTemplate, tmpl);
  }
}

/** Drop the previous user's role and permissions before a new sign-in. */
export function clearPermissionCookies() {
  remove(AUTH_COOKIE.roleId);
  remove(AUTH_COOKIE.userRole);
  remove(AUTH_COOKIE.roleName);
  remove(AUTH_COOKIE.permissions);
  remove(AUTH_COOKIE.userPermissions);
  remove(AUTH_COOKIE.roleTemplate);
}

export function setCarrierData(json: string) {
  set(AUTH_COOKIE.carrierData, json, 1);
}

export function clearCarrierData() {
  remove(AUTH_COOKIE.carrierData);
}

export function setInvitationToken(token: string) {
  set(AUTH_COOKIE.invitationToken, token);
}

export function clearInvitationToken() {
  remove(AUTH_COOKIE.invitationToken);
}

/** Sign-out: every session cookie except a pending invitation. */
export function clearAllAuthCookies() {
  for (const name of Object.values(AUTH_COOKIE)) {
    if (name !== AUTH_COOKIE.invitationToken) remove(name);
  }
}
