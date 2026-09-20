import { FactoringSettingsScreen } from "@/features/factoring/settings-screen";

export const metadata = { title: "Factoring" };

/**
 * Connection and policy administration only.
 *
 * The dispatcher's factoring work lives on the Load Search result and the
 * Opportunity, where the freight is. This page must not become the daily
 * operating screen — nothing about an individual load belongs on it.
 */
export default function Page() {
  return <FactoringSettingsScreen />;
}
