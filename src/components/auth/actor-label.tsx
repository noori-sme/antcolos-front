"use client";

import Link from "next/link";
import { useSession } from "@/lib/session/hooks";
import { useActiveMembership } from "@/lib/session/hooks";
import type { ActorRef } from "@/types";

/**
 * History stays readable after someone leaves. The name links to a profile
 * ONLY if that user is a current member of the organization you are viewing
 * from — otherwise it is plain text. You learn that a person did something;
 * you do not gain a route into their identity through an old record.
 */
export function ActorLabel({
  actor,
  members,
}: {
  actor: ActorRef;
  /** Current memberships of the active organization. */
  members?: { userId: string; membershipId: string }[];
}) {
  const { organization } = useActiveMembership();
  useSession();

  const current = members?.find((m) => m.userId === actor.userId);
  if (!current || !organization) {
    return <span className="text-fg">{actor.displayNameSnapshot}</span>;
  }
  return (
    <Link
      href={`/settings/users/${current.membershipId}`}
      className="text-fg underline-offset-4 hover:text-primary hover:underline"
    >
      {actor.displayNameSnapshot}
    </Link>
  );
}
