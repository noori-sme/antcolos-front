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

  /** Test/debug helper. Not used by the UI. */
  reset() {
    this.data = buildSeed();
  }
}

export const mockStore = new MockStore();
