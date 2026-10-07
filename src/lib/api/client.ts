import axios, { type AxiosError, type InternalAxiosRequestConfig, type AxiosInstance } from "axios";

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

import Cookies from "js-cookie";
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

/**
 * Applies identical request/response interceptors to any given Axios instance.
 * Keeps auth and error handling DRY and consistent across both API clients.
 */
function setupInterceptors(client: AxiosInstance) {
  // Request Interceptor
  client.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
      // Fetch token from cookies if available
      const token = Cookies.get('antcolos_token');
      if (token && config.headers) {
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
        // If accessToken is present in any response, update it
        if (data.accessToken) {
          Cookies.set('antcolos_token', data.accessToken, { expires: 7, path: '/' }); // 7 days
        }

        // Check if this is an auth or onboarding related endpoint
        const url = response.config.url || '';
        const isAuthOrOnboarding = url.includes('login') || url.includes('register') || url.includes('onboarding') || url.includes('auth');
        const isMutation = response.config.method?.toLowerCase() !== 'get';
        const nextStep = data.nextStep || data.user?.nextStep;
        
        if (nextStep) {
          Cookies.set('antcolos_next_step', nextStep, { expires: 7, path: '/' });
        } else if (isAuthOrOnboarding && isMutation) {
          // Only remove nextStep if it's an auth/onboarding mutation call and nextStep is NOT provided (or is null)
          Cookies.remove('antcolos_next_step', { path: '/' });
        }
        
        // If fully onboarded and the role is provided, save it
        const userObj = data.user || data;
        const individualRole = userObj.individualRole;
        const orgType = userObj.organizationType;
        const orgRole = userObj.role;

        if (!nextStep) {
          if (individualRole) {
            Cookies.set('antcolos_user_role', individualRole, { expires: 7, path: '/' });
            Cookies.remove('antcolos_org_type', { path: '/' });
            Cookies.remove('antcolos_org_role', { path: '/' });
          } else if (orgType) {
            Cookies.set('antcolos_org_type', orgType, { expires: 7, path: '/' });
            if (orgRole) {
              Cookies.set('antcolos_org_role', orgRole, { expires: 7, path: '/' });
            }
            Cookies.remove('antcolos_user_role', { path: '/' });
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

      const isMeEndpoint = url.includes('/auth/me') || url.includes('/auth/individual/me');
      if ((error.response?.status === 403 || error.response?.status === 401) && isMeEndpoint) {
        Cookies.remove('antcolos_token', { path: '/' });
        Cookies.remove('antcolos_next_step', { path: '/' });
        Cookies.remove('antcolos_user_role', { path: '/' });
        Cookies.remove('antcolos_org_type', { path: '/' });
        Cookies.remove('antcolos_org_role', { path: '/' });
        toast.error("Session expired. Please sign in again.");
        window.location.href = '/sign-in';
        return Promise.reject(new Error("Session expired. Please sign in again."));
      }

      // Do not trigger global logout for authentication endpoints
      const isAuthEndpoint = url.includes('/auth/login') || url.includes('/auth/register');

      // Handle 401 Unauthorized globally (e.g., Token Refresh)
      if (error.response?.status === 401 && !originalRequest._retry && !isAuthEndpoint) {
        originalRequest._retry = true;

        try {
          // No refresh token logic implemented yet.
          // Forcefully log the user out and redirect to sign-in
          Cookies.remove('antcolos_token', { path: '/' });
          Cookies.remove('antcolos_next_step', { path: '/' });
          Cookies.remove('antcolos_user_role', { path: '/' });
          Cookies.remove('antcolos_org_type', { path: '/' });
          Cookies.remove('antcolos_org_role', { path: '/' });
          window.location.href = '/sign-in';
          return Promise.reject(new Error(errorMessage));
        } catch (refreshError) {
          Cookies.remove('antcolos_token', { path: '/' });
          Cookies.remove('antcolos_next_step', { path: '/' });
          Cookies.remove('antcolos_user_role', { path: '/' });
          Cookies.remove('antcolos_org_type', { path: '/' });
          Cookies.remove('antcolos_org_role', { path: '/' });
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
