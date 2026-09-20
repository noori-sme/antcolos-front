import {
  Award, BadgeCheck, BadgeDollarSign, CalendarCheck, Clock, Crown, IdCard, Layers,
  Mail, PackageCheck, Route, ShieldCheck, Trophy, Truck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createElement } from "react";
import type { AchievementTier, ProfileVerificationKind } from "@/types";

/**
 * Icon names, resolved.
 *
 * The badge catalogue in `src/lib/profile/achievements.ts` stores an icon as a
 * string so it stays pure and renderable on a server that has no React. This
 * is the one place those strings become components, and the fallback means a
 * new badge always renders as something rather than as nothing.
 */
const ICONS: Record<string, LucideIcon> = {
  Award, BadgeCheck, BadgeDollarSign, CalendarCheck, Clock, Crown, Layers,
  PackageCheck, Route, ShieldCheck, Trophy,
};

export function achievementIcon(name: string): LucideIcon {
  return ICONS[name] ?? Award;
}

/**
 * A badge's icon, rendered from its name.
 *
 * `createElement` rather than `<Icon />` over a looked-up local, because the
 * second reads to the React Compiler as creating a component during render —
 * and it is right to object in general: a component identity that changes
 * between renders remounts its subtree. Here the element type comes from a
 * frozen table and cannot change for a given name, so building the element
 * directly says exactly that.
 */
export function AchievementIcon({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  return createElement(achievementIcon(name), { "aria-hidden": true, className });
}

/** Tier colouring, using the status tokens rather than new colours. */
export const TIER_CLASS: Record<AchievementTier, string> = {
  bronze: "bg-st-warning-bg text-st-warning",
  silver: "bg-st-neutral-bg text-fg-muted",
  gold: "bg-st-warning-bg text-st-warning",
  platinum: "bg-st-info-bg text-st-info",
};

export const VERIFICATION_ICON: Record<ProfileVerificationKind, LucideIcon> = {
  email: Mail,
  identity: IdCard,
  cdl: IdCard,
  "carrier-authority": Truck,
  "organization-owner": BadgeCheck,
};

/**
 * What each verification actually claims.
 *
 * Worded as a statement about EVIDENCE, never as a statement about authority:
 * a verified CDL says Safety saw a licence, and lets nobody drive anything.
 */
export const VERIFICATION_LABEL: Record<ProfileVerificationKind, string> = {
  email: "Email verified",
  identity: "Identity verified",
  cdl: "CDL on file, verified by a carrier",
  "carrier-authority": "Operating authority verified",
  "organization-owner": "Verified organization owner",
};
