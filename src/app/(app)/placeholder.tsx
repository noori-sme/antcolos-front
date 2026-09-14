import { Construction } from "lucide-react";
import { EmptyState } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";

/** Milestone 1 ships the shell. Each module lands as its own approved screen. */
export function ModulePlaceholder({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-section">
      <PageHeader title={title} description={description} />
      <EmptyState
        icon={Construction}
        title="Not built yet — preview test"
        description="The design system and app shell are the first milestone. This module is next in the queue and will be designed with you before it is built."
      />
    </div>
  );
}
