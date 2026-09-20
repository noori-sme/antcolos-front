import type { AuthorityStatus, FmcsaOfficialIdentity } from "@/types";

/**
 * ███ EXTENSION POINT — NOTHING HERE IS CONNECTED ███
 *
 * The FMCSA authority service, declared as a typed port with no implementation
 * behind it. The real service is being built separately; this file exists now
 * because the SHAPE of what it returns decides the shape of the record the
 * directory writes, and deciding that later means either rewriting the broker
 * profile or bending the adapter.
 *
 * ★ THE RULE THIS PORT EXISTS TO ENFORCE ★
 * A rate confirmation is a document a broker sent us. It is evidence of what
 * the broker SAID. Only an answer from the authority that ISSUED the MC number
 * may produce a verified identity, and the only code that can produce one is an
 * implementation of this interface. Nothing in the directory can mint
 * `identity.state === "verified"` from document text — there is no path.
 *
 * ★ WHAT "NOT CONNECTED" MEANS TODAY ★
 * `notConnectedAuthority` answers `unavailable` to everything. That is not a
 * placeholder to be tidied up later: it is the honest state of this branch, and
 * it means every rate confirmation processed here produces a PENDING
 * observation and no canonical profile. The screens say so in those words.
 *
 * Tests substitute a stub through `setAuthorityService` to exercise the
 * confirmed and conflicted paths. Production code never calls that.
 */

/** The only status a descriptor on this branch can report. */
export type AuthorityConnectionStatus = "not_connected";

export interface AuthorityDescriptor {
  id: "fmcsa_authority";
  label: string;
  description: string;
  status: AuthorityConnectionStatus;
  /** What an implementation would be able to answer. Not a promise. */
  capabilities: readonly string[];
}

export const FMCSA_AUTHORITY_DESCRIPTOR: AuthorityDescriptor = {
  id: "fmcsa_authority",
  label: "FMCSA authority data service",
  description:
    "Resolves an MC number against the federal register: the legal name, the DBA name, "
    + "the DOT number, the registered address, the entity type and the current operating "
    + "authority status.",
  status: "not_connected",
  capabilities: [
    "Confirm that an MC number identifies a real registered entity",
    "Return the official legal name and address for that entity",
    "Report whether its operating authority is active, inactive or revoked",
    "Answer again later, so a lapsed authority is noticed",
  ],
};

/**
 * What a lookup answers.
 *
 * `unavailable` and `not_found` are deliberately different. "We could not ask"
 * and "we asked and there is no such entity" lead to different outcomes: the
 * first is retried, the second is a conflict a person settles.
 */
export type AuthorityLookupResult =
  | {
    status: "confirmed";
    official: FmcsaOfficialIdentity;
    authorityStatus: AuthorityStatus;
    /** The register's own wording for the status. */
    authorityStatusText?: string;
  }
  | { status: "not_found"; detail: string }
  | { status: "unavailable"; detail: string };

export interface FmcsaAuthorityPort {
  /** False on this branch, and the screens are built to say so. */
  readonly connected: boolean;
  /** `mcNumber` is already normalized to digits by the caller. */
  resolveMc(mcNumber: string): Promise<AuthorityLookupResult>;
}

export const NOT_CONNECTED_DETAIL =
  "The FMCSA authority data service is not connected on this build, so no MC number can be "
  + "confirmed. The observation is kept and will resolve when the service lands.";

/** The implementation this branch runs on. It confirms nothing, ever. */
export const notConnectedAuthority: FmcsaAuthorityPort = {
  connected: false,
  async resolveMc() {
    return { status: "unavailable", detail: NOT_CONNECTED_DETAIL };
  },
};

let active: FmcsaAuthorityPort = notConnectedAuthority;

export function authorityService(): FmcsaAuthorityPort {
  return active;
}

/**
 * Substitute a port. TESTS ONLY.
 *
 * Exported rather than hidden because the confirmed and conflicted paths have
 * to be provable, and a boundary nobody can drive is a boundary nobody has
 * checked. No application code calls this, and `resetAuthorityService` puts the
 * not-connected port back.
 */
export function setAuthorityService(port: FmcsaAuthorityPort): void {
  active = port;
}

export function resetAuthorityService(): void {
  active = notConnectedAuthority;
}
