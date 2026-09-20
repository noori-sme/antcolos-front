import { CompanyReferralInbox } from "@/features/referrals/company-inbox";
import { RequiresPermission } from "@/features/access/owner-guard";

export const metadata = { title: "Referrals" };

/**
 * The company side, gated on `referrals:review` — the one new permission this
 * feature introduces, and the smallest one that could carry it.
 *
 * Gating it on `invitations:create` instead would have meant only people who
 * can hand out access may read a name somebody sent in; gating it on
 * `workforce:view` would have meant an introduction is a working relationship,
 * which is exactly what it is not.
 */
export default function Page() {
  return (
    <RequiresPermission
      permission="referrals:review"
      title="You do not review referrals for this company"
    >
      <CompanyReferralInbox />
    </RequiresPermission>
  );
}
