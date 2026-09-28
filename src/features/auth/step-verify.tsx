"use client";

import { useState, useEffect } from "react";
import { MailCheck, RefreshCcw, Clock } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { toast } from "sonner";
import { BackLink } from "./controls";
import { Button } from "@/components/ui/button";

export function StepVerify({
  email,
  onVerified,
  onBack,
}: {
  email: string;
  onVerified: () => void;
  onBack: () => void;
}) {
  const [cooldown, setCooldown] = useState(0);

  const resendMutation = useMutation({
    mutationFn: async () => {
      const { data } = await apiClient.post("/auth/resend-verification", { email });
      return data;
    },
    onSuccess: () => {
      setCooldown(30);
    },
    onError: (error) => {
      toast.error(error.message || "Failed to resend link.");
    }
  });

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((c) => c - 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  function handleResend() {
    if (cooldown > 0) return;
    resendMutation.mutate();
  }

  const resending = resendMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-center justify-center space-y-4 rounded-md border border-st-success/50 bg-surface-sunken p-6 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-st-success-bg text-st-success">
          <MailCheck className="size-6" />
        </div>
        <div className="space-y-1.5">
          <p className="text-[0.875rem] leading-relaxed text-fg-muted">
            We've sent a secure verification link to{" "}
            <span className="font-medium text-fg">{email}</span>
          </p>
          <p className="text-[0.875rem] leading-relaxed text-fg-muted">
            Please click the link in that email to confirm your email address and continue.
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <Button
          type="button"
          variant="primary"
          className="w-full"
          onClick={handleResend}
          disabled={resending || cooldown > 0}
        >
          {resending ? (
            <>
              <RefreshCcw className="mr-2 size-4 animate-spin" />
              Sending...
            </>
          ) : cooldown > 0 ? (
            <>
              <Clock className="mr-2 size-4" />
              Link sent! Resend in <span className="tabular-nums">{String(cooldown).padStart(2, "0")}</span>s
            </>
          ) : (
            <>
              <RefreshCcw className="mr-2 size-4" />
              Resend verification link
            </>
          )}
        </Button>

        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={onVerified}
        >
          Continue to Step 3 (Dev only)
        </Button>
      </div>

      <div className="pt-2">
        <BackLink onClick={onBack} label="Use a different email" />
      </div>
    </div>
  );
}
