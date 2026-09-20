import {
  RESPONSIBILITY_FUNCTION_LABEL,
  type PermissionKey, type ResponsibilityFunction,
  type WorkforceEngagement, type WorkforceFunctionGap,
} from "@/types";

/**
 * ★ WHAT A FUNCTION WOULD ORDINARILY NEED, AND NOTHING MORE ★
 *
 * An organization says somebody dispatches. Their seat cannot open the dispatch
 * board. That is worth NOTICING, and this file is the whole of how it is
 * noticed: a map from a kind of work to the catalog keys that work ordinarily
 * needs, and a pure function that subtracts what the seat already holds.
 *
 * ███ READ THIS BEFORE ADDING ANYTHING HERE ███
 *
 * This module is DISPLAY-ONLY and must stay that way. It does not grant, it is
 * not consulted by any authorization path, and nothing downstream may treat its
 * output as an entitlement. The direction matters and is easy to get backwards:
 *
 *   ✓ "You say Priya does the safety filing; her seat cannot open Compliance.
 *      Here is the way to Access."                    ← what this does
 *   ✗ "Priya does the safety filing, so give her `compliance:manage`."
 *                                                     ← a second authorization
 *                                                        system, forbidden
 *   ✗ "Priya holds `compliance:manage`, so she must do the safety filing."
 *                                                     ← inventing an HR fact
 *                                                        out of a permission
 *
 * The second and third are asserted against in `workforce-hr-foundation.test.ts`
 * and are the reason `functionsFromPermissions` does not exist.
 *
 * ★ WHY THE EXPECTATIONS ARE THE *VIEW* KEYS ★
 * A function gap should be raised when somebody plainly cannot do the job at
 * all, not when they cannot do every part of it. Listing `loads:assign` for
 * `dispatch` would flag every dispatcher a carrier has deliberately kept
 * read-only, and a gap list that cries wolf is a gap list people turn off.
 */
const EXPECTED: Record<ResponsibilityFunction, PermissionKey[]> = {
  dispatch: ["dispatch:view"],
  driver_action: ["proposals:view"],
  maintenance: ["maintenance:view"],
  compliance: ["compliance:view"],
  finance: ["invoices:view"],
  documents: ["documents:view"],
  safety: ["compliance:view"],
  administration: ["members:view"],
};

/** The functions a workspace may assign. The routing engine's vocabulary. */
export const ASSIGNABLE_FUNCTIONS: readonly ResponsibilityFunction[] = [
  "dispatch", "driver_action", "maintenance", "compliance",
  "finance", "documents", "safety", "administration",
];

/**
 * What performing this function ordinarily takes, for display beside the
 * checkbox that assigns it.
 *
 * "Ordinarily", not "requires": an organization is free to say somebody does
 * the paperwork for a function whose screens they never open, and this module
 * has no opinion about that beyond saying so.
 */
export function expectedPermissionsFor(
  functionKey: ResponsibilityFunction,
): readonly PermissionKey[] {
  return EXPECTED[functionKey];
}

/**
 * The functions this person performs that their access does not support.
 *
 * PURE, and derived on every read. Nothing is stored, so granting the key in
 * Access makes the gap disappear on the next render without this module being
 * told — the same rule the onboarding checklist keeps.
 *
 * `held` is the membership's EFFECTIVE permission set, computed by the access
 * system. This function never computes permissions itself and never reads a
 * template, a role name or a job title.
 */
export function functionGapsFor(
  engagement: Pick<WorkforceEngagement, "functions" | "membershipId">,
  held: ReadonlySet<PermissionKey> | undefined,
): WorkforceFunctionGap[] {
  const out: WorkforceFunctionGap[] = [];

  for (const assignment of engagement.functions) {
    const label = RESPONSIBILITY_FUNCTION_LABEL[assignment.functionKey];
    const expected = EXPECTED[assignment.functionKey];

    // No seat at all. Not a gap to be closed by granting a key — there is
    // nothing to grant it to — and saying "missing dispatch:view" about
    // somebody with no account would be nonsense on the screen.
    if (!engagement.membershipId || !held) {
      // `driver_action` is the one function a person genuinely performs
      // without ever signing in: a driver who never uses the app still drives.
      // Raising a gap for them would put an item in front of somebody that
      // nothing needs doing about.
      if (assignment.functionKey === "driver_action") continue;
      out.push({
        functionKey: assignment.functionKey,
        label,
        missing: [...expected],
        reason: `This organization says ${label.toLowerCase()} is part of what this person does, `
          + "and they hold no access to this workspace. Somebody without a seat cannot open the "
          + "screens the work happens on.",
        remedy: "invite_to_workspace",
      });
      continue;
    }

    const missing = expected.filter((key) => !held.has(key));
    if (missing.length === 0) continue;

    out.push({
      functionKey: assignment.functionKey,
      label,
      missing,
      reason: `This organization says ${label.toLowerCase()} is part of what this person does, `
        + "and their seat does not carry what that work ordinarily needs. Assigning a function "
        + "here has not changed their permissions and never will.",
      remedy: "grant_through_access",
    });
  }

  return out;
}
