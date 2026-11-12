import { z } from "zod";
import {
  AVATAR_MAX_BYTES, AVATAR_MIME_TYPES, type SelfProfile, type SelfProfilePatch,
} from "@/types/self-profile";

/** NANP: area code and exchange start with 2–9; optional +1 and separators. */
const US_PHONE = /^(\+?1[\s.-]?)?\(?[2-9]\d{2}\)?[\s.-]?[2-9]\d{2}[\s.-]?\d{4}$/;

/**
 * The self-profile edit form (plan 11), mirroring `PATCH /users/me`
 * (profile.md FR-EDIT-01, users-api-contract.md §5): names required when sent,
 * a US phone, a one-line headline of 1–120 characters and an "about me" of
 * 1–2000. An emptied optional field is sent as `null` (clear), never as "".
 */
export const selfProfileFormSchema = z.object({
  firstName: z.string().trim().min(1, "Enter your first name"),
  lastName: z.string().trim().min(1, "Enter your last name"),
  phone: z
    .string()
    .trim()
    .refine((v) => v === "" || US_PHONE.test(v), "Enter a US phone number"),
  headline: z
    .string()
    .trim()
    .max(120, "Keep the headline to 120 characters")
    .refine((v) => !/[\r\n]/.test(v), "The headline is one line"),
  aboutMe: z.string().trim().max(2000, "Keep this to 2,000 characters"),
});

export type SelfProfileFormValues = z.infer<typeof selfProfileFormSchema>;

export function toFormValues(profile: SelfProfile): SelfProfileFormValues {
  return {
    firstName: profile.firstName,
    lastName: profile.lastName,
    phone: profile.phone ?? "",
    headline: profile.headline ?? "",
    aboutMe: profile.aboutMe ?? "",
  };
}

/** Only what changed. Returns null when nothing did (the backend rejects an empty PATCH). */
export function toPatch(
  profile: SelfProfile,
  values: SelfProfileFormValues,
): SelfProfilePatch | null {
  const patch: SelfProfilePatch = {};
  const firstName = values.firstName.trim();
  const lastName = values.lastName.trim();
  if (firstName !== profile.firstName) patch.firstName = firstName;
  if (lastName !== profile.lastName) patch.lastName = lastName;
  const optional = (value: string, current: string | undefined) => {
    const next = value.trim();
    if (next === (current ?? "")) return undefined;
    return next === "" ? null : next;
  };
  const phone = optional(values.phone, profile.phone);
  if (phone !== undefined) patch.phone = phone;
  const headline = optional(values.headline, profile.headline);
  if (headline !== undefined) patch.headline = headline;
  const aboutMe = optional(values.aboutMe, profile.aboutMe);
  if (aboutMe !== undefined) patch.aboutMe = aboutMe;
  return Object.keys(patch).length > 0 ? patch : null;
}

/** profile.md FR-AV-01, checked before upload. The server checks again (413/415). */
export function avatarFileProblem(file: { type: string; size: number }): string | null {
  if (!(AVATAR_MIME_TYPES as readonly string[]).includes(file.type)) {
    return "Choose a JPEG, PNG or WebP image.";
  }
  if (file.size === 0) return "That file is empty.";
  if (file.size > AVATAR_MAX_BYTES) return "Choose an image under 5 MB.";
  return null;
}
