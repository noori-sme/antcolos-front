import { ReferrerHistory } from "@/features/referrals/referrer-history";

export const metadata = { title: "Your referrals" };

/**
 * Under Account rather than under an organization, and that is the design.
 *
 * Referring somebody is an act of the PERSON, not of a seat: the referrer
 * usually has no membership in the company they are introducing somebody to,
 * and often belongs to no company at all. A screen that lived inside a
 * workspace would be a screen only members of that workspace could use, which
 * is the opposite of the feature.
 *
 * It needs no permission for the same reason.
 */
export default function Page() {
  return <ReferrerHistory />;
}
