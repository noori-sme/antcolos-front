"use client";

import { Globe, Lock, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { cn } from "@/lib/utils";
import type { ProfileSectionVisibility, ProfileVisibility } from "@/types";

const CHOICES: Array<{
  value: ProfileVisibility;
  label: string;
  description: string;
  icon: LucideIcon;
}> = [
  {
    value: "public",
    label: "Public",
    description: "Anybody with the link. Share cards render. The only setting a preview works on.",
    icon: Globe,
  },
  {
    value: "signed-in",
    label: "Antcolos only",
    description: "Anybody signed in to Antcolos. Link previews outside show nothing.",
    icon: Users,
  },
  {
    value: "private",
    label: "Private",
    description: "Only you. To everybody else the handle answers as if it did not exist.",
    icon: Lock,
  },
];

const SECTIONS: Array<{ key: keyof ProfileSectionVisibility; label: string }> = [
  { key: "metrics", label: "Operational figures" },
  { key: "workplaces", label: "Companies" },
  { key: "achievements", label: "Milestones" },
];

/**
 * Who sees the profile, and which parts.
 *
 * ★ THE OWNER DECIDES, AND NOBODY ELSE CAN ★
 * There is no permission anywhere in Antcolos that overrides these switches.
 * The read path takes a viewer with no permissions at all, so an employer
 * holding every key in their own workspace still sees exactly what the person
 * published — see `contracts/profile.ts`.
 *
 * Changes save immediately. A profile privacy control behind a Save button is
 * a control people leave half-set.
 */
export function VisibilityControls({
  visibility,
  sections,
  onChange,
  disabled,
}: {
  visibility: ProfileVisibility;
  sections: ProfileSectionVisibility;
  onChange: (next: { visibility: ProfileVisibility; sections: ProfileSectionVisibility }) => void;
  disabled?: boolean;
}) {
  return (
    <Card className="px-4 py-4">
      <h2 className="text-[0.875rem] font-semibold text-fg">Profile visibility</h2>
      <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
        Nobody you work with can change these, and no permission overrides them.
      </p>

      <fieldset className="mt-3.5" disabled={disabled}>
        <legend className="sr-only">Who can see your profile</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {CHOICES.map((choice) => {
            const selected = visibility === choice.value;
            return (
              <button
                key={choice.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange({ visibility: choice.value, sections })}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  "disabled:pointer-events-none disabled:opacity-50",
                  selected
                    ? "border-primary bg-primary/[0.06]"
                    : "border-border bg-surface hover:border-border-strong hover:bg-surface-hover",
                )}
              >
                <span className="flex items-center gap-2 text-[0.8125rem] font-semibold text-fg">
                  <choice.icon aria-hidden className="size-4" />
                  {choice.label}
                </span>
                <span className="mt-1 block text-[0.75rem] leading-relaxed text-fg-muted">
                  {choice.description}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="mt-4">
        <p className="text-[0.75rem] font-medium tracking-wide text-fg-subtle uppercase">
          Sections other people see
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SECTIONS.map((section) => (
            <Chip
              key={section.key}
              label={section.label}
              selected={sections[section.key]}
              onToggle={() =>
                onChange({
                  visibility,
                  sections: { ...sections, [section.key]: !sections[section.key] },
                })
              }
            />
          ))}
        </div>
        <p className="mt-2 text-[0.75rem] leading-relaxed text-fg-subtle">
          A section you switch off is not shown as empty — the page says you keep it to
          yourself, so nobody reads a blank scoreboard as a bad one.
        </p>
      </div>
    </Card>
  );
}
