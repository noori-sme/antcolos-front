"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { fetchAndStoreUserPermissions } from "@/lib/session/permissions-sync";
import Cookies from "js-cookie";
import { Button } from "@/components/ui/button";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export function VerifyEmailModal({
  token,
  onClose,
}: {
  token: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [activeToken, setActiveToken] = useState(token);
  const [mountTime] = useState(() => Date.now());

  useEffect(() => {
    if (token && token !== activeToken) {
      setActiveToken(token);
    }
  }, [token, activeToken]);

  const verifyMutation = useMutation({
    mutationFn: async (tokenToVerify: string) => {
      const { data } = await apiClient.post("/auth/verify-email", { token: tokenToVerify });
      return data;
    },
    onSuccess: (data) => {
      if (data.user?.emailVerified) {
        if (data.user?.nextStep === "choose-username") {
          toast.success("Email verified successfully! 🎉 Now let's pick a unique username.");
        } else if (data.user?.nextStep) {
          toast.success("Email verified successfully! 🎉 Let's continue setting up your account.");
        } else {
          toast.success("Email verified successfully! 🎉 Welcome back to Antcolos.");
        }
      }
    },
    onError: () => {
      // Stay on the current page to show the error message, but redirect to sign-in after a delay
      const pathname = typeof window !== "undefined" ? window.location.pathname : "/sign-in";
      router.replace(pathname, { scroll: false });
      
      setTimeout(() => {
        router.push("/sign-in");
      }, 3000);
    }
  });

  useEffect(() => {
    if (activeToken && !verifyMutation.isPending && !verifyMutation.isSuccess && !verifyMutation.isError) {
      verifyMutation.mutate(activeToken);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeToken]);

  const handleClose = () => {
    setActiveToken(null);
    onClose();
  };

  const handleSuccessAction = () => {
    const user = verifyMutation.data?.user;
    
    setActiveToken(null);
    onClose();

    if (user?.nextStep === "choose-username") {
      sessionStorage.setItem("antcolos_signup_step", "username");
      sessionStorage.setItem("antcolos_signup_email", user.email);
      sessionStorage.setItem("antcolos_signup_from_login", "true");
      router.push("/sign-up");
      return;
    }
    
    if (user?.nextStep === "carrier-onboarding") {
      router.push("/onboarding?step=carrier");
      return;
    }
    
    if (user?.nextStep === "select-role") {
      router.push("/onboarding?step=role");
      return;
    }

    if (user?.nextStep === "verify-carrier") {
      router.push("/onboarding?step=verify-carrier");
      return;
    }

    if (!user?.nextStep) {
      const token =
        verifyMutation.data?.accessToken ||
        verifyMutation.data?.access_token ||
        verifyMutation.data?.token ||
        verifyMutation.data?.data?.accessToken ||
        Cookies.get("antcolos_token");
      if (token) {
        fetchAndStoreUserPermissions(queryClient, token);
      }
      router.push("/home");
      return;
    }
    
    // Fallback if none matched
    const pathname = typeof window !== "undefined" ? window.location.pathname : "/sign-in";
    if (pathname === "/verify-email") {
      router.push("/sign-in");
    }
  };

  return (
    <DialogPrimitive.Root open={!!activeToken} onOpenChange={(open) => !open && handleClose()}>
      <AnimatePresence>
        {!!activeToken && (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 z-50 bg-black/50"
              />
            </DialogPrimitive.Overlay>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
              <DialogPrimitive.Content asChild forceMount>
                <motion.div
                  initial={{ opacity: 0, scale: 0.9, y: -20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: -20 }}
                  transition={{ type: "spring", damping: 25, stiffness: 300 }}
                  className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-e3 outline-none pointer-events-auto text-center"
                >
                  {verifyMutation.isPending || verifyMutation.isIdle ? (
                    <div className="flex flex-col items-center justify-center py-6 space-y-4">
                      <Loader2 className="size-10 text-primary animate-spin" />
                      <DialogPrimitive.Title className="text-[1.125rem] font-semibold text-fg">
                        Verifying Email...
                      </DialogPrimitive.Title>
                      <DialogPrimitive.Description className="text-[0.875rem] text-fg-muted">
                        Please wait while we confirm your email address.
                      </DialogPrimitive.Description>
                    </div>
                  ) : verifyMutation.isSuccess ? (
                    <div className="flex flex-col items-center justify-center py-4 space-y-4">
                      <div className="flex size-12 items-center justify-center rounded-full bg-st-success-bg text-st-success">
                        <CheckCircle2 className="size-6" />
                      </div>
                      <DialogPrimitive.Title className="text-[1.125rem] font-semibold text-fg">
                        Email Verified
                      </DialogPrimitive.Title>
                      <DialogPrimitive.Description className="text-[0.875rem] text-fg-muted">
                        Your email address has been successfully verified. You can now sign in to your account.
                      </DialogPrimitive.Description>
                      <Button className="w-full mt-4" onClick={handleSuccessAction}>
                        Continue
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-4 space-y-4">
                      <div className="flex size-12 items-center justify-center rounded-full bg-st-danger-bg text-st-danger">
                        <XCircle className="size-6" />
                      </div>
                      <DialogPrimitive.Title className="text-[1.125rem] font-semibold text-fg">
                        Verification Failed
                      </DialogPrimitive.Title>
                      <DialogPrimitive.Description className="text-[0.875rem] text-fg-muted">
                        {verifyMutation.error?.message || "Email verification token is invalid or expired."}
                      </DialogPrimitive.Description>
                      <div className="mt-4 flex w-full flex-col items-center justify-center space-y-3">
                        <div className="flex items-center space-x-2 text-sm text-fg-muted">
                          <Loader2 className="size-4 animate-spin" />
                          <span>Redirecting to Sign In page...</span>
                        </div>
                        <Button variant="outline" className="w-full" onClick={() => router.push("/sign-in")}>
                          Go to Sign In now
                        </Button>
                      </div>
                    </div>
                  )}
                </motion.div>
              </DialogPrimitive.Content>
            </div>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}
