"use client";

import { Building2, Check, Copy, Plus, ShieldCheck, UserRound, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/layout/page-header";
import {
  ROLE_NAME_MAX_LENGTH,
  clampToGrantable,
  grantablePermissionKeys,
  permissionMeta,
  validateRoleName,
} from "@/lib/permissions";
import { useActiveMembership, usePermissions } from "@/lib/session/hooks";
import type { CustomRole, EngagementType, PermissionKey } from "@/types";
import { ENGAGEMENT_DESCRIPTION, ENGAGEMENT_LABEL } from "@/features/driver/driver-rules";
import { PermissionPicker } from "./permission-picker";
import {
  NeverGrantableNotice,
  PermissionSummary,
  SensitiveAccessWarning,
} from "./permission-summary";
import { invitationPresets, type InvitationPreset } from "./presets";
import {
  invitationLink,
  mockCreateRole,
  mockListRoles,
} from "./mock-access";
import { services } from "@/lib/api";
import { useServiceContext } from "@/lib/api/use-service-context";
import { PermissionDeniedError } from "@/lib/api/contracts/context";
import { validateEmail } from "@/features/auth/rules";
import { cn } from "@/lib/utils";
import { useEffect } from "react";

type Stage = "type" | "details" | "review" | "sent";

const EXPIRY_CHOICES = [
  { days: 7, label: "7 days" },
  { days: 14, label: "14 days" },
  { days: 30, label: "30 days" },
  { days: 0, label: "No expiry" },
] as const;

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

function sameSet(a: readonly PermissionKey[], b: ReadonlySet<PermissionKey>): boolean {
  return a.length === b.size && a.every((k) => b.has(k));
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
  const { membership, organization } = useActiveMembership();
  const ctx = useServiceContext();
  const myPermissions = usePermissions();

  const [stage, setStage] = useState<Stage>("type");
  const [preset, setPreset] = useState<InvitationPreset | null>(null);
  const [savedRole, setSavedRole] = useState<CustomRole | null>(null);
  const [roles, setRoles] = useState<CustomRole[]>([]);

  const [roleName, setRoleName] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [expiryDays, setExpiryDays] = useState<number>(14);
  const [permissions, setPermissions] = useState<Set<PermissionKey>>(new Set());

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

  const grantable = useMemo(
    () => new Set(grantablePermissionKeys(myPermissions, orgType)),
    [myPermissions, orgType],
  );

  useEffect(() => {
    if (!organization) return;
    let cancelled = false;
    mockListRoles(organization.id).then((list) => {
      if (!cancelled) setRoles(list.filter((r) => !r.archived));
    });
    return () => {
      cancelled = true;
    };
  }, [organization]);

  const isDispatchOrg = preset?.kind === "dispatch_org";
  const isDriver = preset?.kind === "driver";
  const needsRoleName = preset?.kind === "custom" && !savedRole;
  const effectiveRoleName = savedRole?.name ?? (needsRoleName ? roleName.trim() : preset?.label ?? "");

  const changedFromPreset =
    preset != null && !savedRole && !sameSet(preset.permissions, permissions);

  const selectedList = useMemo(() => [...permissions], [permissions]);

  function choose(next: InvitationPreset, role?: CustomRole) {
    setPreset(next);
    setSavedRole(role ?? null);
    // A preset arrives pre-ticked; anything the granter cannot hand out is
    // dropped rather than silently promised.
    const base = role ? role.permissions : next.permissions;
    setPermissions(new Set(clampToGrantable(base, myPermissions, orgType)));
    setRoleName(role?.name ?? "");
    setEngagementType(next.kind === "driver" ? "company_driver" : null);
    setSaveAsRole(false);
    setNewRoleName("");
    setSubmitted(false);
    setStage("details");
  }

  const nameError = submitted && !recipientName.trim()
    ? isDispatchOrg
      ? "Enter the organization's name."
      : "Enter their name."
    : null;
  const emailError = submitted ? validateEmail(recipientEmail) : null;
  const roleNameError =
    submitted && needsRoleName ? validateRoleName(roleName, []) : null;
  const newRoleNameError =
    submitted && saveAsRole
      ? validateRoleName(newRoleName, roles.map((r) => r.name))
      : null;

  function continueToReview() {
    setSubmitted(true);
    const bad =
      !recipientName.trim() ||
      (isDriver && !engagementType) ||
      validateEmail(recipientEmail) ||
      (needsRoleName && validateRoleName(roleName, [])) ||
      (saveAsRole && validateRoleName(newRoleName, roles.map((r) => r.name)));
    if (bad) return;
    setConfirmed(false);
    setStage("review");
  }

  async function commit(alsoCopy: boolean) {
    if (!organization || !preset || sending || !confirmed) return;
    setSending(true);
    setRefusal(null);

    // Belt and braces: whatever the UI allowed, the invitation can never exceed
    // what this owner personally holds.
    const safe = clampToGrantable(selectedList, myPermissions, orgType);

    let customRoleId = savedRole?.id;
    if (saveAsRole && !savedRole) {
      const created = await mockCreateRole(organization.id, {
        name: newRoleName,
        description: `Saved from an invitation to ${recipientName.trim()}.`,
        permissions: safe,
      });
      customRoleId = created.id;
    }

    if (!ctx) return;

    /*
     * ★ THE SERVICE DECIDES, AND A REFUSAL IS READ RATHER THAN THROWN ★
     *
     * This screen no longer builds an `Invitation` and does not get the last
     * word on what goes in one. The service re-checks `invitations:create`,
     * re-checks that nothing here exceeds what this seat actually holds,
     * snapshots the organization from the CONTEXT rather than from a field on
     * this form, and records the issue — or the refusal — in the ledger.
     *
     * "You cannot give somebody access you do not have yourself" is a sentence
     * the owner needs to read, with the keys named, not an exception.
     */
    let invitation;
    try {
      invitation = await services.access.create(ctx, {
        kind: preset.kind,
        roleName: effectiveRoleName || preset.label,
        customRoleId,
        engagementType: engagementType ?? undefined,
        recipientName,
        recipientEmail,
        permissions: safe,
        scopedToCarrierName: isDispatchOrg ? organization.displayName : undefined,
        expiresAt: expiryIso(expiryDays),
      });
    } catch (error) {
      setRefusal(
        error instanceof PermissionDeniedError
          ? "You cannot give somebody access you do not have yourself: "
            + `${error.required.map((k) => permissionMeta(k).label).join(", ")}.`
          : error instanceof Error ? error.message : "This invitation was not sent.",
      );
      setSending(false);
      return;
    }

    setSentToken(invitation.token);
    setSending(false);
    setStage("sent");
    if (alsoCopy) void copyLink(invitation.token);
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

      {stage === "type" ? (
        <TypeStep presets={presets} roles={roles} onChoose={choose} />
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

            <Field
              label={isDispatchOrg ? "Organization name" : "Their name"}
              htmlFor="invite-name"
              error={nameError ?? undefined}
            >
              <Input
                id="invite-name"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder={isDispatchOrg ? "Meridian Dispatch" : "Yusuf Demir"}
                maxLength={80}
                aria-invalid={nameError ? true : undefined}
                className={cn(nameError && "border-st-danger")}
              />
            </Field>

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

            <fieldset>
              <legend className="mb-1.5 text-[0.8125rem] font-medium text-fg">
                Invitation expires
              </legend>
              <div className="flex flex-wrap gap-1.5">
                {EXPIRY_CHOICES.map((choice) => (
                  <button
                    key={choice.days}
                    type="button"
                    aria-pressed={expiryDays === choice.days}
                    onClick={() => setExpiryDays(choice.days)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-[0.75rem] font-medium transition-colors",
                      "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                      expiryDays === choice.days
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-surface text-fg-muted hover:border-border-strong hover:text-fg",
                    )}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[0.75rem] text-fg-subtle">Optional. Links with no expiry stay usable until revoked.</p>
            </fieldset>

            <NeverGrantableNotice />
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

            <PermissionPicker
              orgType={orgType}
              selected={permissions}
              onChange={setPermissions}
              grantable={grantable}
            />

            <SensitiveAccessWarning permissions={selectedList} />

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
              <ReviewRow
                label="Expires"
                value={expiryDays > 0 ? `In ${expiryDays} days` : "Never — usable until revoked"}
              />
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
              onClick={() => commit(false)}
            >
              {sending ? "Sending…" : "Send invitation"}
            </Button>
            <Button
              variant="secondary"
              size="lg"
              disabled={!confirmed || sending}
              onClick={() => commit(true)}
            >
              <Copy aria-hidden />
              Create and copy link
            </Button>
            <Button variant="ghost" size="lg" onClick={() => setStage("details")}>
              Back
            </Button>
          </div>
          {!confirmed ? (
            <p className="text-[0.75rem] text-fg-subtle">
              Tick the box above to send or copy the link.
            </p>
          ) : null}
        </div>
      ) : null}

      {stage === "sent" && sentToken ? (
        <div className="max-w-[42rem] space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-st-success/35 bg-st-success-bg/50 px-4 py-3.5">
            <Check className="mt-px size-5 shrink-0 text-st-success" aria-hidden />
            <div className="min-w-0 text-[0.8125rem]">
              <p className="font-medium text-fg">
                Invitation created for {recipientName.trim()}.
              </p>
              <p className="mt-0.5 text-fg-muted">
                It is pending until they accept. You can revoke it any time from the invitations
                list.
              </p>
            </div>
          </div>

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
                setRecipientName("");
                setRecipientEmail("");
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
  savedRole: CustomRole | null;
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
  onChoose,
}: {
  presets: InvitationPreset[];
  roles: CustomRole[];
  onChoose: (preset: InvitationPreset, role?: CustomRole) => void;
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

      {roles.length > 0 ? (
        <section aria-labelledby={`${headingId}-roles`}>
          <h2 id={`${headingId}-roles`} className="mb-1 text-[0.9375rem] font-semibold text-fg">
            Or use a role you already made
          </h2>
          <p className="mb-2.5 text-[0.8125rem] text-fg-muted">
            Your saved custom roles. You can still adjust the permissions for this one invitation.
          </p>
          <div className="space-y-2">
            {roles.map((role) => (
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
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
