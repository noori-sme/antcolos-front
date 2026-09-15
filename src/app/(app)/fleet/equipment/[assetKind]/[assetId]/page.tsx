import { notFound } from "next/navigation";
import { FleetAssetScreen } from "@/features/fleet-ops/asset-screen";
import type { FleetAssetKind } from "@/types";

export const metadata = { title: "Equipment" };

const KINDS: FleetAssetKind[] = ["truck", "trailer"];

export default async function Page({
  params,
}: {
  params: Promise<{ assetKind: string; assetId: string }>;
}) {
  const { assetKind, assetId } = await params;
  // The kind comes off the URL, so it is validated before it reaches the
  // service rather than cast. Anything else is a 404, not a crash.
  if (!KINDS.includes(assetKind as FleetAssetKind)) notFound();
  return (
    <FleetAssetScreen
      assetKind={assetKind as FleetAssetKind}
      assetId={decodeURIComponent(assetId)}
    />
  );
}
