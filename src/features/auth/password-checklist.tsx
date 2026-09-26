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
  const metCount = PASSWORD_REQUIREMENTS.filter((r) => r.test(value)).length;
  const totalCount = PASSWORD_REQUIREMENTS.length;
  
  let strengthLabel = "Weak";
  let strengthColor = "bg-st-danger";
  let segmentsToFill = 1;

  if (value.length === 0) {
    strengthLabel = "None";
    strengthColor = "bg-border";
    segmentsToFill = 0;
  } else if (metCount === totalCount) {
    strengthLabel = "Strong";
    strengthColor = "bg-st-success";
    segmentsToFill = 4;
  } else if (metCount >= 3) {
    strengthLabel = "Good";
    strengthColor = "bg-st-info";
    segmentsToFill = 3;
  } else if (metCount >= 2) {
    strengthLabel = "Fair";
    strengthColor = "bg-st-warning";
    segmentsToFill = 2;
  }

  return (
    <div className="mt-2.5">
      {/* Strength Indicator */}
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-1.5 flex-1 gap-1">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div
              key={idx}
              className={cn(
                "h-full flex-1 rounded-full transition-colors duration-300",
                idx < segmentsToFill ? strengthColor : "bg-border"
              )}
            />
          ))}
        </div>
        <span className="w-12 text-right text-[0.6875rem] font-medium text-fg-muted uppercase tracking-wider">
          {strengthLabel}
        </span>
      </div>
    </div>
  );
}
