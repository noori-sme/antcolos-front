"use client";

import { Lock } from "lucide-react";
import { useEffect } from "react";
import { useIsDriverAccount } from "@/lib/session/hooks";
import { cn } from "@/lib/utils";

export function LockedSection({ children, className, message, hideIcon }: { children: React.ReactNode, className?: string, message?: string, hideIcon?: boolean }) {
  const isDriver = useIsDriverAccount();

  if (!isDriver) {
    return <>{children}</>;
  }

  return (
    <div className={cn("relative overflow-hidden", className)}>
      <div className="pointer-events-none blur-md opacity-40 select-none transition-all duration-300 h-full w-full">
        {children}
      </div>
      
      {/* If there's a message, we center it on the entire viewport so it's always perfectly visible */}
      {message ? (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center space-y-4 pointer-events-none">
          {!hideIcon && (
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-sunken p-2 shadow-sm border border-border/50 text-fg-muted pointer-events-auto">
              <Lock className="h-6 w-6" />
            </div>
          )}
          <div className="text-center bg-surface-sunken/90 backdrop-blur-md px-6 py-4 rounded-xl border border-border shadow-sm max-w-sm pointer-events-auto">
            <h3 className="text-[1.125rem] font-semibold text-fg mb-1">Hi there!</h3>
            <p className="text-[0.875rem] text-fg-muted leading-relaxed">
              {message}
            </p>
          </div>
        </div>
      ) : (
        /* If no message (e.g. sidebar, topbar), center the lock within the container */
        !hideIcon && (
          <div className="absolute inset-0 z-[100] flex items-center justify-center pointer-events-none">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-sunken p-2 shadow-sm border border-border/50 text-fg-muted pointer-events-auto">
              <Lock className="h-6 w-6" />
            </div>
          </div>
        )
      )}
    </div>
  );
}

export function useIsDriver() {
  const isDriver = useIsDriverAccount();
  useEffect(() => {
    if (isDriver) {
      document.body.classList.add("overflow-hidden");
    } else {
      document.body.classList.remove("overflow-hidden");
    }
    
    return () => {
      document.body.classList.remove("overflow-hidden");
    };
  }, [isDriver]);
  return isDriver;
}
