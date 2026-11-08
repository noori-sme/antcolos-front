import type { OrgPerson } from "@/types/org-people";

export type TeamRosterRole = "Driver" | "Dispatcher" | "Admin";

/** One existing member, as the invite flow's "existing user" picker lists them. */
export interface TeamRosterMember {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: TeamRosterRole;
  status: string;
  firstName: string;
  lastName: string;
}

/**
 * Merge the drivers, dispatchers and admins lists into one roster, in that
 * order. A person in several lists appears once (first list wins, matched by
 * email). A list that failed or was not loaded is passed as `undefined` and
 * simply contributes nobody. People without an email are skipped.
 */
export function toTeamRoster(lists: {
  drivers?: readonly OrgPerson[];
  dispatchers?: readonly OrgPerson[];
  admins?: readonly OrgPerson[];
}): TeamRosterMember[] {
  const seen = new Set<string>();
  const members: TeamRosterMember[] = [];
  const add = (people: readonly OrgPerson[] | undefined, role: TeamRosterRole) => {
    for (const p of people ?? []) {
      const email = p.email;
      if (!email || seen.has(email.toLowerCase())) continue;
      seen.add(email.toLowerCase());
      members.push({
        id: p.userId || email,
        userId: p.userId,
        name: [p.firstName, p.lastName].filter(Boolean).join(" ") || p.name || email,
        email,
        role,
        status: p.accountStatus || "ACTIVE",
        firstName: p.firstName,
        lastName: p.lastName,
      });
    }
  };
  add(lists.drivers, "Driver");
  add(lists.dispatchers, "Dispatcher");
  add(lists.admins, "Admin");
  return members;
}
