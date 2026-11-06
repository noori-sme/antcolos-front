/**
 * Sign-in, sign-up and onboarding shapes (NestJS `/auth/*`, `/carriers/lookup`).
 * Source: ../antcolos/src/modules/identity/dto/{user-response,login,profile-signup,
 * select-role,company-details,carrier-onboarding}.dto.ts and
 * ../antcolos/docs/requirements/carrier-onboarding.md, carrier-lookup.md.
 */

export type OnboardingNextStep =
  | "verify-email"
  | "choose-username"
  | "select-role"
  | "company-details"
  | "carrier-onboarding"
  | "verify-carrier";

export type AccountType = "CARRIER" | "DISPATCHING_COMPANY" | "DISPATCHER" | "DRIVER";

export interface CarrierVerificationStatus {
  /** Masked FMCSA email the link went to. */
  email: string;
  expiresAt: string;
  expired: boolean;
}

interface AuthUserBase {
  id: string;
  email: string;
  name: string;
  username: string | null;
}

export interface TenantAuthUser extends AuthUserBase {
  scope: "tenant";
  organizationId: string;
  organizationType: "CARRIER" | "DISPATCHING_COMPANY";
  role: string;
}

export interface IndividualAuthUser extends AuthUserBase {
  scope: "individual";
  individualRole: "DISPATCHER" | "DRIVER";
}

export interface OnboardingAuthUser extends AuthUserBase {
  scope: "onboarding";
  emailVerified: boolean;
  pendingOrganizationType: "CARRIER" | "DISPATCHING_COMPANY" | null;
  nextStep: OnboardingNextStep;
  carrierVerification: CarrierVerificationStatus | null;
}

export type AuthUser = TenantAuthUser | IndividualAuthUser | OnboardingAuthUser;

/** Every token-issuing auth route returns this. The client interceptor stores the token. */
export interface AuthResult {
  user: AuthUser;
  accessToken: string;
  /** The onboarding step still to do; `null` once the account is a tenant or an individual. */
  nextStep: OnboardingNextStep | null;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface SignupInput {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  password: string;
  confirmPassword: string;
}

export interface CompanyDetailsInput {
  companyName: string;
  handle: string;
  legalOwnerName: string;
  companyEmail: string;
  companyPhone: string;
  companyAddress?: {
    addressLine1?: string;
    addressLine2?: string;
    postalCode?: string;
    city?: string;
    state?: string;
    country?: string;
  };
}

/** At least one of `mcNumber` / `dotNumber`; both when they name the same carrier. */
export interface CarrierOnboardingInput {
  legalOwnerName: string;
  mcNumber?: string;
  dotNumber?: string;
}

/** The fields of `GET /carriers/lookup` the onboarding screens show. */
export interface CarrierProfile {
  dotNumber: string;
  mcNumber: string | null;
  legalName: string | null;
  dbaName: string | null;
  email: string | null;
  active: boolean;
  address: { city: string | null; state: string | null; country: string | null };
}
