import type { DriverProfile } from "@/types";
import { normalizeEmail, validateEmail } from "@/features/auth/rules";
import {
  type DriverIdentityDraft,
  driverIdentityErrors,
  driverIdentityIsComplete,
  normalizeDriverIdentity,
} from "./identity";
import { mockCreateOrGetDriverProfile, mockGetDriverProfile } from "./mock-driver";

/**
 * Signing up as a driver, with nobody's permission but your own.
 *
 * A driver is a person before they are anyone's driver. This step creates that
 * person's permanent Antcolos profile — and NOTHING else. Specifically it does
 * not create a carrier relationship, a membership, an assignment or an
 * employer, and it does not invent a carrier to hang them on: being a driver is
 * not the same as being hired, and the only thing that can connect the two is a
 * carrier's own invitation, accepted through the invitation flow that already
 * exists.
 *
 * Everything here funnels into `mockCreateOrGetDriverProfile`, the same
 * create-or-resume call the invitation flow uses. That is what stops a second
 * profile appearing for somebody who already has one: whichever door they came
 * through, there is one profile, and it is theirs.
 */

export interface DriverSelfOnboardingInput {
  /** The address the driver typed. Must already have been verified by code. */
  workEmail: string;
  /**
   * Whether the code sent to `workEmail` was actually checked and accepted.
   *
   * Passed explicitly rather than assumed: an unverified address is not an
   * approved one, and a profile must never be created on the strength of
   * somebody merely typing an address.
   */
  emailVerified: boolean;
  identity: DriverIdentityDraft;
}

export type DriverSelfOnboardingResult =
  | { status: "ok"; profile: DriverProfile; resumed: boolean }
  | { status: "email-invalid"; message: string }
  | { status: "email-unverified" }
  | { status: "identity-incomplete"; errors: ReturnType<typeof driverIdentityErrors> };

export async function completeDriverSelfOnboarding(
  input: DriverSelfOnboardingInput,
): Promise<DriverSelfOnboardingResult> {
  const emailProblem = validateEmail(input.workEmail);
  if (emailProblem) return { status: "email-invalid", message: emailProblem };
  if (!input.emailVerified) return { status: "email-unverified" };

  const workEmail = normalizeEmail(input.workEmail);

  // A driver who already has a profile is never asked for their licence again,
  // and never gets a second one. Their existing profile IS the answer.
  const existing = await mockGetDriverProfile();
  if (existing) {
    return { status: "ok", profile: existing, resumed: true };
  }

  if (!driverIdentityIsComplete(input.identity)) {
    return { status: "identity-incomplete", errors: driverIdentityErrors(input.identity) };
  }

  const profile = await mockCreateOrGetDriverProfile({
    ...normalizeDriverIdentity(input.identity),
    email: workEmail,
  });
  return { status: "ok", profile, resumed: false };
}

/** Whether this person still has to answer the licence questions. */
export async function driverNeedsIdentity(): Promise<boolean> {
  return (await mockGetDriverProfile()) === null;
}
