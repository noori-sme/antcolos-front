import { validateFullName } from "@/features/auth/rules";
import { validateCdlNumber, validateExpiryDate, validateState } from "./driver-rules";

/**
 * The four permanent things that make a driver profile, and the rules for them.
 *
 * There is exactly one driver profile per person, so there is exactly one place
 * that says what it is made of. Both ways in — accepting a carrier's invitation
 * and signing up as a driver on your own — read these rules, ask for the same
 * four things, and hand the same shape to the same create-or-resume call.
 */
export interface DriverIdentityDraft {
  legalName: string;
  cdlNumber: string;
  cdlState: string;
  /** As typed into <input type="date">: yyyy-mm-dd, or empty. */
  cdlExpiresAt: string;
}

export interface DriverIdentityErrors {
  legalName: string | null;
  cdlNumber: string | null;
  cdlState: string | null;
  cdlExpiresAt: string | null;
}

export const emptyDriverIdentity = (): DriverIdentityDraft => ({
  legalName: "",
  cdlNumber: "",
  cdlState: "",
  cdlExpiresAt: "",
});

export function driverIdentityErrors(draft: DriverIdentityDraft): DriverIdentityErrors {
  return {
    legalName: validateFullName(draft.legalName),
    cdlNumber: validateCdlNumber(draft.cdlNumber),
    cdlState: validateState(draft.cdlState),
    cdlExpiresAt: validateExpiryDate(draft.cdlExpiresAt, "expiration date"),
  };
}

export function driverIdentityIsComplete(draft: DriverIdentityDraft): boolean {
  return Object.values(driverIdentityErrors(draft)).every((e) => e === null);
}

/** The draft as the profile stores it: trimmed, upper-cased, and a real date. */
export function normalizeDriverIdentity(draft: DriverIdentityDraft) {
  return {
    legalName: draft.legalName.trim(),
    cdlNumber: draft.cdlNumber.trim().toUpperCase(),
    cdlState: draft.cdlState,
    cdlExpiresAt: draft.cdlExpiresAt
      ? new Date(`${draft.cdlExpiresAt}T00:00:00`).toISOString()
      : "",
  };
}
