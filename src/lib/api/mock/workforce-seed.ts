import type {
  ActorRef, WorkforceClassification, WorkforceEngagement,
  WorkforceEngagementState,
} from "@/types";
import { daysFromNow } from "./time";

/**
 * ███ MOCK FIXTURES — NOT A BACKEND ███
 *
 * Workforce engagements for the seeded world.
 *
 * ★ NOT ONE NEW PERSON ★
 * Every row below points at somebody Antcolos already has. The driver profile
 * ids are the driver registry's; the manager membership ids are the membership
 * directory's. That is the whole demonstration: an engagement says on what
 * basis a person who already exists works here, and inventing a second Dmitri
 * to hang it off would be the exact duplication this milestone refuses.
 *
 * The scenarios are chosen to make the boundaries testable rather than to fill
 * a screen:
 *
 *   Dmitri Kovalenko   an active company driver, the ordinary case.
 *   Marcus Hale        an owner-operator — a different classification over the
 *                      same shape of record, and a reminder that a settlement
 *                      is not a salary.
 *   Amir Haddad        active, and Safety has a rejected medical card on him,
 *                      so the onboarding checklist has something real to report
 *                      about a person who is already working.
 *   Kelsey Nguyen      ENDED. She is here because an ended engagement must stay
 *                      in history and must not be deleted.
 *   Tess Ferraro       an employee who is NOT a driver, and who holds a
 *                      membership. Her driver-shaped checklist rows resolve
 *                      not_applicable, which is decision 7 made visible.
 *   Priya Raman        an employee with NO Antcolos account and no membership,
 *                      which is the case that proves employment and access are
 *                      different things.
 */

const SYSTEM: ActorRef = {
  userId: "system",
  membershipId: "system",
  displayNameSnapshot: "Antcolos",
  source: "system",
};

interface SeedRow {
  id: string;
  organizationId: string;
  displayName: string;
  email?: string;
  userId?: string;
  driverProfileId?: string;
  membershipId?: string;
  classification: WorkforceClassification;
  state: WorkforceEngagementState;
  positionTitle: string;
  startedDaysAgo: number;
  endedDaysAgo?: number;
  endReason?: string;
  managerMembershipId?: string;
  managerName?: string;
  sourceLabel: string;
}

const ROWS: SeedRow[] = [
  {
    id: "weng_nl_dmitri",
    organizationId: "org_northline",
    displayName: "Dmitri Kovalenko",
    userId: "usr_dmitri",
    driverProfileId: "dp_dmitri",
    classification: "employee",
    state: "active",
    positionTitle: "Company driver",
    startedDaysAgo: 210,
    managerMembershipId: "mem_northline_safety",
    managerName: "Tess Ferraro",
    sourceLabel: "From the existing driver relationship with Northline Freight",
  },
  {
    id: "weng_nl_marcus",
    organizationId: "org_northline",
    displayName: "Marcus Hale",
    userId: "usr_marcus",
    driverProfileId: "dp_marcus",
    classification: "owner_operator",
    state: "active",
    positionTitle: "Owner-operator",
    startedDaysAgo: 200,
    managerMembershipId: "mem_northline_safety",
    managerName: "Tess Ferraro",
    sourceLabel: "From the existing driver relationship with Northline Freight",
  },
  {
    id: "weng_nl_amir",
    organizationId: "org_northline",
    displayName: "Amir Haddad",
    userId: "usr_amir",
    driverProfileId: "dp_amir",
    classification: "employee",
    state: "active",
    positionTitle: "Company driver",
    startedDaysAgo: 290,
    managerMembershipId: "mem_northline_safety",
    managerName: "Tess Ferraro",
    sourceLabel: "From the existing driver relationship with Northline Freight",
  },
  {
    id: "weng_nl_kelsey",
    organizationId: "org_northline",
    displayName: "Kelsey Nguyen",
    userId: "usr_kelsey",
    driverProfileId: "dp_kelsey",
    classification: "employee",
    state: "ended",
    positionTitle: "Company driver",
    startedDaysAgo: 180,
    endedDaysAgo: 60,
    endReason: "Left the carrier.",
    sourceLabel: "From the existing driver relationship with Northline Freight",
  },
  {
    // An employee who is not a driver, and who holds a seat. Her checklist's
    // driver-shaped rows resolve `not_applicable`.
    id: "weng_nl_tess",
    organizationId: "org_northline",
    displayName: "Tess Ferraro",
    userId: "usr_tess",
    membershipId: "mem_northline_safety",
    classification: "employee",
    state: "active",
    positionTitle: "Safety & compliance lead",
    startedDaysAgo: 420,
    sourceLabel: "Entered by hand when the workforce record was created",
  },
  {
    // ★ EMPLOYED, NO ACCOUNT ★
    // No `userId`, no `membershipId`. She works here and cannot sign in, which
    // is a real case and the one that proves employment is not access.
    id: "weng_nl_priya",
    organizationId: "org_northline",
    displayName: "Priya Raman",
    email: "priya.raman@example.com",
    classification: "employee",
    state: "active",
    positionTitle: "Yard hand",
    startedDaysAgo: 95,
    managerMembershipId: "mem_northline_safety",
    managerName: "Tess Ferraro",
    sourceLabel: "Entered by hand; this person has no Antcolos account",
  },
];

export function seedWorkforce(): WorkforceEngagement[] {
  return ROWS.map((row) => {
    const createdAt = daysFromNow(-row.startedDaysAgo - 14);
    const startDate = daysFromNow(-row.startedDaysAgo);
    const endDate = row.endedDaysAgo === undefined ? undefined : daysFromNow(-row.endedDaysAgo);

    const history: WorkforceEngagement["history"] = [
      {
        id: `${row.id}_created`,
        at: createdAt,
        kind: "created",
        summary: "Engagement created",
        detail: row.sourceLabel,
        actor: SYSTEM,
        toState: "onboarding",
      },
      {
        id: `${row.id}_activated`,
        at: startDate,
        kind: "activated",
        summary: `${row.displayName} started as ${row.positionTitle}`,
        actor: SYSTEM,
        fromState: "onboarding",
        toState: "active",
      },
    ];
    if (endDate) {
      history.push({
        id: `${row.id}_ended`,
        at: endDate,
        kind: "ended",
        summary: `Engagement ended: ${row.endReason}`,
        // Said in the fixture because it is the thing people assume otherwise.
        detail: "The driver profile, the documents they own and every historical record are kept.",
        actor: SYSTEM,
        fromState: "active",
        toState: "ended",
      });
    }

    return {
      id: row.id,
      organizationId: row.organizationId,
      person: {
        userId: row.userId,
        displayName: row.displayName,
        email: row.email,
        driverProfileId: row.driverProfileId,
      },
      driverProfileId: row.driverProfileId,
      classification: row.classification,
      state: row.state,
      positionTitle: row.positionTitle,
      startDate,
      endDate,
      managerMembershipId: row.managerMembershipId,
      managerName: row.managerName,
      membershipId: row.membershipId,
      carrierRelationshipId: row.driverProfileId
        ? `deng_${row.driverProfileId}_${row.organizationId}`
        : undefined,
      source: {
        kind: row.driverProfileId ? "existing_carrier_relationship" : "manual_entry",
        label: row.sourceLabel,
      },
      endReason: row.endReason,
      history,
      createdAt,
      updatedAt: endDate ?? startDate,
      version: history.length,
    } satisfies WorkforceEngagement;
  });
}
