import axios, { type AxiosError, type InternalAxiosRequestConfig, type AxiosInstance } from "axios";
import { issuesSessionToken, sessionTokenFrom } from "./session-token";
import {
  clearAllAuthCookies, clearNextStep, setAccountKind, setNextStep, setSessionToken,
} from "./auth-cookies";

/**
 * Every call goes to this app's own origin (plan 27): `/api/backend/*` is
 * rewritten to the API by `src/proxy.ts`, which adds the session from an
 * httpOnly cookie; session-issuing calls go to `/api/session/*`, which stores
 * the tokens it receives in httpOnly cookies. The browser never holds a usable
 * token.
 */
const API_URL = "/api/backend";
const SESSION_URL = "/api/session";

/**
 * Production-ready Axios instance for standard JSON API requests.
 */
export const apiClient = axios.create({
  baseURL: API_URL,
  timeout: 15000, // 15 seconds timeout
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
});

/**
 * Dedicated Axios instance for File Uploads (multipart/form-data).
 * Features a longer timeout to accommodate larger file transfers.
 */
export const fileApiClient = axios.create({
  baseURL: API_URL,
  timeout: 60000, // 60 seconds timeout for file uploads
  headers: {
    "Content-Type": "multipart/form-data",
    Accept: "application/json",
  },
});

import { toast } from "sonner";

/**
 * Helper to make backend validation messages more user-friendly
 * ... (abridged) ...
 */
function formatErrorMessage(msg: string): string {
  if (!msg || typeof msg !== "string") return msg;

  const fieldMappings: Record<string, string> = {
    companyPhone: "Phone number",
    companyName: "Organization name",
    companyEmail: "Email address",
    legalOwnerName: "Owner name",
    addressLine1: "Address line 1",
    addressLine2: "Address line 2",
    postalCode: "Postal code",
  };

  let formatted = msg;
  for (const [key, value] of Object.entries(fieldMappings)) {
    if (formatted.startsWith(key)) {
      formatted = formatted.replace(key, value);
    } else {
      formatted = formatted.replace(new RegExp(`\\b${key}\\b`, "g"), value.toLowerCase());
    }
  }

  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

// Re-exported so existing imports keep working; the list lives in auth-cookies.ts.
export { clearAllAuthCookies };

export const logoutDueToPermissionsError = () => {
  clearAllAuthCookies();
  if (typeof window !== 'undefined') {
    sessionStorage.setItem("antcolos_pending_error_toast", "We could not verify your permissions. Please sign in again.");
    toast.error("We could not verify your permissions. Please sign in again.");
    if (window.location.pathname !== '/sign-in') {
      window.location.href = '/sign-in';
    }
  }
};

/**
 * Applies identical request/response interceptors to any given Axios instance.
 * Keeps auth and error handling DRY and consistent across both API clients.
 */
function setupInterceptors(client: AxiosInstance) {
  // Request Interceptor
  client.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
      // The session cookie authorizes the call server-side; a token in a
      // header would be ignored (and the readable cookie holds none).
      if (config.headers) delete config.headers.Authorization;
      if (issuesSessionToken(config.url ?? "")) config.baseURL = SESSION_URL;
      return config;
    },
    (error: AxiosError) => {
      return Promise.reject(error);
    }
  );

  // Response Interceptor
  client.interceptors.response.use(
    (response) => {
      const data = response.data;
      
      if (data && typeof data === 'object') {
        const url = response.config.url || '';

        // If permissions API returns an error structure or onboarding/invalid response
        if (url.includes('/users/me/permissions')) {
          const permData = data?.data || data;
          const isInvalidPermissions =
            !permData ||
            permData.error ||
            (typeof permData.statusCode === 'number' && permData.statusCode >= 400) ||
            permData.nextStep ||
            permData.user?.nextStep ||
            permData.scope === 'onboarding' ||
            permData.user?.scope === 'onboarding' ||
            (!permData.roleId && !permData.permissions && !permData.roleName);

          if (isInvalidPermissions) {
            logoutDueToPermissionsError();
            return Promise.reject(new Error("We could not verify your permissions. Please sign in again."));
          }
        }

        // Only session-issuing endpoints may replace the token. Other responses
        // can carry a `token` that is not a session (e.g. a new invitation's).
        const token = sessionTokenFrom(url, data);

        if (token) {
          setSessionToken(token);
        }

        // Check if this is an auth or onboarding related endpoint
        const isAuthOrOnboarding = url.includes('login') || url.includes('register') || url.includes('onboarding') || url.includes('auth');
        const isMutation = response.config.method?.toLowerCase() !== 'get';
        const nextStep = data.nextStep || data.user?.nextStep;
        
        if (nextStep) {
          setNextStep(nextStep);
        } else if (isAuthOrOnboarding && isMutation) {
          // Only remove nextStep if it's an auth/onboarding mutation call and nextStep is NOT provided (or is null)
          clearNextStep();
        }
        
        // If fully onboarded and the role is provided, save it
        const userObj = data.user || data;
        const individualRole = userObj.individualRole;
        const orgType = userObj.organizationType;
        const orgRole = userObj.role;

        if (!nextStep) {
          if (individualRole) {
            setAccountKind({ individualRole });
          } else if (orgType) {
            setAccountKind({ orgType, orgRole });
          }
        }
      }

      return response;
    },
    async (error: AxiosError) => {
      const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
      const url = originalRequest.url || '';

      // 401 first: renew the session once (shared by every request waiting on
      // it) and retry, before any handler below treats the 401 as a sign-out.
      // Even when the refresh is refused, retry once: another tab may have
      // renewed the session a moment ago. Only then fall through.
      const isSignInCall = url.includes('/auth/login') || url.includes('/auth/register') || url.includes('/auth/verify-email');
      if (error.response?.status === 401 && originalRequest && !originalRequest._retry && !isSignInCall) {
        originalRequest._retry = true;
        const outcome = await refreshSession();
        if (outcome === "ok") {
          return client.request(originalRequest);
        }
        if (outcome === "unavailable") {
          // The API could not renew it right now (rate limit, restart): keep
          // the session and let the caller retry later.
          return Promise.reject(new Error("Could not reach the server. Try again in a moment."));
        }
        // "expired": another tab may have rotated the session a moment ago and
        // its cookie may still be landing; give it a beat, then retry once.
        await new Promise((resolve) => setTimeout(resolve, 750));
        try {
          return await client.request(originalRequest);
        } catch (retryError) {
          // The retry's own 401 already went through the sign-out below.
          return Promise.reject(retryError instanceof Error ? retryError : new Error("Session expired. Please sign in again."));
        }
      }

      // Standardize error message extraction for React Query to consume
      let backendMessage = (error.response?.data as any)?.message;
      
      // NestJS validation pipe returns an array of messages
      if (Array.isArray(backendMessage)) {
        backendMessage = backendMessage[0]; // just show the first error
      }
      
      if (typeof backendMessage === 'string') {
        backendMessage = formatErrorMessage(backendMessage);
      }
      
      if (error.response?.status && error.response.status >= 500 || (typeof backendMessage === 'string' && backendMessage.toLowerCase().includes("internal server error"))) {
        backendMessage = "We're experiencing technical difficulties. Please try again later.";
      }
      
      const errorMessage = backendMessage || error.message || "An unexpected error occurred.";

      // If permissions API errors, log out and inform user
      if (url.includes('/users/me/permissions')) {
        logoutDueToPermissionsError();
        return Promise.reject(new Error("We could not verify your permissions. Please sign in again."));
      }

      const isMeEndpoint = url.includes('/auth/me') || url.includes('/auth/individual/me');
      if ((error.response?.status === 403 || error.response?.status === 401) && isMeEndpoint) {
        clearAllAuthCookies();
        toast.error("Session expired. Please sign in again.");
        window.location.href = '/sign-in';
        return Promise.reject(new Error("Session expired. Please sign in again."));
      }

      // Still 401 after the refresh above: the session is over. Sign-in calls
      // answer 401 for a wrong password, which is not a session ending.
      if (error.response?.status === 401 && !isSignInCall && typeof window !== 'undefined') {
        clearAllAuthCookies();
        window.location.href = '/sign-in';
      }

      // We reject with a standard Error object so that Tanstack Query's error field is predictable
      return Promise.reject(new Error(errorMessage));
    }
  );
}

export type RefreshOutcome = "ok" | "expired" | "unavailable";

let refreshing: Promise<RefreshOutcome> | null = null;

/** What a refresh answer means for the session. Only a 401 ends it. */
export function refreshOutcome(status: number | null): RefreshOutcome {
  if (status !== null && status >= 200 && status < 300) return "ok";
  return status === 401 ? "expired" : "unavailable";
}

function callRefresh(): Promise<RefreshOutcome> {
  return fetch(`${SESSION_URL}/auth/refresh`, { method: "POST", credentials: "same-origin" })
    .then((res) => refreshOutcome(res.status))
    .catch(() => refreshOutcome(null));
}

/**
 * One `POST /api/session/auth/refresh` at a time: shared by every request in
 * this tab, and serialized across tabs (Web Locks) so two tabs never present
 * the same refresh token at once and sign each other out.
 */
export function refreshSession(): Promise<RefreshOutcome> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!refreshing) {
    const run: Promise<RefreshOutcome> = locks
      // `then` flattens the lock's Promise<Promise<…>> typing.
      ? locks.request("antcolos-session-refresh", callRefresh).then((outcome) => outcome)
      : callRefresh();
    refreshing = run.finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

// Apply interceptors to both clients
setupInterceptors(apiClient);
setupInterceptors(fileApiClient);
