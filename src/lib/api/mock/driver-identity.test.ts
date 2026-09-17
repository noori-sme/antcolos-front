import { beforeEach, describe, expect, it } from "vitest";
import * as registry from "./driver-registry";
import {
  createOrResumeProfile, driverProfileUnscoped, profileForUser, resetDriverRegistry,
} from "./driver-registry";
import {
  DRIVER_PROFILE_ID, mockCreateOrGetDriverProfile, mockGetDriverProfile,
  driverProfileSync, resetDriverMock,
} from "@/features/driver/mock-driver";
import { MOCK_USER, NEWCOMER_USER } from "@/lib/session/fixtures";
import { documentsForSubject, resetDocumentStore } from "./document-store";

/**
 * ★ ONE PERSON, ONE PERMANENT PROFILE, ONE WRITER ★
 *
 * Antcolos held Sam Murtaza's licence twice. The carrier-facing driver registry
 * had it, and the driver-facing mock had it again in a second literal, and they
 * agreed only because two people had typed matching values. No test asserted
 * they agreed, so the product would have held two opinions about one person's
 * licence the first time either was edited.
 *
 * These tests defend the boundary that replaced it.
 *
 * ★ WHAT THEY DELIBERATELY DO NOT ASSERT ★
 * That two calls return the same JavaScript object. They must not: every read
 * here hands back a COPY, precisely so a screen holding a driver's details
 * cannot edit the registry by accident. Object identity would be the wrong
 * property and asserting it would forbid the right one. What is asserted
 * instead is that there is one canonical id, one writer, that a change made
 * through the writer is visible on the next read from either side, and that
 * mutating what you were handed changes nothing.
 */

beforeEach(() => {
  resetDocumentStore();
  resetDriverMock();
});

const LICENCE = {
  legalName: "Priya Raman",
  cdlNumber: "r9920014",
  cdlState: "TX",
  cdlExpiresAt: "2029-04-30T00:00:00.000Z",
  email: "Priya.Raman@Example.com",
};

describe("one canonical profile, and one place that writes it", () => {
  it("gives the driver's own view and the carrier's view the same record", async () => {
    const own = await mockGetDriverProfile();
    expect(own).not.toBeNull();

    const canonical = driverProfileUnscoped(own!.id);
    expect(canonical).toBeDefined();

    // Field-by-field, not by object identity. These are two copies of one row.
    expect(canonical).toEqual(own);
    expect(canonical!.cdlNumber).toBe(own!.cdlNumber);
    expect(canonical!.cdlState).toBe(own!.cdlState);
    expect(canonical!.cdlExpiresAt).toBe(own!.cdlExpiresAt);
    expect(canonical!.medicalCardExpiresAt).toBe(own!.medicalCardExpiresAt);
  });

  it("resolves the signed-in person by their account, not by a hard-coded id", async () => {
    const own = await mockGetDriverProfile();
    expect(own!.userId).toBe(MOCK_USER.id);
    expect(profileForUser(MOCK_USER.id)!.id).toBe(own!.id);
  });

  it("makes a profile created through the person's own door readable canonically", async () => {
    resetDriverRegistry({ omitUserIds: [MOCK_USER.id] });
    resetDriverMock({ withProfile: false });
    expect(await mockGetDriverProfile()).toBeNull();

    const created = await mockCreateOrGetDriverProfile(LICENCE);

    // The change is visible on the NEXT read, from the other side, with no
    // second store to reconcile and nobody copying anything across.
    const canonical = driverProfileUnscoped(created.id);
    expect(canonical).toBeDefined();
    expect(canonical!.legalName).toBe("Priya Raman");
    expect(canonical!.cdlNumber).toBe("R9920014");
    expect(canonical!.userId).toBe(MOCK_USER.id);
  });

  it("hands out copies, so mutating a returned view cannot change the record", async () => {
    const own = await mockGetDriverProfile();
    const originalCdl = own!.cdlNumber;

    own!.cdlNumber = "TAMPERED";
    own!.legalName = "Somebody Else";

    expect(driverProfileUnscoped(own!.id)!.cdlNumber).toBe(originalCdl);
    expect((await mockGetDriverProfile())!.cdlNumber).toBe(originalCdl);
    expect(profileForUser(MOCK_USER.id)!.legalName).not.toBe("Somebody Else");
  });

  it("hands out copies from the canonical read too", () => {
    const first = driverProfileUnscoped(DRIVER_PROFILE_ID)!;
    const before = first.cdlState;
    first.cdlState = "ZZ";
    expect(driverProfileUnscoped(DRIVER_PROFILE_ID)!.cdlState).toBe(before);
  });
});

describe("create-or-resume: a person never gets a second profile", () => {
  beforeEach(() => {
    resetDriverRegistry({ omitUserIds: [MOCK_USER.id] });
    resetDriverMock({ withProfile: false });
  });

  it("returns the same profile when asked twice", async () => {
    const first = await mockCreateOrGetDriverProfile(LICENCE);
    const second = await mockCreateOrGetDriverProfile(LICENCE);
    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
  });

  it("resumes rather than overwrites when the retry carries different details", async () => {
    const first = await mockCreateOrGetDriverProfile(LICENCE);
    const retry = await mockCreateOrGetDriverProfile({
      ...LICENCE,
      legalName: "Priya R Raman",
      cdlNumber: "DIFFERENT99",
      cdlState: "OK",
    });

    // A resume is not a correction. Somebody re-submitting a form is not how a
    // licence number gets changed, and the original stands.
    expect(retry.id).toBe(first.id);
    expect(retry.cdlNumber).toBe("R9920014");
    expect(retry.cdlState).toBe("TX");
    expect(retry.legalName).toBe("Priya Raman");
  });

  it("reports the resume through the registry's own result", () => {
    const first = createOrResumeProfile({ ...LICENCE, userId: "usr_boundary_a" });
    expect(first.resumed).toBe(false);
    const again = createOrResumeProfile({ ...LICENCE, userId: "usr_boundary_a" });
    expect(again.resumed).toBe(true);
    expect(again.profile.id).toBe(first.profile.id);
  });

  it("gives two different people two different profiles", () => {
    const a = createOrResumeProfile({ ...LICENCE, userId: "usr_boundary_a" });
    const b = createOrResumeProfile({ ...LICENCE, userId: "usr_boundary_b" });
    expect(b.profile.id).not.toBe(a.profile.id);
    expect(b.profile.userId).toBe("usr_boundary_b");
  });

  it("creates a profile and nothing else — no carrier, no engagement", async () => {
    const created = await mockCreateOrGetDriverProfile(LICENCE);
    // Being a driver is not being hired. Nothing here may invent an employer.
    expect(driverProfileUnscoped(created.id)).toBeDefined();
    expect(documentsForSubject("driver", created.id)).toHaveLength(0);
  });
});

describe("a person who has no profile yet", () => {
  it("is a real, representable state rather than somebody else's record", () => {
    resetDriverRegistry({ omitUserIds: [MOCK_USER.id] });
    resetDriverMock({ withProfile: false });
    expect(driverProfileSync()).toBeNull();
    expect(profileForUser(MOCK_USER.id)).toBeUndefined();
  });

  it("does not exist for the newcomer account, who has never had one", () => {
    resetDriverRegistry();
    expect(profileForUser(NEWCOMER_USER.id)).toBeUndefined();
  });

  it("gets exactly one profile from their first create, and keeps it", async () => {
    resetDriverRegistry({ omitUserIds: [MOCK_USER.id] });
    resetDriverMock({ withProfile: false });

    const created = await mockCreateOrGetDriverProfile(LICENCE);
    expect(created.id).toBeTruthy();
    expect(driverProfileSync()!.id).toBe(created.id);
    expect((await mockCreateOrGetDriverProfile(LICENCE)).id).toBe(created.id);
  });
});

describe("the carrier side cannot reach a person it has no relationship with", () => {
  it("offers no way to find a profile by licence number", () => {
    // The guarantee is the absence of a function, not a check inside one: a
    // carrier that could search by CDL could ask whether a stranger is on
    // Antcolos, and a carrier that could create a profile could make a second
    // one for somebody who already had it.
    //
    // PR-2 added `createOrResumeRelationship`, which matches the same prefix
    // and is deliberately allowed here: it creates a RELATIONSHIP, it requires
    // an existing `driverProfileId`, and it creates no person. The guarantee
    // this test exists for is unchanged, so it is now asserted twice — once as
    // the exact surface, and once as the thing the surface is a proxy for.
    const writers = Object.keys(registry).filter((key) =>
      /^(create|register|add|upsert|find|search|lookUp|lookup)/.test(key));
    expect(writers).toEqual(["createOrResumeProfile", "createOrResumeRelationship"]);

    // Exactly ONE function creates a person, and nothing anywhere on this
    // module's surface is addressed by a licence.
    expect(writers.filter((key) => /Profile$/.test(key))).toEqual(["createOrResumeProfile"]);
    for (const key of Object.keys(registry)) {
      expect(key.toLowerCase()).not.toMatch(/cdl|licen[cs]e/);
    }
  });

  it("keys create-or-resume on the account, so there is no licence to probe with", () => {
    const byAccount = createOrResumeProfile({ ...LICENCE, userId: "usr_boundary_c" });
    // The same licence details under a different account are a different person
    // as far as this boundary is concerned. Deciding otherwise is a person's
    // job, and belongs nowhere near an automatic call.
    const other = createOrResumeProfile({ ...LICENCE, userId: "usr_boundary_d" });
    expect(other.profile.id).not.toBe(byAccount.profile.id);
    expect(other.resumed).toBe(false);
  });
});
