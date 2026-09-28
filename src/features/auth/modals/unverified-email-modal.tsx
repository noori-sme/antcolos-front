"use client";

import { useState, useEffect } from "react";
import { MailCheck, RefreshCcw, Clock, ArrowLeft } from "lucide-react";

import { useMutation } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "framer-motion";

export function UnverifiedEmailModal({
  email,
  onClose,
}: {
  email: string | null;
  onClose: () => void;
}) {
  const [cooldown, setCooldown] = useState(0);

  const resendMutation = useMutation({
    mutationFn: async (targetEmail: string) => {
      const { data } = await apiClient.post("/auth/resend-verification", { email: targetEmail });
      return data;
    },
    onSuccess: () => {
      toast.success("Verification link sent! Check your inbox.");
      setCooldown(30);
    },
    onError: (error) => {
      toast.error(error.message || "Failed to resend link.");
    }
  });

  useEffect(() => {
    if (email && cooldown === 0 && !resendMutation.isPending && !resendMutation.isSuccess) {
      resendMutation.mutate(email);
    }
  }, [email]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((c) => c - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  function handleResend() {
    if (cooldown > 0 || !email) return;
    resendMutation.mutate(email);
  }

  return (
    <DialogPrimitive.Root open={!!email} onOpenChange={(open) => !open && onClose()}>
      <AnimatePresence>
        {!!email && (
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
                  className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-e3 outline-none pointer-events-auto"
                >
                  <DialogPrimitive.Title className="text-[1rem] font-semibold text-fg">
                  Verification Required
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="mt-1 text-[0.8125rem] text-fg-muted">
                  You need to verify your email address before signing in.
                </DialogPrimitive.Description>

                <div className="mt-7 space-y-6">
                  <div className="relative flex flex-col items-center justify-center space-y-4 rounded-md border border-st-success/50 bg-surface-sunken p-6 text-center">
                    <div className="flex size-12 absolute top-[-24px] items-center justify-center rounded-full bg-st-success-bg text-st-success">
                      <MailCheck className="size-6" />
                    </div>
                    <div className="space-y-1.5 pt-2">
                      <p className="text-[0.875rem] leading-relaxed text-fg-muted">
                        We have sent a secure verification link to{" "}
                        <span className="font-medium text-fg">{email}</span>
                      </p>
                      <p className="text-[0.875rem] leading-relaxed text-fg-muted">
                        Please check your inbox and click the link to confirm your account.
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full sm:w-auto"
                      onClick={onClose}
                    >
                      <ArrowLeft className="mr-2 size-4" />
                      Back
                    </Button>

                    <Button
                      type="button"
                      variant="primary"
                      className="w-full sm:w-auto"
                      onClick={handleResend}
                      disabled={resendMutation.isPending || cooldown > 0}
                    >
                      {resendMutation.isPending ? (
                        <>
                          <RefreshCcw className="mr-2 size-4 animate-spin" />
                          Sending...
                        </>
                      ) : cooldown > 0 ? (
                        <>
                          <Clock className="mr-2 size-4" />
                          Resend in <span className="tabular-nums">{String(cooldown).padStart(2, "0")}</span>s
                        </>
                      ) : (
                        <>
                          <RefreshCcw className="mr-2 size-4" />
                          Resend verification link
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </motion.div>
            </DialogPrimitive.Content>
            </div>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}
