"use client";

import { Building2, Check, Copy, Plus, ShieldCheck, UserRound, Users } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { LoadingSkeleton } from "@/components/data/states";
import { PageHeader } from "@/components/layout/page-header";
import {
  ROLE_NAME_MAX_LENGTH,
  clampToGrantable,
  grantablePermissionKeys,
  permissionMeta,
  validateRoleName,
} from "@/lib/permissions";
import { useActiveMembership, usePermissions } from "@/lib/session/hooks";
import type { EngagementType, PermissionKey, PermissionTemplate } from "@/types";
import { ENGAGEMENT_DESCRIPTION, ENGAGEMENT_LABEL } from "@/features/driver/driver-rules";
import { ApiPermissionPicker } from "./api-permission-picker";
import {
  PermissionSummary,
  SensitiveAccessWarning,
} from "./permission-summary";
import { invitationPresets, type InvitationPreset } from "./presets";
import { invitationLink } from "./mock-access";
import { services } from "@/lib/api";
import { apiClient } from "@/lib/api/client";
import { useServiceContext } from "@/lib/api/use-service-context";
import { PermissionDeniedError } from "@/lib/api/contracts/context";
import { validateEmail } from "@/features/auth/rules";
import type { ReferralHandoff } from "@/lib/api/contracts/referrals";
import { cn } from "@/lib/utils";
import { useScrollToTop } from "@/lib/utils/scroll";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

// Helper function to map old permission keys to new ones with dot notation
function migrateKey(p: string): string {
  if (typeof p !== "string" || !p.trim()) return "";
  let key = p.trim();
  if (key.includes(":")) {
    key = key.replace(/:/g, ".");
  }
  key = key.replace(/^trucks\./, "truck.");
  key = key.replace(/^loads\./, "load.");
  key = key.replace(/^settlements\./, "settlement.");
  key = key.replace(/^invoices\./, "invoice.");
  key = key.replace(/^expenses\./, "expense.");
  key = key.replace(/^documents\./, "document.");
  key = key.replace(/^members\./, "membership.");
  key = key.replace(/^invitations\./, "invitation.");
  key = key.replace(/^drivers\./, "driver.");
  key = key.replace(/^trailers\./, "trailer.");
  key = key.replace(/^customers\./, "customer.");

  if (key.endsWith(".view")) key = key.replace(/\.view$/, ".read");
  if (key.endsWith(".upload")) key = key.replace(/\.upload$/, ".create");
  if (key.endsWith(".edit")) key = key.replace(/\.edit$/, ".update");
  if (key === "membership.view") key = "membership.list";
  if (key === "invitation.view") key = "invitation.list";
  return key;
}

function getFriendlyErrorMessage(err: any): string {
  const backendMsg = err.response?.data?.message || err.message;
  if (Array.isArray(backendMsg)) {
    return backendMsg.join(", ");
  }
  return backendMsg || "An unexpected error occurred.";
}

type Stage = "type" | "details" | "review" | "sent";


const KIND_ICON = {
  driver: UserRound,
  dispatch_org: Building2,
  employee: Users,
  dispatcher: Users,
  custom: ShieldCheck,
} as const;

function expiryIso(days: number): string | null {
  if (days <= 0) return null;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function sameSet(a: readonly (PermissionKey | string)[], b: ReadonlySet<string>): boolean {
  if (a.length !== b.size) return false;
  return a.every((k) => b.has(k) || b.has(migrateKey(k)));
}

/**
 * Sending an invitation: pick what is being invited, decide exactly what it can
 * do, then read it back before anything is created.
 *
 * The permission selection always belongs to the invitation, never to the
 * preset it started from — editing here changes what this one recipient gets
 * and leaves "Driver" meaning what it meant before.
 */
export function InviteFlow() {
  const router = useRouter();
  /**
   * ★ THE REFERRAL HANDOFF ★
   *
   * A company that accepted a referral lands here with `?referral=`. What
   * arrives is PREFILL and nothing else: a name, an address, the referrer's
   * name and the free-text title the referrer typed, shown as context.
   *
   * Notice what the handoff cannot carry and therefore cannot decide — the
   * invitation kind, the permission set, the engagement type, the expiry. Every
   * one of those is still chosen on this screen by somebody holding
   * `invitations:create`, which is exactly the point: accepting a referral is
   * an expression of interest, and this is where the actual decisions are made.
   *
   * The one thing it carries that is more than a prefill is
   * `existingEngagementId`, which makes acceptance CONNECT a workforce record
   * this organization already has rather than start a second one. That is the
   * access module's own `InvitationDraft.engagementId`, not a new mechanism.
   */
  const referralId = useSearchParams().get("referral");
  const [handoff, setHandoff] = useState<ReferralHandoff | null>(null);
  const { membership, organization } = useActiveMembership();
  const ctx = useServiceContext();
  const myPermissions = usePermissions();

  const [stage, setStage] = useState<Stage>("type");
  useScrollToTop([stage]);
  const queryClient = useQueryClient();
  const [preset, setPreset] = useState<InvitationPreset | null>(null);
  const [savedRole, setSavedRole] = useState<PermissionTemplate | null>(null);

  const { data: roles = [], isLoading: isLoadingRoles } = useQuery<PermissionTemplate[]>({
    queryKey: ["organizations", "roles"],
    queryFn: async () => {
      const res = await apiClient.get('/organizations/roles');
      const rawData = res.data;
      const apiRoles = rawData?.roles || rawData?.data || (Array.isArray(rawData) ? rawData : []);
      return apiRoles.map((r: any) => ({
        id: r.id,
        name: r.name,
        description: r.description || "",
        permissions: (r.permissions || []).map(migrateKey),
        version: 1,
        seeded: false,
        archived: false,
        createdAt: r.createdAt || new Date().toISOString(),
        updatedAt: r.updatedAt || new Date().toISOString(),
      } as PermissionTemplate));
    },
  });

  const [roleName, setRoleName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [permissions, setPermissions] = useState<Set<string>>(new Set());

  // Driver invitations only. The carrier picks this, never the driver.
  const [engagementType, setEngagementType] = useState<EngagementType | null>(null);
  const [saveAsRole, setSaveAsRole] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");

  const [submitted, setSubmitted] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentToken, setSentToken] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const orgType = organization?.type ?? "CARRIER";
  const presets = useMemo(() => invitationPresets(orgType), [orgType]);

  const isOwner = membership?.isOwner ?? true;
  const grantable = useMemo(
    () => (isOwner ? undefined : new Set(grantablePermissionKeys(myPermissions, orgType))),
    [isOwner, myPermissions, orgType],
  );

  useEffect(() => {
    if (!ctx || !referralId) return;
    let cancelled = false;
    void services.referrals.handoff(ctx, referralId).then((result) => {
      if (cancelled || !result) return;
      setHandoff(result);
      // Prefilled, and still editable. The reviewer confirms the identity and
      // the contact details — what a stranger typed into a referral form is
      // evidence of an introduction, not a verified fact about the person.
      if (result.recipientName) {
        setOrgName(result.recipientName);
        const parts = result.recipientName.trim().split(/\s+/);
        setFirstName(parts[0] || "");
        setLastName(parts.slice(1).join(" "));
      }
      setRecipientEmail(result.recipientEmail);
    });
    return () => {
      cancelled = true;
    };
  }, [ctx, referralId]);

  const isDispatchOrg = preset?.kind === "dispatch_org";
  const recipientName = isDispatchOrg
    ? orgName.trim()
    : [firstName.trim(), lastName.trim()].filter(Boolean).join(" ");
  const isDriver = preset?.kind === "driver";
  const needsRoleName = preset?.kind === "custom" && !savedRole;
  const effectiveRoleName = savedRole?.name ?? (needsRoleName ? roleName.trim() : preset?.label ?? "");

  const changedFromPreset =
    preset != null && !savedRole && !sameSet(preset.permissions, permissions);

  const selectedList = useMemo(() => [...permissions], [permissions]);

  function choose(next: InvitationPreset, role?: PermissionTemplate) {
    setPreset(next);
    setSavedRole(role ?? null);
    // A preset arrives pre-ticked; anything the granter cannot hand out is
    // dropped rather than silently promised.
    const base = role ? role.permissions : next.permissions.map(migrateKey);
    setPermissions(new Set(isOwner ? base : clampToGrantable(base, myPermissions, orgType)));
    setRoleName(role?.name ?? "");
    setEngagementType(next.kind === "driver" ? "company_driver" : null);
    setSaveAsRole(false);
    setNewRoleName("");
    setSubmitted(false);
    setStage("details");
  }

  const orgNameError = submitted && !orgName.trim() ? "Enter the organization's name." : null;
  const firstNameError = submitted && !firstName.trim() ? "Enter their first name." : null;
  const lastNameError = submitted && !lastName.trim() ? "Enter their last name." : null;
  const emailError = submitted ? validateEmail(recipientEmail) : null;
  const roleNameError =
    submitted && needsRoleName ? validateRoleName(roleName, roles.map((r) => r.name)) : null;
  const newRoleNameError =
    submitted && saveAsRole
      ? validateRoleName(newRoleName, roles.map((r) => r.name))
      : null;
  const permissionsError =
    submitted && permissions.size === 0 ? "Select at least one permission." : null;

  function continueToReview() {
    setSubmitted(true);
    const bad =
      (isDispatchOrg ? !orgName.trim() : !firstName.trim() || !lastName.trim()) ||
      (isDriver && !engagementType) ||
      validateEmail(recipientEmail) ||
      (needsRoleName && validateRoleName(roleName, roles.map((r) => r.name))) ||
      (saveAsRole && validateRoleName(newRoleName, roles.map((r) => r.name))) ||
      permissions.size === 0;
    if (bad) return;
    setConfirmed(false);
    setStage("review");
  }

  async function commit(alsoCopy: boolean = false) {
    if (!organization || !preset || sending || !confirmed) return;
    setSending(true);
    setRefusal(null);

    // Belt and braces: non-owner invitations can never exceed what they hold.
    const safeRaw = isOwner
      ? selectedList
      : clampToGrantable(selectedList, myPermissions, orgType);

    const safePermissions = Array.from(new Set(safeRaw.map(migrateKey).filter(Boolean)));

    try {
      let roleIdToUse = "";

      // Check if user selected custom role or checked "Save this as a custom role"
      const shouldCreateRole =
        (preset.kind === "custom" && !savedRole) || Boolean(saveAsRole && newRoleName.trim());

      if (shouldCreateRole) {
        const roleToCreateName =
          preset.kind === "custom" && !savedRole
            ? roleName.trim()
            : newRoleName.trim();

        const roleDraft = {
          name: roleToCreateName || "Custom Role",
          description: `Custom role created for ${recipientName.trim()}`,
          permissions: safePermissions,
        };

        const roleRes = await apiClient.post("/organizations/roles", roleDraft);
        const createdRoleData = roleRes.data?.role || roleRes.data?.data || roleRes.data;
        const createdId = createdRoleData?.id || roleRes.data?.id || roleRes.data?.roleId;

        if (!createdId) {
          throw new Error("Role was created but no role ID was returned by the server.");
        }

        roleIdToUse = String(createdId);

        // Invalidate roles query so new role appears in custom roles list
        queryClient.invalidateQueries({ queryKey: ["organizations", "roles"] });
      } else if (savedRole) {
        roleIdToUse = String(savedRole.id);
      } else {
        const roleKeyMap: Record<string, string> = {
          driver: "DRIVER",
          dispatcher: "DISPATCHER",
          dispatch_org: "DISPATCHING_COMPANY",
          employee: "MEMBER",
        };
        const standardRoleId = roleKeyMap[preset.kind] || preset.kind.toUpperCase();

        const matched = roles.find(
          (r) =>
            r.id?.toUpperCase() === standardRoleId ||
            r.name.toLowerCase() === preset.label.toLowerCase(),
        );
        roleIdToUse = matched ? String(matched.id) : standardRoleId;
      }

      const fName = isDispatchOrg
        ? orgName.trim().split(/\s+/)[0] || orgName.trim()
        : firstName.trim();
      const lName = isDispatchOrg
        ? orgName.trim().split(/\s+/).slice(1).join(" ") || "Admin"
        : lastName.trim();

      const invitePayload = {
        email: recipientEmail.trim(),
        firstName: fName,
        lastName: lName,
        roleId: roleIdToUse,
        permissions: safePermissions,
      };

      const inviteRes = await apiClient.post("/organizations/invitations", invitePayload);
      const inviteData = inviteRes.data?.data || inviteRes.data?.invitation || inviteRes.data;
      const token = inviteData?.token || inviteData?.code || inviteData?.id || null;

      if (referralId && ctx) {
        void services.referrals.recordInvitation(ctx, referralId, inviteData?.id || "sent");
      }

      queryClient.invalidateQueries({ queryKey: ["organizations", "invitations"] });

      setSentToken(token);
      setSending(false);
      setStage("sent");
      toast.success(`Invitation sent to ${recipientEmail.trim()}`);

      if (alsoCopy && token) {
        void copyLink(token);
      }
    } catch (err: any) {
      const displayMsg = getFriendlyErrorMessage(err);
      setRefusal(displayMsg);
      toast.error("Failed to send invitation", { description: displayMsg });
      setSending(false);
    }
  }

  async function copyLink(token: string) {
    try {
      await navigator.clipboard.writeText(invitationLink(token));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard access can be refused; the link stays on screen to copy by hand.
      setCopied(false);
    }
  }

  if (!membership || !organization) return null;

  return (
    <div className="space-y-section">
      <PageHeader
        title="Invite to Antcolos"
        description={`Everyone you invite joins ${organization.displayName} with exactly the access you choose here.`}
      />

      {handoff ? (
        <div className="rounded-lg border border-st-info/35 bg-st-info-bg/40 px-4 py-3">
          <p className="text-[0.8125rem] font-semibold text-fg">
            From a referral by {handoff.referrerName}
          </p>
          <p className="mt-1 text-[0.8125rem] text-fg-muted">
            They suggested {handoff.recipientName} for
            {" "}&ldquo;{handoff.proposedTitleContext}&rdquo;. That is the
            referrer&apos;s description and nothing else &mdash; it is not a
            role, it grants nothing, and what this person will actually be able
            to do is what you choose below.
          </p>
          {handoff.existingEngagementId ? (
            <p className="mt-2 text-[0.8125rem] text-fg-muted">
              This organization already has a workforce record for them. Sending
              this invitation connects that record rather than starting a second.
            </p>
          ) : null}
          <p className="mt-2 text-[0.75rem] text-fg-subtle">
            {handoff.meaningOfAcceptance}
          </p>
        </div>
      ) : null}

      {stage === "type" ? (
        <TypeStep
          presets={presets}
          roles={roles}
          isLoadingRoles={isLoadingRoles}
          onChoose={choose}
        />
      ) : null}

      {stage === "details" && preset ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
          <div className="min-w-0 space-y-4">
            <SelectedTypeCard
              preset={preset}
              savedRole={savedRole}
              onChange={() => setStage("type")}
            />

            {isDispatchOrg ? (
              <div className="rounded-md border border-st-info/35 bg-st-info-bg/50 px-3 py-2.5 text-[0.8125rem] leading-relaxed">
                <p className="font-medium text-fg">This invites a whole company.</p>
                <p className="mt-0.5 text-fg-muted">
                  Their administrator accepts, then picks which of their people work your freight.
                  Everything you grant applies to {organization.displayName} only — it gives them
                  nothing with their other carrier clients.
                </p>
              </div>
            ) : null}

            {isDriver ? (
              <fieldset>
                <legend className="mb-1.5 text-[0.8125rem] font-medium text-fg">
                  Engagement type
                </legend>
                <p className="mb-2 text-[0.75rem] leading-relaxed text-fg-subtle">
                  You choose this, not the driver. It decides what paperwork they owe you.
                </p>
                <div className="space-y-2">
                  {(["company_driver", "owner_operator"] as const).map((value) => (
                    <label
                      key={value}
                      className={cn(
                        "flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors",
                        engagementType === value
                          ? "border-primary bg-primary/[0.06]"
                          : "border-border bg-surface hover:border-border-strong",
                      )}
                    >
                      <input
                        type="radio"
                        name="engagement-type"
                        value={value}
                        checked={engagementType === value}
                        onChange={() => setEngagementType(value)}
                        className="mt-0.5 size-4 shrink-0 accent-primary"
                      />
                      <span className="min-w-0">
                        <span className="block text-[0.8125rem] font-medium text-fg">
                          {ENGAGEMENT_LABEL[value]}
                        </span>
                        <span className="mt-0.5 block text-[0.75rem] leading-relaxed text-fg-muted">
                          {ENGAGEMENT_DESCRIPTION[value]}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
                {submitted && !engagementType ? (
                  <p role="alert" className="mt-1.5 text-[0.75rem] text-st-danger">
                    Choose whether this driver is a company driver or an owner-operator.
                  </p>
                ) : null}
              </fieldset>
            ) : null}

            {needsRoleName ? (
              <Field
                label="Role name"
                htmlFor="invite-role-name"
                hint={roleNameError ? undefined : "What this person's role is called."}
                error={roleNameError ?? undefined}
              >
                <Input
                  id="invite-role-name"
                  value={roleName}
                  onChange={(e) => setRoleName(e.target.value)}
                  maxLength={ROLE_NAME_MAX_LENGTH}
                  placeholder="Night dispatcher"
                  aria-invalid={roleNameError ? true : undefined}
                  className={cn(roleNameError && "border-st-danger")}
                />
              </Field>
            ) : null}

            {isDispatchOrg ? (
              <Field
                label="Organization name"
                htmlFor="invite-org-name"
                error={orgNameError ?? undefined}
              >
                <Input
                  id="invite-org-name"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="Meridian Dispatch"
                  maxLength={80}
                  aria-invalid={orgNameError ? true : undefined}
                  className={cn(orgNameError && "border-st-danger")}
                />
              </Field>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Field
                  label="First Name"
                  htmlFor="invite-first-name"
                  error={firstNameError ?? undefined}
                >
                  <Input
                    id="invite-first-name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Enter your first name"
                    maxLength={40}
                    aria-invalid={firstNameError ? true : undefined}
                    className={cn(firstNameError && "border-st-danger")}
                  />
                </Field>

                <Field
                  label="Last Name"
                  htmlFor="invite-last-name"
                  error={lastNameError ?? undefined}
                >
                  <Input
                    id="invite-last-name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Enter your last name"
                    maxLength={40}
                    aria-invalid={lastNameError ? true : undefined}
                    className={cn(lastNameError && "border-st-danger")}
                  />
                </Field>
              </div>
            )}

            <Field
              label={isDispatchOrg ? "Administrator's email" : "Email address"}
              htmlFor="invite-email"
              hint={emailError ? undefined : "The invitation link goes here."}
              error={emailError ?? undefined}
            >
              <Input
                id="invite-email"
                type="email"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                placeholder="name@company.com"
                aria-invalid={emailError ? true : undefined}
                className={cn(emailError && "border-st-danger")}
              />
            </Field>
          </div>

          <div className="min-w-0 space-y-4">
            <div>
              <h2 className="text-[0.9375rem] font-semibold text-fg">What they can do</h2>
              <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-fg-muted">
                {savedRole
                  ? `Starting from your ${savedRole.name} role. Changing anything here affects only this invitation.`
                  : preset.kind === "custom"
                    ? "Nothing is selected. Choose exactly what this person can do."
                    : `Starting from the ${preset.label} package. Changing anything here affects only this invitation — the ${preset.label} package stays as it is.`}
              </p>
            </div>

            <SensitiveAccessWarning permissions={selectedList} />

            <ApiPermissionPicker
              selected={permissions}
              onChange={setPermissions}
              grantable={grantable}
            />

            {permissionsError ? (
              <p role="alert" className="text-[0.75rem] font-medium text-st-danger">
                {permissionsError}
              </p>
            ) : null}

            {changedFromPreset ? (
              <div className="rounded-lg border border-border bg-surface-sunken p-3.5">
                <label className="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="checkbox"
                    checked={saveAsRole}
                    onChange={(e) => setSaveAsRole(e.target.checked)}
                    className="mt-0.5 size-4 shrink-0 accent-primary"
                  />
                  <span className="min-w-0">
                    <span className="block text-[0.8125rem] font-medium text-fg">
                      Save this as a custom role
                    </span>
                    <span className="mt-0.5 block text-[0.75rem] leading-relaxed text-fg-muted">
                      You have changed the {preset.label} package for this invitation. Save it as a
                      reusable role if you will want it again.
                    </span>
                  </span>
                </label>
                {saveAsRole ? (
                  <div className="mt-3">
                    <Field
                      label="New role name"
                      htmlFor="invite-save-role"
                      error={newRoleNameError ?? undefined}
                    >
                      <Input
                        id="invite-save-role"
                        value={newRoleName}
                        onChange={(e) => setNewRoleName(e.target.value)}
                        maxLength={ROLE_NAME_MAX_LENGTH}
                        placeholder="Weekend dispatcher"
                        aria-invalid={newRoleNameError ? true : undefined}
                        className={cn(newRoleNameError && "border-st-danger")}
                      />
                    </Field>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" size="lg" onClick={continueToReview}>
                Review invitation
              </Button>
              <Button variant="ghost" size="lg" onClick={() => setStage("type")}>
                Back
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {stage === "review" && preset ? (
        <div className="max-w-[42rem] space-y-4">
          <div className="overflow-hidden rounded-lg border border-border">
            <dl className="divide-y divide-border">
              <ReviewRow label="Recipient" value={`${recipientName.trim()} · ${recipientEmail.trim()}`} />
              <ReviewRow
                label={isDispatchOrg ? "Invitation type" : "Role"}
                value={effectiveRoleName || preset.label}
              />
              {isDriver && engagementType ? (
                <ReviewRow label="Engagement type" value={ENGAGEMENT_LABEL[engagementType]} />
              ) : null}
              <ReviewRow label="Organization" value={organization.displayName} />
              {isDispatchOrg ? (
                <ReviewRow
                  label="Scope"
                  value={`${organization.displayName} only. Not their other carrier clients.`}
                />
              ) : null}
              {saveAsRole && newRoleName.trim() ? (
                <ReviewRow label="Also saving role" value={newRoleName.trim()} />
              ) : null}
            </dl>
          </div>

          <div>
            <h2 className="mb-2 text-[0.9375rem] font-semibold text-fg">
              Everything this grants
            </h2>
            <PermissionSummary permissions={selectedList} />
          </div>

          <SensitiveAccessWarning permissions={selectedList} />

          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-surface p-3.5">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-primary"
            />
            <span className="text-[0.8125rem] leading-relaxed text-fg">
              I have read the list above and I want {recipientName.trim() || "this recipient"} to
              have this access.
            </span>
          </label>

          {refusal ? (
            <div
              role="alert"
              data-testid="invite-refusal"
              className="rounded-md border border-st-danger/40 bg-st-danger-bg/50 px-3.5 py-3 text-[0.8125rem] leading-relaxed"
            >
              <p className="font-medium text-fg">This invitation was not sent.</p>
              <p className="mt-0.5 text-fg-muted">{refusal}</p>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              size="lg"
              disabled={!confirmed || sending}
              aria-busy={sending || undefined}
              onClick={() => commit()}
            >
              {sending ? "Sending…" : "Send invitation"}
            </Button>
            <Button variant="ghost" size="lg" onClick={() => setStage("details")}>
              Back
            </Button>
          </div>
          {!confirmed ? (
            <p className="text-[0.75rem] text-fg-subtle">
              Tick the box above to send the invitation.
            </p>
          ) : null}
        </div>
      ) : null}

      {stage === "sent" ? (
        <div className="max-w-[42rem] space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-st-success/35 bg-st-success-bg/50 px-4 py-3.5">
            <Check className="mt-px size-5 shrink-0 text-st-success" aria-hidden />
            <div className="min-w-0 text-[0.8125rem]">
              <p className="font-medium text-fg">
                Invitation created for {recipientName.trim()}.
              </p>
              <p className="mt-0.5 text-fg-muted">
                An invitation email has been sent to {recipientEmail.trim()}. It is pending until they accept.
                You can revoke it any time from the invitations list.
              </p>
            </div>
          </div>

          {sentToken ? (
            <>
              <Field label="Invitation link" htmlFor="invite-link" hint="Anyone with this link can accept the invitation.">
                <div className="flex gap-2">
                  <Input id="invite-link" readOnly value={invitationLink(sentToken)} className="font-mono text-[0.75rem]" />
                  <Button variant="secondary" onClick={() => copyLink(sentToken)} className="shrink-0">
                    {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
              </Field>
              <p aria-live="polite" className="sr-only">{copied ? "Link copied" : ""}</p>
            </>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => router.push("/settings/invitations")}>
              Done
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setStage("type");
                setPreset(null);
                setSavedRole(null);
                setFirstName("");
                setLastName("");
                setOrgName("");
                setRecipientEmail("");
                setRoleName("");
                setNewRoleName("");
                setSaveAsRole(false);
                setPermissions(new Set());
                setSentToken(null);
                setSubmitted(false);
                setConfirmed(false);
              }}
            >
              <Plus aria-hidden />
              Invite someone else
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3.5 py-2.5">
      <dt className="text-[0.75rem] text-fg-muted">{label}</dt>
      <dd className="text-[0.8125rem] font-medium text-fg">{value}</dd>
    </div>
  );
}

function SelectedTypeCard({
  preset,
  savedRole,
  onChange,
}: {
  preset: InvitationPreset;
  savedRole: PermissionTemplate | null;
  onChange: () => void;
}) {
  const Icon = KIND_ICON[preset.kind];
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-surface p-3.5">
      <span
        aria-hidden
        className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-fg"
      >
        <Icon className="size-[1.125rem]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[0.875rem] font-semibold text-fg">
          {savedRole ? savedRole.name : preset.label}
        </p>
        <p className="mt-0.5 text-[0.75rem] leading-relaxed text-fg-muted">
          {savedRole ? savedRole.description : preset.description}
        </p>
      </div>
      <button
        type="button"
        onClick={onChange}
        className="shrink-0 rounded-sm text-[0.75rem] font-medium text-primary underline-offset-4 hover:underline focus-visible:underline"
      >
        Change
      </button>
    </div>
  );
}

function TypeStep({
  presets,
  roles,
  isLoadingRoles = false,
  onChoose,
}: {
  presets: InvitationPreset[];
  roles: PermissionTemplate[];
  isLoadingRoles?: boolean;
  onChoose: (preset: InvitationPreset, role?: PermissionTemplate) => void;
}) {
  const custom = presets.find((p) => p.kind === "custom")!;
  const headingId = useId();

  return (
    <div className="max-w-[42rem] space-y-5">
      <section aria-labelledby={headingId}>
        <h2 id={headingId} className="mb-2.5 text-[0.9375rem] font-semibold text-fg">
          What are you inviting?
        </h2>
        <div className="space-y-2.5">
          {presets.map((preset) => {
            const Icon = KIND_ICON[preset.kind];
            return (
              <button
                key={`${preset.kind}-${preset.label}`}
                type="button"
                onClick={() => onChoose(preset)}
                className={cn(
                  "group flex w-full items-start gap-3.5 rounded-lg border border-border bg-surface p-4 text-left shadow-e1 transition-colors",
                  "hover:border-border-strong hover:bg-surface-hover",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                )}
              >
                <span
                  aria-hidden
                  className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-fg-muted group-hover:text-fg"
                >
                  <Icon className="size-[1.125rem]" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[0.9375rem] font-semibold text-fg">{preset.label}</span>
                  <span className="mt-0.5 block text-[0.8125rem] leading-relaxed text-fg-muted">
                    {preset.description}
                  </span>
                  {preset.permissions.length > 0 ? (
                    <span className="mt-1.5 block text-[0.75rem] text-fg-subtle">
                      Starts with {preset.permissions.length} permissions ·{" "}
                      {preset.permissions.slice(0, 3).map((k) => permissionMeta(k).label).join(", ")}…
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {isLoadingRoles || roles.length > 0 ? (
        <section aria-labelledby={`${headingId}-roles`}>
          <h2 id={`${headingId}-roles`} className="mb-1 text-[0.9375rem] font-semibold text-fg">
            Or use a role you already made
          </h2>
          <p className="mb-2.5 text-[0.8125rem] text-fg-muted">
            Your saved custom roles. You can still adjust the permissions for this one invitation.
          </p>
          <div className="space-y-2">
            {isLoadingRoles ? (
              <LoadingSkeleton rows={3} />
            ) : (
              roles.map((role) => (
                <button
                  key={role.id}
                  type="button"
                  onClick={() => onChoose(custom, role)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-left transition-colors",
                    "hover:border-border-strong hover:bg-surface-hover",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block text-[0.875rem] font-medium text-fg">{role.name}</span>
                    <span className="mt-0.5 block truncate text-[0.75rem] text-fg-muted">
                      {role.description}
                    </span>
                  </span>
                  <span className="shrink-0 text-[0.75rem] text-fg-subtle tabular-nums">
                    {role.permissions.length} permissions
                  </span>
                </button>
              ))
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
