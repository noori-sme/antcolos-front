"use client";

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";

export function VerifyEmailModal({
  token,
  onClose,
}: {
  token: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [activeToken, setActiveToken] = useState(token);

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
    onSettled: () => {
      // Instantly remove token from URL when we get any response,
      // but activeToken keeps the modal open.
      router.replace("/sign-in", { scroll: false });
    }
  });

  useEffect(() => {
    if (activeToken) {
      verifyMutation.mutate(activeToken);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeToken]);

  const handleClose = () => {
    setActiveToken(null);
    onClose();
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
                      <Button className="w-full mt-4" onClick={handleClose}>
                        Sign in now
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
                      <Button variant="outline" className="w-full mt-4" onClick={handleClose}>
                        Close
                      </Button>
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
