import { apiClient } from "@/lib/api/client";
import type {
  AccountType, AuthResult, AuthUser, CarrierOnboardingInput, CarrierProfile,
  CompanyDetailsInput, LoginInput, SignupInput,
} from "@/types/auth";

/**
 * Sign-in, sign-up and onboarding calls (plan 05, F0.4).
 *
 * These run before there is a tenant, so unlike the services in
 * `lib/api/contracts` they take no `ServiceContext`: there is no organization
 * to scope by. They live in the session layer because they create and replace
 * the session token. The client interceptor stores each `accessToken`.
 *
 * The invitation acceptance screen still calls `apiClient` itself (it is a
 * session switch, not a step of this flow).
 */

type AuthResponseDto = { user: AuthUser; accessToken: string };

export function toAuthResult(dto: AuthResponseDto): AuthResult {
  return {
    user: dto.user,
    accessToken: dto.accessToken,
    nextStep: dto.user.scope === "onboarding" ? dto.user.nextStep : null,
  };
}

type CarrierProfileDto = CarrierProfile & Record<string, unknown>;

export function toCarrierProfile(dto: CarrierProfileDto): CarrierProfile {
  return {
    dotNumber: dto.dotNumber,
    mcNumber: dto.mcNumber,
    legalName: dto.legalName,
    dbaName: dto.dbaName,
    email: dto.email,
    active: dto.active,
    address: { city: dto.address.city, state: dto.address.state, country: dto.address.country },
  };
}

async function postAuth(path: string, body: unknown): Promise<AuthResult> {
  const { data } = await apiClient.post<AuthResponseDto>(path, body);
  return toAuthResult(data);
}

export const authApi = {
  login: (input: LoginInput) => postAuth("/auth/login", input),
  verifyEmail: (token: string) => postAuth("/auth/verify-email", { token }),
  /** Public. The token from the FMCSA email link; answers with a tenant session. */
  verifyCarrier: (token: string) => postAuth("/auth/verify-carrier", { token }),
  chooseUsername: (username: string) => postAuth("/auth/username", { username }),
  selectRole: (accountType: AccountType) => postAuth("/auth/select-role", { accountType }),
  companyDetails: (input: CompanyDetailsInput) => postAuth("/auth/company-details", input),
  carrierOnboarding: (input: CarrierOnboardingInput) => postAuth("/auth/carrier-onboarding", input),

  /** Creates the account; nothing is signed in until the email is verified. */
  async signup(input: SignupInput): Promise<{ message: string }> {
    const { data } = await apiClient.post<{ message: string }>("/auth/signup", input);
    return { message: data.message };
  },

  /** Generic answer whether or not the account exists. */
  async resendVerification(email: string): Promise<{ message: string }> {
    const { data } = await apiClient.post<{ message: string }>("/auth/resend-verification", { email });
    return { message: data.message };
  },

  async usernameAvailable(username: string): Promise<boolean> {
    const { data } = await apiClient.get<{ available: boolean }>("/auth/username-available", {
      params: { username },
    });
    return data.available;
  },

  /** Public FMCSA lookup by MC or DOT (one of them). */
  async lookupCarrier(query: { mc?: string; dot?: string }): Promise<CarrierProfile> {
    const params = query.mc ? { mc: query.mc } : { dot: query.dot };
    const { data } = await apiClient.get<CarrierProfileDto>("/carriers/lookup", { params });
    return toCarrierProfile(data);
  },
};
