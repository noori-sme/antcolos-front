import { Check } from "lucide-react";
import { PASSWORD_REQUIREMENTS } from "./rules";
import { cn } from "@/lib/utils";

/**
 * The live requirement checklist under the password field.
 *
 * Each row carries its own visually hidden "Met"/"Not met" so the list still
 * makes sense without color or icons. The list is not a live region — it
 * changes on nearly every keystroke, and announcing that would be unusable.
 * It is wired to the field through `aria-describedby` instead, so it is read
 * when the field takes focus.
 */
export function PasswordChecklist({ id, value }: { id: string; value: string }) {
  return (
    <ul id={id} className="mt-2.5 space-y-1.5">
      {PASSWORD_REQUIREMENTS.map((requirement) => {
        const met = requirement.test(value);
        return (
          <li key={requirement.id} className="flex items-center gap-2 text-[0.75rem]">
            <span
              aria-hidden
              className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors",
                met
                  ? "border-st-success bg-st-success text-white"
                  : "border-border-strong bg-surface-sunken",
              )}
            >
              {met ? <Check className="size-2.5" strokeWidth={3} /> : null}
            </span>
            <span className={cn("transition-colors", met ? "text-fg" : "text-fg-muted")}>
              {requirement.label}
            </span>
            <span className="sr-only">{met ? "— met" : "— not met"}</span>
          </li>
        );
      })}
    </ul>
  );
}
