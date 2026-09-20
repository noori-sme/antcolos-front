"use client";

import { EyeOff } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import type { ProfileSectionVisibility, ProfileView } from "@/types";
import { AchievementGrid } from "./achievement-grid";
import { MetricsGrid, SAFETY_SCORE_NOTE } from "./metrics-grid";
import { ProfileHeader } from "./profile-header";
import { WorkplaceTimeline } from "./workplace-timeline";

const WITHHELD_COPY: Record<keyof ProfileSectionVisibility, string> = {
  metrics: "This person does not publish their operational figures.",
  workplaces: "This person does not publish where they have worked.",
  achievements: "This person does not publish their milestones.",
};

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[0.9375rem] font-semibold text-fg">{title}</h2>
        {note ? <p className="text-[0.75rem] text-fg-subtle">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * A section the reader was not given.
 *
 * Rendered as a stated absence rather than omitted, because an omitted section
 * and an empty one look identical — and "this dispatcher has booked nothing" is
 * a very different claim from "this dispatcher keeps their figures to
 * themselves".
 */
function Withheld({ section }: { section: keyof ProfileSectionVisibility }) {
  return (
    <Card className="flex items-center gap-2.5 px-4 py-3 text-[0.8125rem] text-fg-muted">
      <EyeOff aria-hidden className="size-4 shrink-0 text-fg-subtle" />
      {WITHHELD_COPY[section]}
    </Card>
  );
}

/**
 * The profile, as everybody sees it.
 *
 * The SAME component renders the public page and the owner's own view — only
 * the actions differ. That is deliberate: a profile the owner sees through a
 * different renderer is a profile whose owner does not know what they are
 * publishing.
 */
export function ProfileBody({
  view,
  asOf,
  actions,
  aside,
}: {
  view: ProfileView;
  /** The instant this view was built. Periods are measured against it. */
  asOf: string;
  actions?: ReactNode;
  /** Owner-only controls, rendered under the header. */
  aside?: ReactNode;
}) {
  const withheld = new Set(view.withheld);
  const hasDriverMetrics = view.metrics?.some((m) => m.capacity === "driver");

  return (
    <div className="space-y-7">
      <ProfileHeader view={view} actions={actions} />

      {view.profile.bio ? (
        <p className="max-w-prose text-[0.875rem] leading-relaxed whitespace-pre-line text-fg-muted">
          {view.profile.bio}
        </p>
      ) : null}

      {view.profile.links.length > 0 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-[0.8125rem]">
          {view.profile.links.map((link) => (
            <li key={link.url}>
              <a
                href={link.url}
                target="_blank"
                // A profile link is somebody else's site: no referrer, no
                // window handle back to this page.
                rel="noopener noreferrer nofollow"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {link.label || link.url}
              </a>
            </li>
          ))}
        </ul>
      ) : null}

      {aside}

      <Section
        title="Record"
        note={hasDriverMetrics ? SAFETY_SCORE_NOTE : "Folded from recorded work, never typed in"}
      >
        {withheld.has("metrics") ? <Withheld section="metrics" /> : (
          <MetricsGrid metrics={view.metrics ?? []} />
        )}
      </Section>

      <Section title="Milestones">
        {withheld.has("achievements") ? <Withheld section="achievements" /> : (
          <AchievementGrid
            achievements={view.achievements ?? []}
            profile={view.profile}
            // The owner may always open the dialog — it is where they
            // are told their profile is not public yet. Everybody else
            // only gets a share button on a profile that actually renders
            // a card.
            shareable={view.isOwner || view.profile.visibility === "public"}
          />
        )}
      </Section>

      <Section title="Companies" note="Company names are snapshots, taken when the work started">
        {withheld.has("workplaces") ? <Withheld section="workplaces" /> : (
          <WorkplaceTimeline associations={view.workplaces ?? []} asOf={asOf} />
        )}
      </Section>
    </div>
  );
}
