import type { Referral } from "@/types";
import { MOCK_USER } from "@/lib/session/fixtures";

/**
 * Two introductions, so both surfaces have something in them on first load.
 *
 * ★ NEITHER SEED ASSERTS A FACT IT COULD NOT HAVE OBSERVED ★
 * No seeded referral carries a `candidateUserId`, because nobody in a fixture
 * has claimed anything — writing one would fake the exact step the claim flow
 * exists to perform. No seeded referral carries a `resultingInvitationId` or a
 * `resultingEngagementId`, because no invitation and no engagement was made.
 * And the email records stop at `queued`: a fixture that claimed `delivered`
 * would be a fixture asserting that a provider confirmed a message nobody sent.
 *
 * ONE is addressed TO Northline, so the Owner's referral inbox and the Needs
 * You item are reviewable. ONE was made BY the demo user, so their own referral
 * history is not an empty state. They point in opposite directions on purpose:
 * the referrer's view and the company's view are different screens with
 * different rules about what they may show, and a fixture that only exercised
 * one of them would leave the other's privacy rules untested by eye.
 */

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const daysAhead = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

export function seedReferrals(): Referral[] {
  return [
    {
      id: "ref_seed_inbound",
      reference: "R-7QK2M",
      // Paige is a Northline dispatcher. A colleague introducing somebody is
      // the ordinary case, and it is still a referral rather than an
      // invitation: she holds no authority to bring anybody in.
      referrerUserId: "usr_paige",
      referrerNameSnapshot: "Paige Ellery",
      candidate: {
        fullName: "Marcus Whitfield",
        email: "marcus.whitfield@example.com",
        submittedEmail: "Marcus.Whitfield@example.com",
        phone: "+13125550177",
        submittedPhone: "(312) 555-0177",
      },
      // Free text, and not one of anything. It is what Paige typed.
      proposedTitle: "Dispatcher — nights",
      note: "Ran the night desk at his last carrier for four years. Knows the "
        + "Chicago lanes better than I do.",
      targetOrganizationId: "org_northline",
      targetOrganizationNameSnapshot: "Northline Freight",
      lookup: { kind: "username", submittedValue: "northline-freight" },
      lifecycle: "submitted",
      company: { state: "pending_review" },
      claim: { token: "REF-SEEDNORTHLINE01", expiresAt: daysAhead(11) },
      emails: [
        {
          id: "rmail_seed_1",
          kind: "candidate_invite",
          to: "marcus.whitfield@example.com",
          state: "queued",
          queuedAt: daysAgo(3),
        },
      ],
      createdAt: daysAgo(3),
      events: [
        {
          id: "rev_seed_1",
          at: daysAgo(3),
          kind: "submitted",
          summary: "Paige Ellery referred Marcus Whitfield to Northline Freight "
            + "for Dispatcher — nights.",
          actorName: "Paige Ellery",
        },
        {
          id: "rev_seed_2",
          at: daysAgo(3),
          kind: "email_queued",
          summary: "The introduction was queued to be emailed to the person.",
        },
      ],
    },
    {
      id: "ref_seed_outbound",
      reference: "R-3BX9T",
      referrerUserId: MOCK_USER.id,
      referrerNameSnapshot: MOCK_USER.displayName,
      candidate: {
        fullName: "Dana Okonkwo",
        email: "dana.okonkwo@example.com",
        submittedEmail: "dana.okonkwo@example.com",
        phone: "+16175550142",
        submittedPhone: "+1 617 555 0142",
      },
      proposedTitle: "Maintenance",
      targetOrganizationId: "org_baxter",
      targetOrganizationNameSnapshot: "Baxter Transit",
      lookup: { kind: "mc_number", submittedValue: "MC-1098447" },
      lifecycle: "submitted",
      company: { state: "pending_review" },
      claim: { token: "REF-SEEDBAXTER0001", expiresAt: daysAhead(6) },
      emails: [
        {
          id: "rmail_seed_2",
          kind: "candidate_invite",
          to: "dana.okonkwo@example.com",
          state: "queued",
          queuedAt: daysAgo(8),
        },
      ],
      createdAt: daysAgo(8),
      events: [
        {
          id: "rev_seed_3",
          at: daysAgo(8),
          kind: "submitted",
          summary: `${MOCK_USER.displayName} referred Dana Okonkwo to Baxter `
            + "Transit for Maintenance.",
          actorName: MOCK_USER.displayName,
        },
        {
          id: "rev_seed_4",
          at: daysAgo(8),
          kind: "email_queued",
          summary: "The introduction was queued to be emailed to the person.",
        },
      ],
    },
  ];
}
