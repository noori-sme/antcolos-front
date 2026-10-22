import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Field({
  label, htmlFor, hint, error, required, children, className,
}: {
  label: ReactNode;
  htmlFor: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-[0.8125rem] font-medium text-fg">
        {label}
        {required ? <span className="ml-1 text-st-danger">*</span> : null}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-[0.75rem] text-st-danger">{error}</p>
      ) : hint ? (
        <p className="text-[0.75rem] text-fg-subtle">{hint}</p>
      ) : null}
    </div>
  );
}
