import axios, { type AxiosError, type InternalAxiosRequestConfig, type AxiosInstance } from "axios";
import { sessionTokenFrom } from "./session-token";
import {
  clearAllAuthCookies, clearNextStep, readCookie, setAccountKind, setNextStep, setSessionToken,
} from "./auth-cookies";

// Access the API URL from environment variables, falling back to a default
const API_URL = process.env.NEXT_PUBLIC_API_URL || "https://antcolos-staging.up.railway.app/api/v1";

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
      // Fetch token from cookies if available and Authorization header is not already provided
      const token = readCookie('antcolos_token');
      if (token && config.headers && !config.headers.Authorization) {
        config.headers.Authorization = `Bearer ${token}`;
      }
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

      // Do not trigger global logout for authentication endpoints
      const isAuthEndpoint = url.includes('/auth/login') || url.includes('/auth/register') || url.includes('/auth/verify-email');

      // Handle 401 Unauthorized globally (e.g., Token Refresh)
      if (error.response?.status === 401 && !originalRequest._retry && !isAuthEndpoint) {
        originalRequest._retry = true;

        try {
          // No refresh token logic implemented yet.
          // Forcefully log the user out and redirect to sign-in
          clearAllAuthCookies();
          window.location.href = '/sign-in';
          return Promise.reject(new Error(errorMessage));
        } catch (refreshError) {
          clearAllAuthCookies();
          window.location.href = '/sign-in';
          return Promise.reject(new Error(errorMessage));
        }
      }
      
      // We reject with a standard Error object so that Tanstack Query's error field is predictable
      return Promise.reject(new Error(errorMessage));
    }
  );
}

// Apply interceptors to both clients
setupInterceptors(apiClient);
setupInterceptors(fileApiClient);
