/**
 * Telegram linking (../antcolos/docs/requirements/telegram-api-contract.md §1, §5–§6; plan 29).
 */

/** The person's own link. It applies to every company they work in. */
export interface TelegramAccount {
  linked: boolean;
  username: string | null;
  linkedAt: string | null;
}

export type TelegramLinkPurpose = "ACCOUNT" | "TRUCK_CHAT";

/** A one-time code (30 minutes). `deepLink` opens the bot for ACCOUNT codes. */
export interface TelegramLinkCode {
  code: string;
  purpose: TelegramLinkPurpose;
  expiresAt: string;
  deepLink: string | null;
  instruction: string;
}

/** One truck's Telegram group in this organization. */
export interface TelegramTruckChat {
  truckId: string;
  /** Null when the organization no longer operates the truck (still unlinkable). */
  unitNumber: string | null;
  title: string | null;
  linkedAt: string;
  /** `name` is null when that user no longer exists. */
  linkedBy: { id: string; name: string | null };
}
