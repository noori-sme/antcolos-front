"use client";

import type { Invitation } from "@/types";
import { ensureSeeded, invitationsForOrganization } from "@/lib/api/mock/access-store";
import { seedInvitations } from "@/lib/api/mock/access-seed";

/**
 * ███ MOCK ONLY — NOT A BACKEND ███
 *
 * What is left of the feature-local access mock: one read, and a URL builder.
 *
 * ★ WHAT USED TO BE HERE, AND WHY IT IS NOT ★
 * A second role system. `CustomRole` records lived in this file with their own
 * store, their own create/update/duplicate/archive/delete functions and a
 * hand-written `memberCount` — and nothing connected any of it to a Membership.
 * Editing one of those roles changed nobody's access, not because the product
 * had decided that, but because no code path from them to a permission existed.
 * The headcount printed beside each one was a fixture number.
 *
 * Roles are now `PermissionTemplate`, they live in
 * `@/lib/api/mock/template-store`, they are reached through the Access service
 * like everything else, their member counts are counted off the live roster,
 * and applying one writes a snapshot onto the seat. There is one template type
 * and one permission catalog.
 */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Invitations this organization has sent.
 *
 * A READ, delegated to the one store the Access service owns. It is kept only
 * because two existing-behaviour suites read invitations through it; everything
 * that CHANGES an invitation goes through `services.access`. There is no second
 * list here.
 */
export async function mockListInvitations(organizationId: string): Promise<Invitation[]> {
  await sleep(300);
  ensureSeeded(seedInvitations);
  return invitationsForOrganization(organizationId);
}

/** The URL that goes in the email. Absolute so it can be pasted anywhere. */
export function invitationLink(token: string): string {
  const origin = typeof window === "undefined" ? "https://app.antcolos.com" : window.location.origin;
  return `${origin}/invitation/${token}`;
}
