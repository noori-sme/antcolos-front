import type { NeedsYouItem } from "@/types";
import { OrganizationScopeError } from "../contracts/context";
import { buildSeed, type OrgData } from "./seed";

/**
 * In-memory store, partitioned by organization. Mutations persist for the
 * session so the UI behaves like a real system. Every accessor REQUIRES an
 * organizationId — there is no way to read across the boundary.
 */
class MockStore {
  private data = buildSeed();

  org(organizationId: string): OrgData {
    const org = this.data[organizationId];
    if (!org) throw new OrganizationScopeError(organizationId, "(none seeded)");
    return org;
  }

  /** Guards against a record from one organization being read through another. */
  assertOwned(organizationId: string, recordOrgId: string) {
    if (organizationId !== recordOrgId) {
      throw new OrganizationScopeError(recordOrgId, organizationId);
    }
  }

  replaceNeedsYou(organizationId: string, next: NeedsYouItem) {
    this.assertOwned(organizationId, next.organizationId);
    const org = this.org(organizationId);
    const i = org.needsYou.findIndex((n) => n.id === next.id);
    if (i >= 0) org.needsYou[i] = next;
  }

  /**
   * Registers a derived item once, then leaves it alone.
   *
   * Items the fleet layer computes from the permanent records arrive with a
   * stable id. Inserting them here on first sight — and never overwriting them
   * afterwards — is what lets them be assigned, snoozed and resolved like any
   * other item instead of resetting every time a screen recomputes them.
   *
   * Returns false when the organization holds no store, which is not an error:
   * an organization with no seeded operational data still has a fleet.
   */
  registerNeedsYou(organizationId: string, items: NeedsYouItem[]): boolean {
    let org: OrgData;
    try {
      org = this.org(organizationId);
    } catch {
      return false;
    }
    const known = new Set(org.needsYou.map((n) => n.id));
    for (const candidate of items) {
      this.assertOwned(organizationId, candidate.organizationId);
      if (!known.has(candidate.id)) org.needsYou.push(candidate);
    }
    return true;
  }

  /** Test/debug helper. Not used by the UI. */
  reset() {
    this.data = buildSeed();
  }
}

export const mockStore = new MockStore();
