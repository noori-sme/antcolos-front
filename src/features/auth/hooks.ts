"use client";

import { useMutation, useQuery, type UseMutationOptions } from "@tanstack/react-query";
import { orgKey } from "@/lib/query/keys";
import { authApi } from "@/lib/session/auth-api";
import type {
  AccountType, AuthResult, CarrierOnboardingInput, CompanyDetailsInput, LoginInput, SignupInput,
} from "@/types/auth";

/**
 * Data hooks for sign-in, sign-up and onboarding (plan 05). The screens keep
 * their own success handling (redirects, cookies), so each mutation hook takes
 * the usual `useMutation` options.
 */
type Options<TData, TVars> = Omit<UseMutationOptions<TData, Error, TVars>, "mutationFn">;

export const useLogin = (o?: Options<AuthResult, LoginInput>) =>
  useMutation({ ...o, mutationFn: authApi.login });
export const useSignup = (o?: Options<{ message: string }, SignupInput>) =>
  useMutation({ ...o, mutationFn: authApi.signup });
export const useVerifyEmail = (o?: Options<AuthResult, string>) =>
  useMutation({ ...o, mutationFn: authApi.verifyEmail });
export const useVerifyCarrier = (o?: Options<AuthResult, string>) =>
  useMutation({ ...o, mutationFn: authApi.verifyCarrier });
export const useResendVerification =(o?: Options<{ message: string }, string>) =>
  useMutation({ ...o, mutationFn: authApi.resendVerification });
export const useCheckUsername = (o?: Options<boolean, string>) =>
  useMutation({ ...o, mutationFn: authApi.usernameAvailable });
export const useChooseUsername = (o?: Options<AuthResult, string>) =>
  useMutation({ ...o, mutationFn: authApi.chooseUsername });
export const useSelectRole = <TVars>(
  toAccountType: (vars: TVars) => AccountType,
  o?: Options<AuthResult, TVars>,
) => useMutation({ ...o, mutationFn: (vars: TVars) => authApi.selectRole(toAccountType(vars)) });
export const useCompanyDetails = (o?: Options<AuthResult, CompanyDetailsInput>) =>
  useMutation({ ...o, mutationFn: authApi.companyDetails });
export const useCarrierOnboarding = (o?: Options<AuthResult, CarrierOnboardingInput>) =>
  useMutation({ ...o, mutationFn: authApi.carrierOnboarding });

/**
 * Public FMCSA data, deliberately outside any tenant: keyed under the
 * "public" pseudo-org (real org ids are UUIDs). Sign-in clears every query.
 * The lookup takes one of MC or DOT; MC wins.
 */
export function useCarrierLookup(mc: string, dot: string) {
  return useQuery({
    queryKey: [...orgKey("public"), "carriers", "lookup", { mc, dot }],
    queryFn: () => authApi.lookupCarrier(mc ? { mc } : { dot }),
    enabled: Boolean(mc || dot),
  });
}
