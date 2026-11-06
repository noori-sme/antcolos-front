# 05 — Auth screens through the service layer (F0.4)

```
Status:   implemented and reviewed (product owner: "continue … with your default recommendation")
Branch:   claude/magical-mccarthy-pgmh3z
Track:    Feature (auth/onboarding area per routing-auth rule), approved under the standing default
Backend:  ../antcolos/src/modules/identity/controllers/{auth,signup,onboarding-auth}.controller.ts,
          dto/user-response.dto.ts; docs/requirements/{signup-api-contract,carrier-onboarding,carrier-lookup}.md
Milestone: F0.4 in ../antcolos/docs/product/milestones.md
Updated:  2026-11-06
```

## Summary

Ten `features/auth` files called `apiClient` directly and parsed guessed response shapes
(`data.user || data.data?.user || …`, `access_token`, `data.message`). The calls now go through
a typed module and feature hooks. The screens' success handling (cookies, redirects, toasts)
is unchanged.

## Endpoint → function → hook

| Endpoint | `authApi` (lib/session/auth-api.ts) | Hook (features/auth/hooks.ts) | Screen |
| --- | --- | --- | --- |
| `POST /auth/login` | `login` | `useLogin` | sign-in |
| `POST /auth/signup` | `signup` | `useSignup` | step-details |
| `POST /auth/verify-email` | `verifyEmail` | `useVerifyEmail` | verify-email modal |
| `POST /auth/resend-verification` | `resendVerification` | `useResendVerification` | step-verify, unverified modal |
| `GET /auth/username-available` | `usernameAvailable` | `useCheckUsername` | step-username, username-field |
| `POST /auth/username` | `chooseUsername` | `useChooseUsername` | step-username |
| `POST /auth/select-role` | `selectRole` | `useSelectRole` | onboarding |
| `POST /auth/company-details` | `companyDetails` | `useCompanyDetails` | dispatch-creation |
| `POST /auth/carrier-onboarding` | `carrierOnboarding` | `useCarrierOnboarding` | carrier-verification (submit, resend) |
| `GET /carriers/lookup` | `lookupCarrier` | `useCarrierLookup` | carrier-verification |

## Decisions (defaults)

| # | Decision | Why |
| --- | --- | --- |
| A | **`lib/session/auth-api.ts`, not a `contracts/` service.** No `ServiceContext`. | These calls run before there is a tenant, and the data-layer rule forbids a second ctx-less service. The session layer may already import `apiClient` and owns the token. |
| B | **`toAuthResult` follows the contract** `{ user, accessToken }`; `nextStep` is read from an onboarding-scope user, `null` otherwise. The envelope fallbacks are gone. | The backend returns exactly that shape (`AuthResponseDto`). |
| C | **Carrier lookup key** is `[...orgKey("public"), "carriers", "lookup", { mc, dot }]`. | Public FMCSA data; still under the org-key prefix, and sign-in clears every query. |
| D | **Identifiers and phone are sent as strings** (contract `@IsString`), MC/DOT normalized to digits (`carrierOnboardingInput` in `rules.ts`, tested). Onboarding sends both when both are known (the contract allows it); the lookup sends one, MC first. Before, the UI sent `Number(…)`, so "MC-123" became NaN and leading zeros were lost. | Contract fidelity. |
| E | `acceptance-screen` (invitation accept) keeps its own `apiClient` call. | It is a session switch, outside this flow (ARCHITECTURE drift item). |

## Verification

- Mapper tests: `src/lib/session/auth-api.test.ts` (contract examples).
- Live: `tests/browser/auth-flow.live.spec.ts`: sign-in (request body, lands on /home),
  wrong password, sign-up then resend (request bodies). Fleet and people live specs re-run green.
- Not covered live: verify-email, username, select-role, company details and carrier
  onboarding (the local stack sends no readable verification email). Typecheck covers the shapes.
- Baseline, not caused here: `tests/browser/landing-auth-boundary.spec.ts` fails 8/8 in mock
  mode on the F0.3 commit too.
- vitest 2163 pass, node 805 pass, build ok, lint 41 errors / 84 warnings (baseline 48 / 86).

## Review (frontend-reviewer, 2026-11-06)

- No blocking findings.
- Should-fix, fixed: MC/DOT were sent unnormalized ("MC-123" fails the backend pattern), so
  they now go through `normalizeMcNumber` / `normalizeDotNumber` for onboarding and lookup.
  Onboarding sends both identifiers again, as before and as the contract allows.
- Nits, fixed: the public lookup key's comment; the fixture cast in the mapper test.
- Nits, left: `useSelectRole` takes a mapper; the dead `if (token)` / `if (user)` guards in
  sign-in; the resend still saves the props instead of what was sent (all pre-existing or harmless).

## Not changed (noticed)

- Sign-in decides the driver home by comparing a role name (`isDriver`), against rule 3.
  It belongs with the session-ids fix (fixture ids in http mode), Feature track.
- `step-details` strips a `+91` prefix from the phone; the backend expects a US number.

## Backend asks

None.
