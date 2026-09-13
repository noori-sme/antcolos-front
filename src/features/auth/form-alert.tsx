import { CircleAlert, CircleCheck, Info } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const TONES = {
  danger: { icon: CircleAlert, box: "border-st-danger/35 bg-st-danger-bg/60", mark: "text-st-danger" },
  warning: { icon: CircleAlert, box: "border-st-warning/35 bg-st-warning-bg/60", mark: "text-st-warning" },
  success: { icon: CircleCheck, box: "border-st-success/35 bg-st-success-bg/60", mark: "text-st-success" },
  info: { icon: Info, box: "border-st-info/35 bg-st-info-bg/60", mark: "text-st-info" },
} as const;

/**
 * A form-level message — the kind that belongs to the whole form rather than a
 * single field ("Email or password is incorrect", "That code has expired").
 *
 * Errors are announced assertively; everything else politely. Announcements are
 * left to the caller's live region when it already owns one.
 */
export function FormAlert({
  tone,
  title,
  children,
  className,
  role = tone === "danger" ? "alert" : "status",
}: {
  tone: keyof typeof TONES;
  title: string;
  children?: ReactNode;
  className?: string;
  role?: "alert" | "status" | "none";
}) {
  const { icon: Icon, box, mark } = TONES[tone];
  return (
    <div
      role={role === "none" ? undefined : role}
      className={cn("flex gap-2.5 rounded-md border px-3 py-2.5", box, className)}
    >
      <Icon className={cn("mt-px size-4 shrink-0", mark)} aria-hidden />
      <div className="min-w-0 text-[0.8125rem] leading-relaxed">
        <p className="font-medium text-fg">{title}</p>
        {children ? <div className="mt-0.5 text-fg-muted">{children}</div> : null}
      </div>
    </div>
  );
}
