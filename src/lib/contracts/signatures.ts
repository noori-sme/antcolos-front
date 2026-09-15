import type {
  AuthorizedSigner, ContractParty, ContractSignature, ContractVersion, IsoDateTime,
} from "@/types";

/**
 * Who may sign for whom — and, far more importantly, who may not.
 *
 * The rule, in one sentence: **no party may sign, approve, amend or terminate an
 * agreement for another party.** A carrier owner holding every permission in the
 * catalog still cannot put the driver's signature on a version, because signing
 * authority comes from being an authorised signer OF A PARTY, and a permission
 * is not a party.
 *
 * Permissions and authority are two separate gates, checked in that order:
 *
 *   `contracts:sign`   may this membership sign anything at all, here?
 *   authority          may this membership sign for THIS party?
 *
 * Failing either refuses. Holding both is the only way through, and the service
 * layer checks both on every signature.
 */

export class SignerAuthorityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignerAuthorityError";
  }
}

/** A signer whose authority is live right now. Revoked authority signs nothing. */
export function isSignerLive(
  signer: Pick<AuthorizedSigner, "revokedAt">,
  now: IsoDateTime,
): boolean {
  if (!signer.revokedAt) return true;
  return new Date(signer.revokedAt).getTime() > new Date(now).getTime();
}

/**
 * The signers this membership personally is, among a contract's signers.
 *
 * Matched on `membershipId` and nothing else. Not on user id, not on
 * organization, not on name: a membership is the only thing that identifies
 * "this person, acting here", and matching on anything looser would let the same
 * user sign both sides of an agreement from two different workspaces.
 */
export function signersForMembership(
  signers: readonly AuthorizedSigner[],
  membershipId: string,
  now: IsoDateTime,
): AuthorizedSigner[] {
  return signers.filter((s) => s.membershipId === membershipId && isSignerLive(s, now));
}

/** The parties this membership may sign for. Usually one, and often none. */
export function signablePartyIds(
  signers: readonly AuthorizedSigner[],
  membershipId: string,
  now: IsoDateTime,
): string[] {
  return [...new Set(signersForMembership(signers, membershipId, now).map((s) => s.partyId))];
}

/**
 * The signer record that entitles this membership to sign for this party, or
 * `null` when there is none.
 *
 * Returning the record rather than a boolean is deliberate: the signature stores
 * the signer's id, name and title as they read at the moment of signing, and
 * those have to come from the authority that permitted it rather than from
 * whatever the caller typed.
 */
export function signerFor(
  signers: readonly AuthorizedSigner[],
  input: { membershipId: string; partyId: string; now: IsoDateTime },
): AuthorizedSigner | null {
  return (
    signersForMembership(signers, input.membershipId, input.now)
      .find((s) => s.partyId === input.partyId) ?? null
  );
}

/**
 * Refuses a signature that is not this membership's to give.
 *
 * The error messages say which of the two failures happened, because "you
 * cannot sign this" is unhelpful when the real answer is "you are signing for
 * the wrong party".
 */
export function assertMaySignFor(
  signers: readonly AuthorizedSigner[],
  parties: readonly ContractParty[],
  input: { membershipId: string; partyId: string; now: IsoDateTime },
): AuthorizedSigner {
  const party = parties.find((p) => p.partyId === input.partyId);
  if (!party) {
    throw new SignerAuthorityError("That party is not on this contract.");
  }

  const signer = signerFor(signers, input);
  if (signer) return signer;

  const mine = signablePartyIds(signers, input.membershipId, input.now);
  if (mine.length === 0) {
    throw new SignerAuthorityError(
      `You are not an authorised signer on this contract. Signing for ${party.legalNameSnapshot} would be signing for another party, which nobody may do — an owner has to authorise you first.`,
    );
  }
  const theirs = parties.filter((p) => mine.includes(p.partyId)).map((p) => p.legalNameSnapshot);
  throw new SignerAuthorityError(
    `You may sign for ${theirs.join(" and ")}, not for ${party.legalNameSnapshot}. No party may sign an agreement for another.`,
  );
}

/** One signature per party per version. Signing twice is refused, not ignored. */
export function hasSigned(
  signatures: readonly ContractSignature[],
  input: { contractVersionId: string; partyId: string },
): boolean {
  return signatures.some(
    (s) => s.contractVersionId === input.contractVersionId && s.partyId === input.partyId,
  );
}

/** Parties that have not yet signed a version. */
export function partiesOutstanding(
  parties: readonly ContractParty[],
  signatures: readonly ContractSignature[],
  contractVersionId: string,
): ContractParty[] {
  return parties.filter((p) => !hasSigned(signatures, { contractVersionId, partyId: p.partyId }));
}

export function signaturesOutstanding(
  parties: readonly ContractParty[],
  signatures: readonly ContractSignature[],
  contractVersionId: string,
): number {
  return partiesOutstanding(parties, signatures, contractVersionId).length;
}

/** True once every party on the contract has signed this version. */
export function isFullySigned(
  parties: readonly ContractParty[],
  signatures: readonly ContractSignature[],
  contractVersionId: string,
): boolean {
  return parties.length > 0
    && signaturesOutstanding(parties, signatures, contractVersionId) === 0;
}

/**
 * What a signer is shown above the signature box, and what is stored verbatim
 * with the signature.
 *
 * It says what this is. There is no e-signature provider behind this build, no
 * identity check, no certificate and no legal effect, and the statement kept
 * with every signature says so in the signer's own language — so an export, a
 * PDF or a later milestone cannot present one of these as a real signature by
 * omitting a caveat somebody typed into a component.
 */
export function signatureStatement(input: {
  partyName: string;
  signerName: string;
  versionNumber: number;
  contractTitle: string;
}): string {
  return [
    `MOCK SIGNATURE — no legal effect.`,
    `${input.signerName} is recording, on behalf of ${input.partyName}, that they have read version ${input.versionNumber} of "${input.contractTitle}".`,
    `Antcolos has not verified anybody's identity, has not used an e-signature service, has not had this reviewed by a lawyer and has not sent it anywhere.`,
    `This record is a typed name against a version and nothing more.`,
  ].join(" ");
}

/** A version that may receive signatures at all. */
export function acceptsSignatures(version: Pick<ContractVersion, "status">): boolean {
  return version.status === "issued";
}
