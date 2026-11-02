"use client";

import { Building2, Check, CheckCircle2, Copy, Plus, Search, ShieldCheck, UserCheck, UserPlus, UserRound, Users, X } from "lucide-react";
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
import { useOrgKeyPrefix } from "@/lib/query/use-org-key";

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
  const orgPrefix = useOrgKeyPrefix();
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
    queryKey: [...orgPrefix, "organizations", "roles"],
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
  const [userMode, setUserMode] = useState<"new" | "existing">("new");
  const [selectedMemberId, setSelectedMemberId] = useState<string>("");
  const [memberSearch, setMemberSearch] = useState("");
  const [memberRoleFilter, setMemberRoleFilter] = useState<"ALL" | "Driver" | "Dispatcher" | "Admin">("ALL");

  const { data: teamMembers = [], isLoading: isLoadingMembers } = useQuery({
    queryKey: [...orgPrefix, "organizations", "team-roster"],
    queryFn: async () => {
      try {
        const [driversRes, dispatchersRes, adminsRes] = await Promise.allSettled([
          apiClient.get("/organizations/drivers", { params: { pageSize: 100 } }),
          apiClient.get("/organizations/dispatchers", { params: { pageSize: 100 } }),
          apiClient.get("/organizations/admins", { params: { pageSize: 100 } }),
        ]);
        const members: Array<{
          id: string;
          userId: string;
          name: string;
          email: string;
          role: string;
          status: string;
          firstName?: string;
          lastName?: string;
        }> = [];
        const seenEmails = new Set<string>();

        if (driversRes.status === "fulfilled") {
          const list = driversRes.value.data?.data || driversRes.value.data || [];
          for (const d of Array.isArray(list) ? list : []) {
            const email = d.email || d.user?.email;
            if (email && !seenEmails.has(email.toLowerCase())) {
              seenEmails.add(email.toLowerCase());
              const uId = String(d.userId || d.user?.id || d.id || "");
              members.push({
                id: uId || email,
                userId: uId,
                name: [d.firstName, d.lastName].filter(Boolean).join(" ") || d.name || email,
                email,
                role: "Driver",
                status: d.accountStatus || "ACTIVE",
                firstName: d.firstName || "",
                lastName: d.lastName || "",
              });
            }
          }
        }

        if (dispatchersRes.status === "fulfilled") {
          const list = dispatchersRes.value.data?.data || dispatchersRes.value.data || [];
          for (const d of Array.isArray(list) ? list : []) {
            const email = d.email || d.user?.email;
            if (email && !seenEmails.has(email.toLowerCase())) {
              seenEmails.add(email.toLowerCase());
              const uId = String(d.userId || d.user?.id || d.id || "");
              members.push({
                id: uId || email,
                userId: uId,
                name: [d.firstName, d.lastName].filter(Boolean).join(" ") || d.name || email,
                email,
                role: "Dispatcher",
                status: d.accountStatus || "ACTIVE",
                firstName: d.firstName || "",
                lastName: d.lastName || "",
              });
            }
          }
        }

        if (adminsRes.status === "fulfilled") {
          const list = adminsRes.value.data?.data || adminsRes.value.data || [];
          for (const a of Array.isArray(list) ? list : []) {
            const email = a.email || a.user?.email;
            if (email && !seenEmails.has(email.toLowerCase())) {
              seenEmails.add(email.toLowerCase());
              const uId = String(a.userId || a.user?.id || a.id || "");
              members.push({
                id: uId || email,
                userId: uId,
                name: [a.firstName, a.lastName].filter(Boolean).join(" ") || a.name || email,
                email,
                role: "Admin",
                status: a.accountStatus || "ACTIVE",
                firstName: a.firstName || "",
                lastName: a.lastName || "",
              });
            }
          }
        }

        return members;
      } catch {
        return [];
      }
    },
    enabled: userMode === "existing",
  });

  const filteredMembers = useMemo(() => {
    let result = teamMembers;

    if (memberRoleFilter !== "ALL") {
      result = result.filter((m) => m.role.toLowerCase() === memberRoleFilter.toLowerCase());
    }

    if (memberSearch.trim()) {
      const q = memberSearch.trim().toLowerCase();
      result = result.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.email.toLowerCase().includes(q) ||
          m.role.toLowerCase().includes(q)
      );
    }

    return result;
  }, [teamMembers, memberRoleFilter, memberSearch]);

  const roleCounts = useMemo(() => {
    const counts = { ALL: teamMembers.length, Driver: 0, Dispatcher: 0, Admin: 0 };
    for (const m of teamMembers) {
      if (m.role === "Driver") counts.Driver++;
      else if (m.role === "Dispatcher") counts.Dispatcher++;
      else if (m.role === "Admin") counts.Admin++;
    }
    return counts;
  }, [teamMembers]);

  const selectedUser = useMemo(() => {
    if (!selectedMemberId && !recipientEmail) return null;
    return (
      teamMembers.find(
        (m) =>
          (selectedMemberId && (m.id === selectedMemberId || m.userId === selectedMemberId)) ||
          (recipientEmail && m.email.toLowerCase() === recipientEmail.toLowerCase())
      ) || null
    );
  }, [teamMembers, selectedMemberId, recipientEmail]);

  function handleSelectMember(member: (typeof teamMembers)[0]) {
    setSelectedMemberId(member.userId || member.id);
    setRecipientEmail(member.email);
    setFirstName(member.firstName || member.name.split(" ")[0] || "");
    setLastName(member.lastName || member.name.split(" ").slice(1).join(" ") || "");
  }

  function handleDeselectMember() {
    setSelectedMemberId("");
    setRecipientEmail("");
    setFirstName("");
    setLastName("");
  }

  function handleSwitchToNew() {
    setUserMode("new");
    setSelectedMemberId("");
    setRecipientEmail("");
    setFirstName("");
    setLastName("");
    setOrgName("");
    setSubmitted(false);
  }

  function handleSwitchToExisting() {
    setUserMode("existing");
    setSelectedMemberId("");
    setRecipientEmail("");
    setFirstName("");
    setLastName("");
    setOrgName("");
    setMemberSearch("");
    setSubmitted(false);
  }

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
    : [firstName.trim(), lastName.trim()].filter(Boolean).join(" ") ||
      (userMode === "existing" ? recipientEmail.trim() : "");
  const isDriver = preset?.kind === "driver";
  const needsRoleName = preset?.kind === "custom" && !savedRole;
  const effectiveRoleName = savedRole?.name ?? (needsRoleName ? roleName.trim() : preset?.label ?? "");

  const changedFromPreset =
    preset != null && !savedRole && !sameSet(preset.permissions, permissions);

  const selectedList = useMemo(() => [...permissions], [permissions]);

  const isAdminRole = useMemo(() => {
    const roleCandidate = (savedRole?.name || preset?.label || effectiveRoleName || roleName || "").toLowerCase().trim();
    const kindCandidate = (preset?.kind || "").toLowerCase().trim();
    const idCandidate = (savedRole?.id || "").toLowerCase().trim();
    const userRoleCandidate = (userMode === "existing" && selectedUser?.role ? selectedUser.role : "").toLowerCase().trim();

    return (
      roleCandidate.includes("admin") ||
      kindCandidate === "admin" ||
      idCandidate === "admin" ||
      userRoleCandidate.includes("admin")
    );
  }, [savedRole, preset, effectiveRoleName, roleName, userMode, selectedUser]);

  function choose(next: InvitationPreset, role?: PermissionTemplate) {
    setPreset(next);
    setSavedRole(role ?? null);
    // A preset arrives pre-ticked; anything the granter cannot hand out is
    // dropped rather than silently promised.
    const base = role ? role.permissions : next.permissions.map(migrateKey);
    setPermissions(new Set(isOwner ? base : clampToGrantable(base, myPermissions, orgType)));
    setRoleName(role?.name ?? "");
    setEngagementType(next.kind === "driver" ? "company_driver" : null);
    setUserMode("new");
    setSelectedMemberId("");
    if (!handoff) {
      setFirstName("");
      setLastName("");
      setOrgName("");
      setRecipientEmail("");
    }
    setMemberSearch("");
    setMemberRoleFilter("ALL");
    setSubmitted(false);
    setStage("details");
  }

  const memberSelectError =
    submitted && userMode === "existing" && !recipientEmail.trim()
      ? "Please select an existing user from the list to continue."
      : null;

  const orgNameError = submitted && isDispatchOrg && !orgName.trim() ? "Enter the organization's name." : null;
  const firstNameError =
    submitted && userMode === "new" && !isDispatchOrg && !firstName.trim()
      ? "Enter their first name."
      : null;
  const lastNameError =
    submitted && userMode === "new" && !isDispatchOrg && !lastName.trim()
      ? "Enter their last name."
      : null;
  const emailError = submitted && userMode === "new" ? validateEmail(recipientEmail) : null;
  const roleNameError =
    submitted && needsRoleName ? validateRoleName(roleName, roles.map((r) => r.name)) : null;
  const permissionsError =
    submitted && permissions.size === 0 ? "Select at least one permission." : null;

  function continueToReview() {
    setSubmitted(true);
    const bad =
      (userMode === "new" &&
        ((isDispatchOrg ? !orgName.trim() : !firstName.trim() || !lastName.trim()) ||
          validateEmail(recipientEmail))) ||
      (userMode === "existing" && !recipientEmail.trim()) ||
      (isDriver && userMode === "new" && !engagementType) ||
      (needsRoleName && validateRoleName(roleName, roles.map((r) => r.name))) ||
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

      // Automatically create role internally if preset is custom or permissions were customized
      const shouldCreateRole =
        (preset.kind === "custom" && !savedRole) || (changedFromPreset && !savedRole);

      if (shouldCreateRole) {
        const roleToCreateName =
          roleName.trim() ||
          (preset.kind === "custom"
            ? "Custom Role"
            : `${preset.label} (Custom)`);

        const roleDraft = {
          name: roleToCreateName,
          description:
            userMode === "existing"
              ? `Custom permissions for ${recipientName.trim() || recipientEmail.trim()}`
              : `Custom role created for ${recipientName.trim() || recipientEmail.trim()}`,
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
        queryClient.invalidateQueries({ queryKey: [...orgPrefix, "organizations", "roles"] });
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

      let invitePayload: any;

      if (userMode === "existing") {
        const resolvedUserId = selectedUser?.userId || selectedUser?.id || selectedMemberId;
        invitePayload = {
          userId: resolvedUserId,
          roleId: roleIdToUse,
          permissions: safePermissions,
        };
      } else {
        const fName = isDispatchOrg
          ? orgName.trim().split(/\s+/)[0] || orgName.trim()
          : firstName.trim();
        const lName = isDispatchOrg
          ? orgName.trim().split(/\s+/).slice(1).join(" ") || "Admin"
          : lastName.trim();

        invitePayload = {
          email: recipientEmail.trim(),
          firstName: fName,
          lastName: lName,
          roleId: roleIdToUse,
          permissions: safePermissions,
        };
      }

      const inviteRes = await apiClient.post("/organizations/invitations", invitePayload);
      const inviteData = inviteRes.data?.data || inviteRes.data?.invitation || inviteRes.data;
      const token = inviteData?.token || inviteData?.code || inviteData?.id || null;

      if (referralId && ctx) {
        void services.referrals.recordInvitation(ctx, referralId, inviteData?.id || "sent");
      }

      queryClient.invalidateQueries({ queryKey: [...orgPrefix, "organizations", "invitations"] });

      setSentToken(token);
      setSending(false);
      setStage("sent");
      toast.success(
        userMode === "existing"
          ? `Permission update invitation sent to ${recipientEmail.trim()}`
          : `Invitation sent to ${recipientEmail.trim()}`
      );

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

            {/* User Target Toggle: New User vs Existing User */}
            <div className="space-y-1.5">
              <label className="text-[0.6875rem] font-semibold uppercase tracking-wider text-fg-muted">
                User Type
              </label>
              <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-border bg-surface-sunken/60 p-1">
                <button
                  type="button"
                  onClick={handleSwitchToNew}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-lg py-2.5 px-3 text-center transition-all",
                    userMode === "new"
                      ? "bg-surface text-primary shadow-xs border border-border/80 font-semibold"
                      : "text-fg-muted hover:text-fg hover:bg-surface/40 font-medium"
                  )}
                >
                  <UserPlus className="size-4 shrink-0" />
                  <div className="text-left min-w-0">
                    <span className="block text-[0.8125rem] leading-none">New User</span>
                    <span className="block text-[0.6875rem] opacity-75 mt-0.5 leading-tight font-normal truncate">
                      Custom permissions
                    </span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={handleSwitchToExisting}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-lg py-2.5 px-3 text-center transition-all",
                    userMode === "existing"
                      ? "bg-surface text-primary shadow-xs border border-border/80 font-semibold"
                      : "text-fg-muted hover:text-fg hover:bg-surface/40 font-medium"
                  )}
                >
                  <UserCheck className="size-4 shrink-0" />
                  <div className="text-left min-w-0">
                    <span className="block text-[0.8125rem] leading-none">Existing User</span>
                    <span className="block text-[0.6875rem] opacity-75 mt-0.5 leading-tight font-normal truncate">
                      Change permissions
                    </span>
                  </div>
                </button>
              </div>
              <p className="text-[0.75rem] text-fg-muted">
                {userMode === "new"
                  ? "Send an invitation to a new person with custom permissions."
                  : "Change or grant custom permissions for an existing user."}
              </p>
            </div>

            {userMode === "existing" ? (
              <div className="space-y-3.5">
                {needsRoleName ? (
                  <Field
                    label="Role name"
                    htmlFor="invite-role-name"
                    hint={roleNameError ? undefined : "What this custom role is called."}
                    error={roleNameError ?? undefined}
                  >
                    <Input
                      id="invite-role-name"
                      value={roleName}
                      onChange={(e) => setRoleName(e.target.value)}
                      maxLength={ROLE_NAME_MAX_LENGTH}
                      placeholder="e.g. Senior Dispatcher / Weekend Lead"
                      aria-invalid={roleNameError ? true : undefined}
                      className={cn(roleNameError && "border-st-danger")}
                    />
                  </Field>
                ) : null}

                {/* Existing User Searching & Filter Section */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[0.8125rem] font-semibold text-fg">
                      Select Existing User
                    </label>
                    {selectedUser ? (
                      <span className="text-[0.6875rem] font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full border border-primary/20">
                        1 Selected
                      </span>
                    ) : (
                      <span className="text-[0.6875rem] text-fg-muted">
                        {teamMembers.length} team members
                      </span>
                    )}
                  </div>

                  {/* Search Bar */}
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-fg-muted pointer-events-none" />
                    <Input
                      value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)}
                      placeholder="Search by name, email, or role…"
                      className="pl-9 pr-8 h-9.5 text-[0.8125rem] bg-surface"
                    />
                    {memberSearch ? (
                      <button
                        type="button"
                        onClick={() => setMemberSearch("")}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-fg-muted hover:text-fg rounded"
                      >
                        <X className="size-3.5" />
                      </button>
                    ) : null}
                  </div>

                  {/* Filter Pills */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(["ALL", "Driver", "Dispatcher", "Admin"] as const).map((r) => {
                      const count = roleCounts[r] || 0;
                      const isActive = memberRoleFilter === r;
                      return (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setMemberRoleFilter(r)}
                          className={cn(
                            "px-2.5 py-1 text-[0.6875rem] rounded-md font-medium transition-colors border",
                            isActive
                              ? "bg-primary text-white border-primary shadow-xs font-semibold"
                              : "bg-surface-sunken/70 text-fg-muted border-border hover:text-fg hover:bg-surface"
                          )}
                        >
                          {r === "ALL" ? "All" : r} ({count})
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Validation Error if none selected */}
                {memberSelectError ? (
                  <div
                    role="alert"
                    className="rounded-lg border border-st-danger/40 bg-st-danger-bg/50 px-3 py-2 text-[0.75rem] font-medium text-st-danger"
                  >
                    {memberSelectError}
                  </div>
                ) : null}

                {/* Users Listing */}
                <div className="rounded-xl border border-border bg-surface-sunken/40 overflow-hidden">
                  {isLoadingMembers ? (
                    <div className="p-4 space-y-2.5">
                      <div className="h-12 rounded-lg bg-surface animate-pulse" />
                      <div className="h-12 rounded-lg bg-surface animate-pulse" />
                      <div className="h-12 rounded-lg bg-surface animate-pulse" />
                    </div>
                  ) : filteredMembers.length === 0 ? (
                    <div className="p-6 text-center space-y-1.5">
                      <Users className="size-7 text-fg-muted/40 mx-auto" />
                      <p className="text-[0.8125rem] font-medium text-fg">No users found</p>
                      <p className="text-[0.75rem] text-fg-muted">
                        {memberSearch || memberRoleFilter !== "ALL"
                          ? "Try adjusting or clearing your search filter."
                          : "No existing members found in this organization."}
                      </p>
                      {memberSearch || memberRoleFilter !== "ALL" ? (
                        <button
                          type="button"
                          onClick={() => {
                            setMemberSearch("");
                            setMemberRoleFilter("ALL");
                          }}
                          className="text-[0.75rem] font-medium text-primary hover:underline pt-1"
                        >
                          Reset filters
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <div className="max-h-[19rem] overflow-y-auto divide-y divide-border/60 p-1.5 space-y-1">
                      {filteredMembers.map((member) => {
                        const isSelected =
                          selectedMemberId === member.id || recipientEmail === member.email;
                        const initials =
                          member.name
                            .split(" ")
                            .filter(Boolean)
                            .map((p) => p[0])
                            .slice(0, 2)
                            .join("")
                            .toUpperCase() || "U";

                        return (
                          <div
                            key={member.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => handleSelectMember(member)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                handleSelectMember(member);
                              }
                            }}
                            className={cn(
                              "flex items-center justify-between gap-3 p-2.5 rounded-lg cursor-pointer transition-all border",
                              isSelected
                                ? "bg-primary/10 border-primary shadow-xs ring-1 ring-primary/40"
                                : "border-transparent bg-surface hover:border-border hover:bg-surface-elevated"
                            )}
                          >
                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                              <div
                                className={cn(
                                  "size-9 rounded-full flex items-center justify-center text-[0.6875rem] font-bold shrink-0 border",
                                  isSelected
                                    ? "bg-primary text-white border-primary"
                                    : "bg-surface-sunken text-primary border-border"
                                )}
                              >
                                {initials}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <p className="text-[0.8125rem] font-semibold text-fg truncate">
                                    {member.name}
                                  </p>
                                  <span className="px-1.5 py-0.2 rounded text-[0.625rem] font-medium bg-surface-sunken text-fg-muted border border-border shrink-0">
                                    {member.role}
                                  </span>
                                </div>
                                <p className="text-[0.75rem] text-fg-muted truncate">
                                  {member.email}
                                </p>
                              </div>
                            </div>

                            <div className="shrink-0 flex items-center pl-1">
                              {isSelected ? (
                                <CheckCircle2 className="size-5 text-primary" />
                              ) : (
                                <div className="size-4.5 rounded-full border border-border" />
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Selected User Callout */}
                {selectedUser ? (
                  <div className="rounded-lg border border-primary/30 bg-primary/[0.06] p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex items-center gap-2.5">
                      <CheckCircle2 className="size-4 shrink-0 text-primary" />
                      <div className="min-w-0 text-[0.75rem]">
                        <p className="font-semibold text-fg truncate">
                          {selectedUser.name}{" "}
                          <span className="font-normal text-fg-muted">({selectedUser.role})</span>
                        </p>
                        <p className="text-fg-muted truncate">{selectedUser.email}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleDeselectMember}
                      className="text-[0.75rem] font-medium text-fg-muted hover:text-fg underline shrink-0"
                    >
                      Deselect
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              /* New User Form Fields */
              <>
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
                        placeholder="Enter first name"
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
                        placeholder="Enter last name"
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
              </>
            )}
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

            {!isAdminRole ? <SensitiveAccessWarning permissions={selectedList} /> : null}

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

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary" size="lg" onClick={continueToReview}>
                {userMode === "existing" ? "Review permission change" : "Review invitation"}
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
              <ReviewRow
                label="Invitation type"
                value={userMode === "existing" ? "Existing User (Permission Update)" : "New User (Custom Permissions)"}
              />
              <ReviewRow
                label="Recipient"
                value={`${(recipientName || recipientEmail).trim()} · ${recipientEmail.trim()}`}
              />
              <ReviewRow
                label={isDispatchOrg ? "Invitation type" : "Role"}
                value={effectiveRoleName || (changedFromPreset ? `${preset.label} (Custom)` : preset.label)}
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
            </dl>
          </div>

          <div>
            <h2 className="mb-2 text-[0.9375rem] font-semibold text-fg">
              Everything this grants
            </h2>
            <PermissionSummary permissions={selectedList} />
          </div>

          {!isAdminRole ? <SensitiveAccessWarning permissions={selectedList} /> : null}

          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-surface p-3.5">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-primary"
            />
            <span className="text-[0.8125rem] leading-relaxed text-fg">
              I have read the list above and I want {recipientName.trim() || recipientEmail.trim() || "this recipient"} to
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
              {sending
                ? "Sending…"
                : userMode === "existing"
                  ? "Send permission update"
                  : "Send invitation"}
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
                {userMode === "existing"
                  ? `Permission update invitation created for ${(recipientName || recipientEmail).trim()}.`
                  : `Invitation created for ${recipientName.trim()}.`}
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
                setUserMode("new");
                setSelectedMemberId("");
                setMemberSearch("");
                setMemberRoleFilter("ALL");
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
