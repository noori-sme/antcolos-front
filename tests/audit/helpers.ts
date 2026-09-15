import { services } from "@/lib/api";
import { resetAuditLedger } from "@/lib/api/mock/audit-ledger";
import { resetRiskStore } from "@/lib/api/mock/risk-store";
import type { ServiceContext } from "@/lib/api/contracts/context";
import type { AuditEvent, PermissionKey, RiskCase, RiskSignal } from "@/types";
import {
  BAXTER_OWNER, CASCADE_DRIVER, MERIDIAN_DISPATCHER, NORTHLINE_OWNER,
  SUMMIT_OWNER, contextFor, withoutPermissions, withPermissions,
} from "../support/context";

export {
  BAXTER_OWNER, CASCADE_DRIVER, MERIDIAN_DISPATCHER, NORTHLINE_OWNER,
  SUMMIT_OWNER, contextFor, withoutPermissions, withPermissions,
};

export const audit = services.audit;
export const risk = services.risk;

export function resetAuditAndRisk() {
  resetAuditLedger();
  resetRiskStore();
}

/**
 * The same Northline context under a DIFFERENT membership.
 *
 * Separation of duties is about who the case is about, so the tests need two
 * people in one organization, and the fixtures ship one person per workspace.
 */
export function asMembership(
  base: ServiceContext,
  membershipId: string,
  displayName: string,
): ServiceContext {
  return {
    ...base,
    membershipId,
    actor: { ...base.actor, membershipId, displayNameSnapshot: displayName },
  };
}

export function riskWorker(
  membershipId = "mem_nl_reviewer",
  displayName = "Nadia Brandt",
): ServiceContext {
  const base = contextFor(NORTHLINE_OWNER);
  return asMembership(base, membershipId, displayName);
}

/** A context holding exactly the keys named, and nothing else. */
export function withOnly(
  base: ServiceContext,
  ...keys: PermissionKey[]
): ServiceContext {
  return { ...base, permissions: new Set(keys) };
}

export async function allEvents(ctx: ServiceContext): Promise<AuditEvent[]> {
  const page = await audit.list(ctx, { limit: 1000 });
  return page.items;
}

export async function signalWith(
  ctx: ServiceContext,
  predicate: (s: RiskSignal) => boolean,
): Promise<RiskSignal> {
  const signals = await risk.signals(ctx);
  const found = signals.find(predicate);
  if (!found) {
    throw new Error(
      `No signal matched. Got: ${signals.map((s) => `${s.ruleId} ${s.id}`).join(", ")}`,
    );
  }
  return found;
}

/** Opens a case off one signal, as somebody who is not its subject. */
export async function openCaseFor(
  ctx: ServiceContext,
  signal: RiskSignal,
  title = "Investigation",
): Promise<RiskCase> {
  return risk.openCase(ctx, {
    title,
    summary: "Opened by the test harness.",
    signalIds: [signal.id],
  });
}
