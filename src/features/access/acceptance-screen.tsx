"use client";

import {
  Ban,
  Building2,
  CheckCircle2,
  CircleCheck,
  Clock,
  LoaderCircle,
  Mail,
  ShieldCheck,
  UserPlus,
  UserRound,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useMemo } from "react";
import Cookies from "js-cookie";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { AuthShell } from "@/features/auth/shell";
import { FormAlert } from "@/features/auth/form-alert";
import { PasswordField } from "@/features/auth/password-field";
import { PasswordChecklist } from "@/features/auth/password-checklist";
import { UsernameField, type UsernameAvailability } from "@/features/auth/username-field";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  isPasswordStrongEnough,
  USERNAME_RULES_TEXT,
  validateUsername,
} from "@/features/auth/rules";
import { PermissionSummary, SensitiveAccessWarning } from "./permission-summary";
import { QuickOnboarding } from "@/features/driver/quick-onboarding";
import { ENGAGEMENT_DESCRIPTION, ENGAGEMENT_LABEL } from "@/features/driver/driver-rules";
import { services } from "@/lib/api";
import { apiClient } from "@/lib/api/client";
import { fetchAndStoreUserPermissions } from "@/lib/session/permissions-sync";
import type {
  AcceptInput,
  AcceptingIdentity,
  InvitationLookup,
} from "@/lib/api/contracts/access";
import { useSession } from "@/lib/session/hooks";
import { readSessionScenario } from "@/lib/session/scenarios";
import {
  ACCEPTANCE_LIMITATION,
  ACCEPTANCE_STEP_LABEL,
  type AcceptanceRun,
  type Invitation,
} from "@/types";
import { cn } from "@/lib/utils";

interface ApiInvitationData {
  organizationName: string;
  email: string;
  firstName?: string;
  lastName?: string;
  roleId: string;
  roleName?: string;
  expiresAt?: string;
  existingUser: boolean;
  permissions?: string[];
}



/**
 * The screen an invitation link opens.
 *
 * Supports both real backend invitations (via GET /api/v1/invitations/accept/:token)
 * and mock invitations for development walkthroughs.
 */
export function InvitationAcceptanceScreen({ token: propToken }: { token?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useSession();

  // Resolve token from prop or cookie
  const [token, setToken] = useState<string>(() => {
    if (propToken) return propToken;
    if (typeof window !== "undefined") {
      return Cookies.get("antcolos_invitation_token") || "";
    }
    return "";
  });

  const identity = useMemo<AcceptingIdentity>(() => ({
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
    scenario: readSessionScenario(),
  }), [user]);

  // Strip /accept/[token] from URL and persist token in cookie
  useEffect(() => {
    const activeToken = propToken || token || Cookies.get("antcolos_invitation_token");
    if (activeToken) {
      Cookies.set("antcolos_invitation_token", activeToken, { expires: 7, path: "/" });
      if (activeToken !== token) {
        setToken(activeToken);
      }
    }
    // Clean up browser address bar to /invitations
    if (typeof window !== "undefined" && window.location.pathname.includes("/accept/")) {
      window.history.replaceState(null, "", "/invitations");
    }
  }, [propToken, token]);

  // Real backend invitation data
  const [apiInvitation, setApiInvitation] = useState<ApiInvitationData | null>(null);
  const [apiLoading, setApiLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRejected, setIsRejected] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  // New account form state
  const [username, setUsername] = useState("");
  const [usernameAvailability, setUsernameAvailability] = useState<UsernameAvailability>("idle");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Mock state fallback
  const [state, setState] = useState<InvitationLookup | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [run, setRun] = useState<AcceptanceRun | null>(null);
  const [collecting, setCollecting] = useState(false);
  const [declined, setDeclined] = useState<Invitation | null>(null);

  useEffect(() => {
    if (!token) {
      setApiLoading(false);
      return;
    }

    let cancelled = false;
    setApiLoading(true);
    setErrorMessage(null);

    apiClient
      .get(`/invitations/accept/${encodeURIComponent(token)}`)
      .then((res) => {
        if (cancelled) return;
        setApiInvitation(res.data);
        if (res.data?.firstName) {
          const suggested = `${res.data.firstName}${res.data.lastName ? '_' + res.data.lastName : ''}`
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, '_')
            .replace(/^_+/, '')
            .slice(0, 20);
          if (suggested.length >= 3) {
            setUsername(suggested);
          }
        }
        setApiLoading(false);
      })
      .catch(async (err) => {
        if (cancelled) return;
        // If real API failed, check if it's a mock token
        try {
          const mockRes = await services.access.lookUp(token, identity);
          if (!cancelled && mockRes.status !== "not-found") {
            setState(mockRes);
            setApiLoading(false);
            return;
          }
        } catch {
          // ignore mock lookup error
        }

        if (!cancelled) {
          const msg =
            err?.response?.data?.message ||
            err?.message ||
            "Invitation is invalid, expired, revoked, or already accepted.";
          const cleanMsg = Array.isArray(msg) ? msg[0] : msg;
          setErrorMessage(cleanMsg);
          setApiLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [token, identity]);

  async function handleCreateAndAccept(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || rejecting) return;

    const uError = validateUsername(username);
    if (uError) {
      setUsernameError(uError);
      return;
    }
    if (usernameAvailability === "taken") {
      setUsernameError("This username is already taken. Please choose another.");
      return;
    }
    if (!isPasswordStrongEnough(password)) {
      setPasswordError("Please meet all password strength requirements.");
      return;
    }
    if (password !== confirmPassword) {
      setConfirmError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    setFormError(null);

    try {
      const res = await apiClient.post(`/invitations/accept/${encodeURIComponent(token)}`, {
        username,
        password,
        confirmPassword,
      });
      const data = res.data || {};
      const receivedToken =
        data.accessToken ||
        data.access_token ||
        data.token ||
        data.data?.accessToken ||
        data.data?.token ||
        Cookies.get("antcolos_token");

      if (receivedToken) {
        Cookies.set("antcolos_token", receivedToken, { expires: 7, path: "/" });
        Cookies.remove("antcolos_invitation_token", { path: "/" });
        Cookies.remove("antcolos_next_step", { path: "/" });
        Cookies.remove("antcolos_role_id", { path: "/" });
        Cookies.remove("antcolos_user_role", { path: "/" });
        Cookies.remove("antcolos_role_name", { path: "/" });
        Cookies.remove("antcolos_permissions", { path: "/" });
        Cookies.remove("antcolos_user_permissions", { path: "/" });
        Cookies.remove("antcolos_role_template", { path: "/" });

        const permData = await fetchAndStoreUserPermissions(queryClient, receivedToken);
        toast.success(data.message || `Welcome to ${apiInvitation?.organizationName || "Antcolos"}!`);

        const role =
          permData?.roleId ||
          data?.roleId ||
          apiInvitation?.roleId ||
          Cookies.get("antcolos_role_id");
        const isDriver = String(role || "").toUpperCase() === "DRIVER";
        router.push(isDriver ? "/driver/home" : "/home");
      } else {
        Cookies.remove("antcolos_invitation_token", { path: "/" });
        toast.success(data.message || "Account created! Please sign in to continue.");
        router.push("/sign-in");
      }
    } catch (err: any) {
      let msg =
        err?.response?.data?.message ||
        err?.message ||
        "Failed to accept invitation. Please try again.";
      if (Array.isArray(msg)) {
        msg = msg[0];
      }
      setFormError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleExistingAccept() {
    if (submitting || rejecting) return;
    setSubmitting(true);
    setFormError(null);

    try {
      const res = await apiClient.post(`/invitations/accept/${encodeURIComponent(token)}`, {});
      const data = res.data || {};
      const activeToken = Cookies.get("antcolos_token") || data.accessToken || "";
      if (activeToken) {
        Cookies.remove("antcolos_invitation_token", { path: "/" });
        const permData = await fetchAndStoreUserPermissions(queryClient, activeToken);
        const role =
          permData?.roleId ||
          data?.roleId ||
          apiInvitation?.roleId ||
          Cookies.get("antcolos_role_id");
        const isDriver = String(role || "").toUpperCase() === "DRIVER";
        toast.success(data.message || `Welcome to ${apiInvitation?.organizationName || "Antcolos"}!`);
        router.push(isDriver ? "/driver/home" : "/home");
      } else {
        Cookies.remove("antcolos_invitation_token", { path: "/" });
        toast.success("Invitation accepted! Please sign in.");
        router.push("/sign-in");
      }
    } catch (err: any) {
      let msg =
        err?.response?.data?.message ||
        err?.message ||
        "Failed to accept invitation. Please try again.";
      if (Array.isArray(msg)) {
        msg = msg[0];
      }
      setFormError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReject() {
    if (rejecting || submitting) return;
    setRejecting(true);
    setFormError(null);

    try {
      await apiClient.post(`/invitations/reject/${encodeURIComponent(token)}`, {});
      Cookies.remove("antcolos_invitation_token", { path: "/" });
      setIsRejected(true);
      toast.success("Invitation declined.");
    } catch (err: any) {
      let msg =
        err?.response?.data?.message ||
        err?.message ||
        "Failed to reject invitation. Please try again.";
      if (Array.isArray(msg)) {
        msg = msg[0];
      }
      toast.error(msg);
    } finally {
      setRejecting(false);
    }
  }

  async function accept(input: AcceptInput) {
    if (accepting) return;
    setAccepting(true);
    const result = await services.access.accept(token, identity, input);
    setAccepting(false);
    if (result.status === "accepted" || result.status === "incomplete") {
      setRun(result.run);
      setCollecting(false);
      return;
    }
    if (result.status === "not-acceptable") setState(result.lookup);
  }

  async function decline() {
    const updated = await services.access.decline(token, identity);
    if (!updated) return;
    setCollecting(false);
    setDeclined(updated);
  }

  if (apiLoading) {
    return (
      <AuthShell width="medium" title="Checking your invitation" description="One moment while we open the link.">
        <div className="flex items-center gap-2.5 text-[0.875rem] text-fg-muted" aria-live="polite">
          <LoaderCircle className="size-4 animate-spin text-primary" aria-hidden />
          Checking invitation…
        </div>
      </AuthShell>
    );
  }

  if (isRejected) {
    return (
      <AuthShell width="medium" title="Invitation Declined" footer={<SignInLink />}>
        <div className="space-y-4">
          <FormAlert
            tone="info"
            title={`You declined the invitation from ${apiInvitation?.organizationName || "the organization"}.`}
          >
            No account changes were made and no permissions were granted. If you change your mind,
            ask the organization administrator for a new invitation link.
          </FormAlert>
          <Button variant="primary" size="lg" className="w-full" asChild>
            <Link href="/sign-in">Return to Sign In</Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  if (!token) {
    return (
      <AuthShell width="medium" title="No Invitation Link Found" footer={<SignInLink />}>
        <div className="space-y-4">
          <FormAlert tone="info" title="No active invitation found.">
            Please use the complete link provided in your invitation email to view or accept your invitation.
          </FormAlert>
          <Button variant="primary" size="lg" className="w-full" asChild>
            <Link href="/sign-in">Go to Sign In</Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  if (errorMessage && !apiInvitation && !state) {
    return (
      <AuthShell width="medium" title="This invitation link is not available" footer={<SignInLink />}>
        <div className="space-y-4">
          <FormAlert tone="danger" title={errorMessage}>
            If you think this is a mistake, contact whoever invited you and ask for a new link.
          </FormAlert>
        </div>
      </AuthShell>
    );
  }

  if (apiInvitation) {
    const isExisting = Boolean(apiInvitation.existingUser);
    const fullName = [apiInvitation.firstName, apiInvitation.lastName].filter(Boolean).join(" ");
    const displayName = fullName || apiInvitation.email;

    const welcomeTitle = isExisting
      ? `Welcome, ${displayName}!`
      : `Welcome, ${displayName}!`;

    const welcomeDescription = isExisting
      ? `We are granting you some new permissions in ${apiInvitation.organizationName}.`
      : `We have invited you to join ${apiInvitation.organizationName} as ${apiInvitation.roleId}.`;

    const isFormFilled = Boolean(
      username.trim() &&
      password.trim() &&
      confirmPassword.trim()
    );
    const isAuthenticated = Boolean(user?.id || Cookies.get("antcolos_token"));

    return (
      <AuthShell
        width="medium"
        title={welcomeTitle}
        description={welcomeDescription}
      >
        <div className="space-y-4">
          {/* Modern Card with User & Invitation Details */}
          <div className="rounded-xl border border-border bg-surface-sunken/60 p-3.5 space-y-3 sm:p-5">
            <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-3">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <span className="flex size-8.5 sm:size-9 shrink-0 items-center justify-center rounded-lg bg-surface border border-border text-primary shadow-xs">
                  <Building2 className="size-4 sm:size-4.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[0.625rem] sm:text-[0.6875rem] font-semibold text-fg-muted uppercase tracking-wider">
                    Organization
                  </p>
                  <p
                    className="text-[0.875rem] sm:text-[0.9375rem] font-semibold text-fg whitespace-nowrap truncate"
                    title={apiInvitation.organizationName}
                  >
                    {apiInvitation.organizationName}
                  </p>
                </div>
              </div>
              <span
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.6875rem] sm:text-[0.75rem] font-medium bg-primary/10 text-primary border border-primary/20 max-w-[13rem] sm:max-w-[20rem] whitespace-nowrap"
                title={`Role: ${apiInvitation.roleId}`}
              >
                <ShieldCheck className="size-3.5 shrink-0" />
                <span className="truncate">
                  Role: <span className="font-semibold">{apiInvitation.roleId}</span>
                </span>
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 text-[0.8125rem]">
              <div className="space-y-0.5">
                <p className="text-fg-muted text-[0.75rem]">Invited Name</p>
                <p className="font-medium text-fg">{fullName || "—"}</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-fg-muted text-[0.75rem]">Email Address</p>
                <p className="font-medium text-fg break-all">{apiInvitation.email}</p>
              </div>
            </div>
          </div>

          {formError ? <FormAlert tone="danger" title={formError} /> : null}

          {/* New User Account Creation Form */}
          {!isExisting ? (
            <form onSubmit={handleCreateAndAccept} className="space-y-4 pt-1">
              <div className="space-y-3 rounded-lg border border-border/80 bg-surface p-4">
                <p className="text-[0.8125rem] font-semibold text-fg">Set Up Your Credentials</p>

                <div className="space-y-1.5">
                  <label htmlFor="accept-username" className="block text-[0.8125rem] font-medium text-fg">
                    Username
                    <span className="ml-1 text-st-danger">*</span>
                  </label>
                  <UsernameField
                    id="accept-username"
                    value={username}
                    onChange={(val) => {
                      setUsername(val);
                      setUsernameError(null);
                    }}
                    disabled={submitting || rejecting}
                    onAvailabilityChange={setUsernameAvailability}
                    required
                  />
                  {usernameError ? (
                    <p role="alert" className="text-[0.75rem] text-st-danger">{usernameError}</p>
                  ) : null}
                </div>

                <Field
                  label="Password"
                  htmlFor="accept-password"
                  error={passwordError || undefined}
                  required
                >
                  <PasswordField
                    id="accept-password"
                    value={password}
                    onChange={(val) => {
                      setPassword(val);
                      setPasswordError(null);
                    }}
                    autoComplete="new-password"
                    disabled={submitting || rejecting}
                    placeholder="Create a strong password"
                    required
                  />
                  <PasswordChecklist id="accept-password-checklist" value={password} />
                </Field>

                <Field
                  label="Confirm password"
                  htmlFor="accept-confirm-password"
                  error={confirmError || undefined}
                  required
                >
                  <PasswordField
                    id="accept-confirm-password"
                    value={confirmPassword}
                    onChange={(val) => {
                      setConfirmPassword(val);
                      setConfirmError(null);
                    }}
                    autoComplete="new-password"
                    disabled={submitting || rejecting}
                    placeholder="Confirm your password"
                    required
                  />
                </Field>
              </div>

              {/* Accept & Reject Buttons */}
              <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
                <Button
                  variant="primary"
                  size="lg"
                  className="w-full sm:flex-1 h-11 text-[0.875rem] font-semibold shadow-sm"
                  type="submit"
                  disabled={submitting || rejecting || !isFormFilled || usernameAvailability === "checking"}
                >
                  {submitting ? (
                    <span className="flex items-center justify-center gap-2">
                      <LoaderCircle className="size-4 animate-spin" />
                      Creating account & accepting…
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      <CheckCircle2 className="size-4.5" />
                      Accept & Create Account
                    </span>
                  )}
                </Button>

                <ConfirmDialog
                  title="Reject Invitation"
                  description={`Are you sure you want to decline this invitation to join ${apiInvitation.organizationName}?`}
                  confirmLabel="Yes, Reject Invitation"
                  cancelLabel="Cancel"
                  destructive
                  onConfirm={handleReject}
                  trigger={
                    <Button
                      variant="outline"
                      size="lg"
                      type="button"
                      disabled={submitting || rejecting}
                      className="w-full sm:w-auto h-11 border-border text-fg-muted hover:border-st-danger/40 hover:bg-st-danger-bg/20 hover:text-st-danger transition-colors font-medium"
                    >
                      {rejecting ? (
                        <span className="flex items-center justify-center gap-2">
                          <LoaderCircle className="size-4 animate-spin" />
                          Rejecting…
                        </span>
                      ) : (
                        <span className="flex items-center justify-center gap-2">
                          <XCircle className="size-4.5 text-st-danger" />
                          Reject
                        </span>
                      )}
                    </Button>
                  }
                />
              </div>

              <div className="pt-2 text-center text-[0.8125rem] text-fg-muted">
                Already have an account?{" "}
                <Link
                  href="/sign-in"
                  className="font-medium text-primary underline-offset-4 hover:underline"
                >
                  Sign in
                </Link>
              </div>
            </form>
          ) : (
            /* Existing User Section */
            <div className="space-y-4 pt-1">
              {isAuthenticated ? (
                /* Authenticated User: Accept or Reject Buttons */
                <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
                  <Button
                    variant="primary"
                    size="lg"
                    className="w-full sm:flex-1 h-11 text-[0.875rem] font-semibold shadow-sm"
                    onClick={() => void handleExistingAccept()}
                    disabled={submitting || rejecting}
                  >
                    {submitting ? (
                      <span className="flex items-center justify-center gap-2">
                        <LoaderCircle className="size-4 animate-spin" />
                        Accepting invitation…
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        <CheckCircle2 className="size-4.5" />
                        Accept Invitation
                      </span>
                    )}
                  </Button>

                  <ConfirmDialog
                    title="Reject Invitation"
                    description={`Are you sure you want to decline this invitation to join ${apiInvitation.organizationName}?`}
                    confirmLabel="Yes, Reject Invitation"
                    cancelLabel="Cancel"
                    destructive
                    onConfirm={handleReject}
                    trigger={
                      <Button
                        variant="outline"
                        size="lg"
                        type="button"
                        disabled={submitting || rejecting}
                        className="w-full sm:w-auto h-11 border-border text-fg-muted hover:border-st-danger/40 hover:bg-st-danger-bg/20 hover:text-st-danger transition-colors font-medium"
                      >
                        {rejecting ? (
                          <span className="flex items-center justify-center gap-2">
                            <LoaderCircle className="size-4 animate-spin" />
                            Rejecting…
                          </span>
                        ) : (
                          <span className="flex items-center justify-center gap-2">
                            <XCircle className="size-4.5 text-st-danger" />
                            Reject
                          </span>
                        )}
                      </Button>
                    }
                  />
                </div>
              ) : (
                /* Unauthenticated Existing User: Sign in to Accept or Reject */
                <div className="space-y-4">
                  <FormAlert
                    tone="info"
                    title={`An account already exists for ${apiInvitation.email}.`}
                  >
                    Please sign in to your Antcolos account to accept this invitation and apply your new permissions.
                  </FormAlert>

                  <div className="flex flex-col sm:flex-row items-center gap-3 pt-1">
                    <Button variant="primary" size="lg" className="w-full sm:flex-1 h-11 font-semibold" asChild>
                      <Link href={`/sign-in?invitation=${encodeURIComponent(token)}`}>
                        Sign in to Accept
                      </Link>
                    </Button>

                    <ConfirmDialog
                      title="Reject Invitation"
                      description={`Are you sure you want to decline this invitation to join ${apiInvitation.organizationName}?`}
                      confirmLabel="Yes, Reject Invitation"
                      cancelLabel="Cancel"
                      destructive
                      onConfirm={handleReject}
                      trigger={
                        <Button
                          variant="outline"
                          size="lg"
                          type="button"
                          disabled={submitting || rejecting}
                          className="w-full sm:w-auto h-11 border-border text-fg-muted hover:border-st-danger/40 hover:bg-st-danger-bg/20 hover:text-st-danger transition-colors font-medium"
                        >
                          {rejecting ? (
                            <span className="flex items-center justify-center gap-2">
                              <LoaderCircle className="size-4 animate-spin" />
                              Rejecting…
                            </span>
                          ) : (
                            <span className="flex items-center justify-center gap-2">
                              <XCircle className="size-4.5 text-st-danger" />
                              Reject
                            </span>
                          )}
                        </Button>
                      }
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </AuthShell>
    );
  }

  if (declined) {
    return (
      <AuthShell title="You declined this invitation" footer={<SignInLink />}>
        <div className="space-y-4">
          <FormAlert tone="info" title={`Nothing was shared with ${declined.organizationName}.`}>
            No profile, no relationship, no documents and no access. Declining is the one answer
            that leaves everything exactly as it was.
          </FormAlert>
          <p className="text-[0.8125rem] leading-relaxed text-fg-muted">
            {declined.organizationName} can see that you declined rather than that the link
            expired, so they know not to send it again. If you change your mind, ask them for a
            new invitation.
          </p>
        </div>
      </AuthShell>
    );
  }

  if (state === null) {
    return (
      <AuthShell title="Checking your invitation" description="One moment while we open the link.">
        <div className="flex items-center gap-2.5 text-[0.875rem] text-fg-muted" aria-live="polite">
          <LoaderCircle className="size-4 animate-spin" aria-hidden />
          Checking invitation…
        </div>
      </AuthShell>
    );
  }

  if (state.status === "not-found") {
    return (
      <AuthShell
        title="This invitation link doesn't work"
        footer={<SignInLink />}
      >
        <FormAlert tone="danger" title="We don't recognise this link.">
          It may have been mistyped, or copied incompletely. Ask whoever invited you to send it
          again.
        </FormAlert>
      </AuthShell>
    );
  }

  const invitation = state.invitation;
  const isOrgInvite = invitation.kind === "dispatch_org";

  if (collecting && invitation.kind === "driver") {
    return (
      <QuickOnboarding
        invitation={invitation}
        onConfirm={(decisions) => accept({
          licence: decisions.licence,
          sharedDocumentKeys: decisions.sharedDocumentKeys,
        })}
        onDecline={() => void decline()}
        failureNote={state.status === "resume"
          ? "You started this before and something did not finish. Carrying on will complete what is missing."
          : undefined}
      />
    );
  }

  if (run) return <AcceptanceOutcome run={run} invitation={invitation} onRetry={() => setCollecting(true)} router={router} />;

  if (state.status === "resume") {
    // The state that stops a half-finished acceptance locking somebody out of
    // their own retry. Only ever shown to the person whose run it is.
    return (
      <AuthShell
        title={`Finish joining ${invitation.organizationName}`}
        description="You started this before and something did not finish. Carrying on completes what is missing and repeats nothing."
      >
        <div className="space-y-4">
          <StepList run={state.run} />
          <Button
            variant="primary" size="lg" className="w-full"
            onClick={() => {
              if (invitation.kind === "driver") { setCollecting(true); return; }
              void accept({ sharedDocumentKeys: [] });
            }}
            disabled={accepting}
            aria-busy={accepting || undefined}
          >
            {accepting ? "Finishing…" : "Finish joining"}
          </Button>
        </div>
      </AuthShell>
    );
  }

  if (state.status === "expired" || state.status === "revoked" || state.status === "used"
    || state.status === "declined") {
    const copy = {
      expired: {
        title: "This invitation has expired",
        alert: "The link is past its expiry date.",
        body: `Ask ${invitation.organizationName} to send you a new one — it only takes them a moment.`,
        tone: "warning" as const,
        icon: Clock,
      },
      revoked: {
        title: "This invitation was withdrawn",
        alert: `${invitation.organizationName} cancelled this invitation.`,
        body: "If you think that was a mistake, contact them directly and ask for a new link.",
        tone: "danger" as const,
        icon: Ban,
      },
      used: {
        title: "This invitation has already been used",
        alert: "Somebody has already accepted this invitation.",
        body: "If that was you, sign in with the account you created. If it was not, contact the organization straight away.",
        tone: "warning" as const,
        icon: CircleCheck,
      },
      declined: {
        title: "You declined this invitation",
        alert: `Nothing was shared with ${invitation.organizationName}.`,
        body: "No profile, no relationship, no documents and no access. If you have changed your mind, ask them for a new invitation.",
        tone: "info" as const,
        icon: Ban,
      },
    }[state.status];

    return (
      <AuthShell title={copy.title} footer={<SignInLink />}>
        <FormAlert tone={copy.tone} title={copy.alert}>
          {copy.body}
        </FormAlert>
      </AuthShell>
    );
  }

  if (state.status === "organization-invitation") {
    return (
      <AuthShell title="This invitation is for a whole organization" footer={<SignInLink />}>
        <div className="space-y-4">
          <FormAlert tone="warning" title="This link connects two companies, not a person.">
            {invitation.organizationName} invited{" "}
            <strong className="font-medium text-fg">{invitation.recipientName}</strong> as an
            organization — a dispatch arrangement with its own scope, its own end date and its own
            per-truck permissions.
          </FormAlert>
          <p className="text-[0.8125rem] leading-relaxed text-fg-muted">
            Antcolos will not turn that into a seat for whoever opened the link, because a seat is
            not what was agreed. Contact {invitation.organizationName} and set the arrangement up
            from your own workspace.
          </p>
        </div>
      </AuthShell>
    );
  }

  if (state.status === "wrong-recipient") {
    return (
      <AuthShell title="This invitation isn't for this account" footer={<SignInLink />}>
        <div className="space-y-4">
          <FormAlert tone="danger" title="You are signed in as somebody else.">
            This invitation was sent to <strong className="font-medium text-fg">{invitation.recipientEmail}</strong>,
            but you are signed in as <strong className="font-medium text-fg">{state.signedInAs}</strong>. For
            everyone&apos;s safety we will not attach it to the wrong account.
          </FormAlert>
          <p className="text-[0.8125rem] leading-relaxed text-fg-muted">
            Sign out and sign back in as {invitation.recipientEmail}, or ask{" "}
            {invitation.organizationName} to send a fresh invitation to the address you actually
            use.
          </p>
          <Button variant="secondary" size="lg" className="w-full" asChild>
            <Link href={`/sign-in?invitation=${encodeURIComponent(token)}`}>
              Sign in as someone else
            </Link>
          </Button>
        </div>
      </AuthShell>
    );
  }

  // Valid, and either signed in as the recipient or not signed in at all.
  const needsAccount = state.status === "needs-account";

  return (
    <AuthShell
      title={
        isOrgInvite
          ? `${invitation.organizationName} wants to work with you`
          : `You've been invited to ${invitation.organizationName}`
      }
      description={
        isOrgInvite
          ? "Accepting connects your dispatch organization to this carrier. You decide afterwards which of your people work their freight."
          : `You have been invited as ${invitation.roleName}. Here is exactly what that lets you do.`
      }
    >
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-border bg-surface-sunken p-3.5">
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface text-fg-muted shadow-e1"
          >
            {isOrgInvite ? (
              <Building2 className="size-[1.125rem]" />
            ) : (
              <UserRound className="size-[1.125rem]" />
            )}
          </span>
          <div className="min-w-0 text-[0.8125rem]">
            <p className="font-semibold text-fg">{invitation.roleName}</p>
            <p className="mt-0.5 text-fg-muted">
              Invitation for{" "}
              <span className="font-medium text-fg break-all">{invitation.recipientEmail}</span>
              {invitation.expiresAt
                ? ` · expires ${new Date(invitation.expiresAt).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}`
                : " · no expiry"}
            </p>
          </div>
        </div>

        {invitation.engagementType ? (
          <div className="rounded-lg border border-border bg-surface p-3.5">
            <p className="text-[0.75rem] text-fg-muted">Engagement type</p>
            <p className="mt-0.5 text-[0.875rem] font-semibold text-fg">
              {ENGAGEMENT_LABEL[invitation.engagementType]}
            </p>
            <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
              {ENGAGEMENT_DESCRIPTION[invitation.engagementType]}
            </p>
            <p className="mt-1.5 text-[0.75rem] leading-relaxed text-fg-subtle">
              {invitation.organizationName} set this. If it looks wrong, ask them to send a new
              invitation — it decides what paperwork you owe them.
            </p>
          </div>
        ) : null}

        {invitation.scopedToCarrierName ? (
          <FormAlert
            tone="info"
            role="none"
            title={`Limited to ${invitation.scopedToCarrierName}.`}
          >
            Everything below applies to this carrier relationship only. It gives them no access to
            your other carrier clients, and gives you none to theirs.
          </FormAlert>
        ) : null}

        <div>
          <h2 className="mb-2 text-[0.875rem] font-semibold text-fg">What you&apos;ll be able to do</h2>
          <PermissionSummary permissions={invitation.permissions ?? []} />
        </div>

        <SensitiveAccessWarning permissions={invitation.permissions ?? []} />

        {needsAccount ? (
          <div className="space-y-3">
            <p className="text-[0.8125rem] leading-relaxed text-fg-muted">
              You need an Antcolos account to accept. We&apos;ll bring you straight back here once
              it exists.
            </p>
            <Button variant="primary" size="lg" className="w-full" asChild>
              <Link href={`/sign-up?invitation=${encodeURIComponent(token)}`}>
                Create an account to accept
              </Link>
            </Button>
            <Button variant="secondary" size="lg" className="w-full" asChild>
              <Link href={`/sign-in?invitation=${encodeURIComponent(token)}`}>
                I already have an account
              </Link>
            </Button>
          </div>
        ) : (
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            onClick={() => {
              if (invitation.kind === "driver") { setCollecting(true); return; }
              void accept({ sharedDocumentKeys: [] });
            }}
            disabled={accepting}
            aria-busy={accepting || undefined}
          >
            {accepting ? "Accepting…" : isOrgInvite ? "Accept and connect" : "Accept invitation"}
          </Button>
        )}

        {/*
          * Turning it down is an answer, so it is offered here as well as on
          * the driver's consent screen. An agreement nobody can refuse is not
          * one, and a link whose only exits are "accept" or "close the tab"
          * leaves the sender re-sending it forever.
          */}
        {!isOrgInvite ? (
          <Button
            variant="secondary"
            size="lg"
            className="w-full"
            onClick={() => void decline()}
            disabled={accepting}
            data-testid="decline-invitation"
          >
            No thanks — decline this invitation
          </Button>
        ) : null}
      </div>
    </AuthShell>
  );
}

function SignInLink() {
  return (
    <>
      Already have an account?{" "}
      <Link
        href="/sign-in"
        className="font-medium text-primary underline-offset-4 hover:underline focus-visible:underline"
      >
        Sign in
      </Link>
    </>
  );
}

/**
 * What acceptance actually did, one record at a time.
 *
 * Shown instead of "you've joined", because "you've joined" is a claim and this
 * is a report. Five different modules were asked for five different things and
 * they do not all have to have said yes — a person whose portal seat failed is
 * genuinely connected to the carrier and genuinely cannot sign in, and telling
 * them they have joined would be the most useful-looking lie the product could
 * tell them.
 */
function StepList({ run }: { run: AcceptanceRun }) {
  return (
    <ul className="space-y-2" data-testid="acceptance-steps">
      {run.steps.map((step) => {
        const ok = step.state === "done";
        const skipped = step.state === "not_applicable";
        return (
          <li
            key={step.key}
            data-step={step.key}
            data-state={step.state}
            className={cn(
              "flex items-start gap-2.5 rounded-lg border px-3.5 py-3",
              ok && "border-st-success/35 bg-st-success-bg/40",
              skipped && "border-border bg-surface-sunken",
              !ok && !skipped && "border-st-danger/35 bg-st-danger-bg/40",
            )}
          >
            {ok ? (
              <CircleCheck className="mt-px size-4 shrink-0 text-st-success" aria-hidden />
            ) : skipped ? (
              <Ban className="mt-px size-4 shrink-0 text-fg-subtle" aria-hidden />
            ) : (
              <Clock className="mt-px size-4 shrink-0 text-st-danger" aria-hidden />
            )}
            <div className="min-w-0 text-[0.8125rem]">
              <p className="font-medium text-fg">{ACCEPTANCE_STEP_LABEL[step.key]}</p>
              <p className="mt-0.5 leading-relaxed text-fg-muted">{step.detail}</p>
              {step.failureReason ? (
                <p className="mt-1 leading-relaxed text-st-danger">{step.failureReason}</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function AcceptanceOutcome({
  run,
  invitation,
  onRetry,
  router,
}: {
  run: AcceptanceRun;
  invitation: Invitation;
  onRetry: () => void;
  router: ReturnType<typeof useRouter>;
}) {
  const finished = Boolean(run.completedAt);
  const accepted = new Date(run.acceptedAt).toLocaleDateString(undefined, {
    month: "long", day: "numeric", year: "numeric",
  });

  return (
    <AuthShell
      title={finished
        ? `You've joined ${invitation.organizationName}`
        : "Almost there"}
      description={finished
        // The sentence the whole date decision was about. Accepting is the
        // person saying yes; being started is the carrier's separate act, and
        // conflating them is how a migrated workforce looks freshly hired.
        ? `Invitation accepted on ${accepted}. ${invitation.organizationName} has not activated your relationship yet — until they do, you are connected but not yet working under their authority.`
        : "Some of what accepting creates did not finish. Nothing was lost, and carrying on completes what is missing."}
    >
      <div className="space-y-4" data-testid={finished ? "acceptance-confirmed" : undefined}>
        <StepList run={run} />

        {finished ? (
          <>
            {/*
              * ★ AN ABSENT START DATE, SAID OUT LOUD ★
              * `startedAt` is deliberately not set by accepting, so the screen
              * states it rather than showing an empty field somebody would
              * read as a bug — or worse, as today's date.
              */}
            <p
              data-testid="no-start-date"
              className="rounded-lg border border-border bg-surface-sunken px-3.5 py-3 text-[0.8125rem] leading-relaxed text-fg-muted"
            >
              <span className="font-semibold text-fg">Your start date: </span>
              Not recorded yet. {invitation.organizationName} sets it when they activate you.
            </p>
            <WithheldDocuments run={run} />
          </>
        ) : null}

        {finished ? (
          /**
           * Two ways on, and the order is the point.
           *
           * The next thing a newly-connected driver has to do is their
           * paperwork — the carrier cannot activate them until it is done — so
           * that is the primary action, as it was before this flow changed.
           * The portal is offered beside it rather than instead of it.
           */
          <div className="space-y-2.5">
            <Button
              variant="primary" size="lg" className="w-full"
              onClick={() => router.push(
                invitation.kind === "driver" ? "/driver/documents" : "/home",
              )}
            >
              {invitation.kind === "driver" ? "Go to my documents" : "Go to Antcolos"}
            </Button>
            {invitation.kind === "driver" ? (
              <Button
                variant="secondary" size="lg" className="w-full"
                onClick={() => router.push("/driver/home")}
              >
                Go to my driver portal
              </Button>
            ) : null}
          </div>
        ) : (
          <Button variant="primary" size="lg" className="w-full" onClick={onRetry}>
            Finish joining
          </Button>
        )}

        <p className="text-[0.75rem] leading-relaxed text-fg-subtle">
          {ACCEPTANCE_LIMITATION}
        </p>
      </div>
    </AuthShell>
  );
}

/**
 * What acceptance deliberately did NOT hand over.
 *
 * Restricted paperwork — a social security number, bank details, a state
 * driving record, a substance-testing record — is never shared as a side
 * effect of joining. Access to one of those is its own decision, per document,
 * for a stated reason, by somebody who holds the permission for it.
 *
 * Shown rather than silently omitted: a list shorter than the one somebody
 * just ticked, with no explanation, is how people conclude the product lost
 * their documents.
 */
function WithheldDocuments({ run }: { run: AcceptanceRun }) {
  const withheld = run.steps.find((s) => s.key === "document_access")?.withheld;
  if (!withheld || withheld.length === 0) return null;

  return (
    <section
      data-testid="withheld-documents"
      className="rounded-lg border border-border bg-surface-sunken px-3.5 py-3"
    >
      <h2 className="text-[0.8125rem] font-semibold text-fg">
        Not shared with them
      </h2>
      <p className="mt-1 text-[0.75rem] leading-relaxed text-fg-muted">
        Joining does not hand these over. They are asked for separately, one at a
        time, for a reason somebody writes down.
      </p>
      <ul className="mt-2 space-y-1.5">
        {withheld.map((document) => (
          <li key={document.key} className="text-[0.75rem] leading-relaxed text-fg-muted">
            <span className="font-medium text-fg">{document.label}</span>
            {document.reason ? ` — ${document.reason}` : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
