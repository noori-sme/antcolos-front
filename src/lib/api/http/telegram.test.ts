import { describe, expect, it } from "vitest";
import { toPage } from "./dto";
import { toTelegramAccount, toTelegramLinkCode, toTelegramTruckChat } from "./telegram";

// Fixtures copied from ../antcolos/docs/requirements/telegram-api-contract.md.
describe("telegram mappers", () => {
  it("maps a linked and an unlinked account (§5)", () => {
    expect(
      toTelegramAccount({ linked: true, username: "taqi_noori", linkedAt: "2026-11-27T00:33:12.000Z" }),
    ).toEqual({ linked: true, username: "taqi_noori", linkedAt: "2026-11-27T00:33:12.000Z" });
    expect(toTelegramAccount({ linked: false, username: null, linkedAt: null })).toEqual({
      linked: false,
      username: null,
      linkedAt: null,
    });
  });

  it("maps a link code, with and without a deep link (§1)", () => {
    expect(
      toTelegramLinkCode({
        code: "k3P9xQ2mVb7a",
        purpose: "ACCOUNT",
        expiresAt: "2026-11-17T03:00:00.000Z",
        deepLink: "https://t.me/AntcolosBot?start=k3P9xQ2mVb7a",
        instruction: "Open the link, or send /start k3P9xQ2mVb7a to the bot in a private chat.",
      }),
    ).toEqual({
      code: "k3P9xQ2mVb7a",
      purpose: "ACCOUNT",
      expiresAt: "2026-11-17T03:00:00.000Z",
      deepLink: "https://t.me/AntcolosBot?start=k3P9xQ2mVb7a",
      instruction: "Open the link, or send /start k3P9xQ2mVb7a to the bot in a private chat.",
    });
    expect(
      toTelegramLinkCode({ code: "J0r_N_B_ozu3", purpose: "TRUCK_CHAT", expiresAt: "x", deepLink: null, instruction: "i" })
        .deepLink,
    ).toBeNull();
  });

  it("maps a page of truck groups, keeping a null unit number and a removed linker (§6)", () => {
    const page = toPage(
      {
        data: [
          {
            truckId: "ab676006-80f6-44eb-93d4-256bf5193f80",
            unitNumber: "104",
            title: "Truck 104",
            linkedAt: "2026-11-27T00:35:00.000Z",
            linkedBy: { id: "e9d69b18-626f-4dda-a9f2-d8bfc88622cd", name: "Alex Rivera" },
          },
          {
            truckId: "t2",
            unitNumber: null,
            title: null,
            linkedAt: "2026-11-20T10:00:00.000Z",
            linkedBy: { id: "gone", name: null },
          },
        ],
        meta: { page: 1, pageSize: 20, totalItems: 2, totalPages: 1 },
      },
      toTelegramTruckChat,
    );
    expect(page.data[0]).toEqual({
      truckId: "ab676006-80f6-44eb-93d4-256bf5193f80",
      unitNumber: "104",
      title: "Truck 104",
      linkedAt: "2026-11-27T00:35:00.000Z",
      linkedBy: { id: "e9d69b18-626f-4dda-a9f2-d8bfc88622cd", name: "Alex Rivera" },
    });
    expect(page.data[1]).toMatchObject({ unitNumber: null, title: null, linkedBy: { name: null } });
    expect(page.meta.totalItems).toBe(2);
  });
});
