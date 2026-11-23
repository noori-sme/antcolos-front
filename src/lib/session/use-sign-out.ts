"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { clearAllAuthCookies } from "@/lib/api/auth-cookies";

/**
 * Signs out of this browser: auth cookies, the query cache, the signup
 * session keys; then /sign-in with a toast. Shared by the account menu and by
 * leaving the organization you are working in (plan 25), whose token stops
 * working on the next request.
 */
export function useSignOut() {
  const router = useRouter();
  const queryClient = useQueryClient();
  return useCallback(
    (toast = "Signed out successfully") => {
      clearAllAuthCookies();
      queryClient.clear();
      sessionStorage.removeItem("antcolos_signup_step");
      sessionStorage.removeItem("antcolos_signup_email");
      sessionStorage.removeItem("antcolos_signup_from_login");
      sessionStorage.setItem("antcolos_pending_toast", toast);
      router.push("/sign-in");
    },
    [queryClient, router],
  );
}
