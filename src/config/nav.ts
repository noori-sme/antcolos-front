import type { LucideIcon } from "lucide-react";
import {
  BadgeCheck, Bell, Building2, CalendarClock, ClipboardList, Container, FileBadge,
  FileSearch, FileSignature, FileText, Fuel, Gauge, Handshake, Home, IdCard,
  Inbox, Layers, Link2, MailPlus, Map, Package, Palette, Radar, Receipt,
  ReceiptText, Route, Satellite, ScrollText, Settings2, Shield, ShieldCheck,
  TriangleAlert, Truck, UserCircle, Users, UsersRound, Wrench,
} from "lucide-react";
import type { PermissionKey } from "@/types";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Every permission listed must be held. Empty = always visible. */
  requires: PermissionKey[];
  /** Driver-portal items only render for memberships linked to a driver profile. */
  driverOnly?: boolean;
  /** Candidate for the mobile bottom bar (first four in order are taken). */
  primaryMobile?: boolean;
  /** Renders the open Needs You count. */
  showsNeedsYouCount?: boolean;
}

export interface NavSection {
  id: string;
  label?: string;
  items: NavItem[];
}

/** Product navigation — organization-scoped, permission-gated. */
export const PRODUCT_NAV: NavSection[] = [
  {
    id: "operate",
    label: "Operate",
    items: [
      { label: "Home", href: "/home", icon: Home, requires: [], primaryMobile: true },
      { label: "Needs You", href: "/needs-you", icon: Inbox, requires: [], primaryMobile: true, showsNeedsYouCount: true },
      { label: "Dispatch", href: "/dispatch", icon: Route, requires: ["loads:view", "loads:assign"], primaryMobile: true },
      { label: "Tracking", href: "/dispatch/tracking", icon: Radar, requires: ["tracking:view", "loads:view"] },
      { label: "Opportunities", href: "/dispatch/opportunities", icon: Layers, requires: ["loads:view", "trucks:view"] },
      { label: "Loads", href: "/loads", icon: Package, requires: ["loads:view"], primaryMobile: true },
    ],
  },
  {
    id: "fleet",
    label: "Fleet & people",
    items: [
      { label: "Fleet", href: "/fleet", icon: Gauge, requires: ["fleet:view"] },
      // Both keys, and stated here rather than only in the route manifest: the
      // nav entry and the guard must agree, and seeing a device is pointless
      // without being allowed to know which truck it is on.
      { label: "ELD & Telematics", href: "/eld", icon: Satellite, requires: ["eld:view", "trucks:view"] },
      { label: "Drivers", href: "/people/drivers", icon: UsersRound, requires: ["drivers:view"] },
      { label: "Trucks", href: "/fleet/trucks", icon: Truck, requires: ["trucks:view"] },
      { label: "Trailers", href: "/fleet/trailers", icon: Container, requires: ["trailers:view"] },
      { label: "Safety & Compliance", href: "/compliance", icon: ShieldCheck, requires: ["compliance:view"] },
      { label: "Maintenance", href: "/maintenance", icon: Wrench, requires: ["maintenance:view"] },
    ],
  },
  {
    id: "risk",
    label: "Insurance & claims",
    items: [
      { label: "Overview", href: "/insurance", icon: ShieldCheck, requires: ["insurance:view"] },
      { label: "Policies", href: "/insurance/policies", icon: Shield, requires: ["insurance:view"] },
      { label: "Certificates", href: "/insurance/certificates", icon: FileBadge, requires: ["insurance:view"] },
      { label: "Claims", href: "/insurance/claims", icon: TriangleAlert, requires: ["claims:view"] },
    ],
  },
  {
    id: "fuel",
    label: "Fuel & IFTA",
    items: [
      { label: "Fuel", href: "/fuel", icon: Fuel, requires: ["fuel:view"] },
      { label: "Fuel purchases", href: "/fuel/transactions", icon: ReceiptText, requires: ["fuel:view"] },
      { label: "Jurisdiction mileage", href: "/fuel/mileage", icon: Map, requires: ["mileage:view"] },
      { label: "IFTA quarters", href: "/fuel/ifta", icon: CalendarClock, requires: ["ifta:view"] },
    ],
  },
  {
    id: "business",
    label: "Business",
    items: [
      { label: "Directory", href: "/directory", icon: Building2, requires: ["customers:view"] },
      { label: "Contracts", href: "/contracts", icon: FileSignature, requires: ["contracts:view"] },
      { label: "Documents", href: "/documents", icon: FileText, requires: ["documents:view"] },
      { label: "Settlements", href: "/finance/settlements", icon: Receipt, requires: ["settlements:view"] },
      { label: "Invoices", href: "/finance/invoices", icon: ClipboardList, requires: ["invoices:view"] },
      { label: "Reports", href: "/reports", icon: Gauge, requires: ["reports:view"] },
    ],
  },
  {
    // Audit and risk sit together because they are read together, and apart
    // from Organization settings because reading the record of what happened
    // is daily work for safety and compliance, not an administrative errand.
    id: "oversight",
    label: "Audit & risk",
    items: [
      { label: "Audit & Risk", href: "/audit", icon: ShieldCheck, requires: ["audit:view"] },
      { label: "Audit events", href: "/audit/events", icon: ScrollText, requires: ["audit:view"] },
      { label: "Risk signals", href: "/audit/signals", icon: Radar, requires: ["risk:view"] },
      { label: "Risk cases", href: "/audit/cases", icon: FileSearch, requires: ["risk:view"] },
    ],
  },
];

/** Driver portal — mobile-first, own records only. */
export const DRIVER_NAV: NavSection[] = [
  {
    id: "driver",
    label: "My work",
    items: [
      { label: "Home", href: "/driver/home", icon: Home, requires: [], driverOnly: true, primaryMobile: true },
      { label: "Proposals", href: "/driver/proposals", icon: Handshake, requires: ["proposals:view"], driverOnly: true, primaryMobile: true },
      { label: "My loads", href: "/driver/loads", icon: ClipboardList, requires: ["loads:view"], driverOnly: true, primaryMobile: true },
      { label: "My documents", href: "/driver/documents", icon: FileText, requires: [], driverOnly: true, primaryMobile: true },
      { label: "My compliance", href: "/compliance", icon: ShieldCheck, requires: ["compliance:view"], driverOnly: true },
      { label: "My agreements", href: "/contracts", icon: FileSignature, requires: ["contracts:view"], driverOnly: true },
      // The device on the truck they are on, and their own hours-of-service
      // summary. The service layer narrows both to this driver: another
      // driver's clock is not reachable from here by any path.
      { label: "My truck's device", href: "/eld", icon: Satellite, requires: ["eld:view", "trucks:view"], driverOnly: true },
      { label: "Report a defect", href: "/driver/defects", icon: TriangleAlert, requires: ["maintenance:defects:report"], driverOnly: true },
      { label: "My profile", href: "/driver/profile", icon: IdCard, requires: [], driverOnly: true },
      { label: "Notifications", href: "/driver/notifications", icon: Bell, requires: [], driverOnly: true },
    ],
  },
];

/** Organization settings — permission-gated. */
export const SETTINGS_NAV: NavSection[] = [
  {
    id: "settings",
    label: "Organization",
    items: [
      { label: "Organization", href: "/settings/organization", icon: Building2, requires: ["organization:manage"] },
      { label: "Users", href: "/settings/users", icon: Users, requires: ["members:view"] },
      { label: "Invitations", href: "/settings/invitations", icon: MailPlus, requires: ["invitations:view"] },
      { label: "Roles and permissions", href: "/settings/permissions", icon: Shield, requires: ["permissions:manage"] },
      { label: "Integrations", href: "/settings/integrations", icon: Link2, requires: ["integrations:view"] },
      { label: "Audit", href: "/settings/audit", icon: ScrollText, requires: ["audit:view"] },
    ],
  },
];

/**
 * Account — personal and permanent. Never gated. A user with no permissions in
 * any organization still has a complete, functioning account area.
 */
export const ACCOUNT_NAV: NavSection[] = [
  {
    id: "account",
    label: "Account",
    items: [
      { label: "Profile", href: "/account/profile", icon: UserCircle, requires: [] },
      { label: "Security", href: "/account/security", icon: BadgeCheck, requires: [] },
      { label: "Appearance", href: "/account/appearance", icon: Palette, requires: [] },
      { label: "Notifications", href: "/account/notifications", icon: Bell, requires: [] },
      { label: "My organizations", href: "/account/organizations", icon: Settings2, requires: [] },
    ],
  },
];

export const ALL_NAV_SECTIONS: NavSection[] = [
  ...PRODUCT_NAV,
  ...DRIVER_NAV,
  ...SETTINGS_NAV,
  ...ACCOUNT_NAV,
];
