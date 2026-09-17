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

  /**
   * The organization's data, or nothing.
   *
   * `org()` throws for an organization with no seeded data, which is right for
   * a caller acting IN that organization — it is a programming error. It is
   * wrong for a caller sweeping the organizations a grant points at: a carrier
   * can perfectly well have granted dispatch access and have no seeded loads,
   * and that is an empty list rather than a fault.
   */
  maybeOrg(organizationId: string): OrgData | undefined {
    return this.data[organizationId];
  }

  /** Guards against a record from one organization being read through another. */
  assertOwned(organizationId: string, recordOrgId: string) {
    if (organizationId !== recordOrgId) {
      throw new OrganizationScopeError(recordOrgId, organizationId);
    }
  }

  /**
   * The organization's Needs You list, to be reconciled in place.
   *
   * Handed out as the live array rather than a copy because the derivation
   * service adds, refreshes and removes items on every read, and copying would
   * mean an item's snooze and history were rebuilt from nothing each time.
   * Nothing else in the app writes to it — every other caller goes through
   * `replaceNeedsYou`, which checks the organization first.
   */
  needsYouBucket(organizationId: string): NeedsYouItem[] {
    return this.org(organizationId).needsYou;
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
