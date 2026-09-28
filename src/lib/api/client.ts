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

/**
 * Applies identical request/response interceptors to any given Axios instance.
 * Keeps auth and error handling DRY and consistent across both API clients.
 */
function setupInterceptors(client: AxiosInstance) {
  // Request Interceptor
  client.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
      // Example: Fetch token from Zustand store or local storage
      // const token = useSessionStore.getState().token;
      // if (token && config.headers) {
      //   config.headers.Authorization = `Bearer ${token}`;
      // }
      return config;
    },
    (error: AxiosError) => {
      return Promise.reject(error);
    }
  );

  // Response Interceptor
  client.interceptors.response.use(
    (response) => {
      return response;
    },
    async (error: AxiosError) => {
      const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

      // Handle 401 Unauthorized globally (e.g., Token Refresh)
      if (error.response?.status === 401 && !originalRequest._retry) {
        originalRequest._retry = true;

        try {
          // Implement token refresh logic here:
          // const { data } = await axios.post(`${API_URL}/auth/refresh`);
          // useSessionStore.getState().setToken(data.token);
          // 
          // Update header for the original request and retry it:
          // originalRequest.headers.Authorization = `Bearer ${data.token}`;
          // return client(originalRequest);
          
          console.warn("Unauthorized: Please implement token refresh logic.");
        } catch (refreshError) {
          // If refresh fails, forcefully log the user out
          // useSessionStore.getState().clearSession();
          // window.location.href = '/login';
          return Promise.reject(refreshError);
        }
      }

      // Standardize error message extraction for React Query to consume
      const backendMessage = (error.response?.data as any)?.message;
      const errorMessage = backendMessage || error.message || "An unexpected error occurred.";
      
      // We reject with a standard Error object so that Tanstack Query's error field is predictable
      return Promise.reject(new Error(errorMessage));
    }
  );
}

// Apply interceptors to both clients
setupInterceptors(apiClient);
setupInterceptors(fileApiClient);
