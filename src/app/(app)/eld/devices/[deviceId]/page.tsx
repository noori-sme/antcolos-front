import { EldDeviceScreen } from "@/features/eld/device-screen";

export const metadata = { title: "Device" };

export default async function Page({
  params,
}: { params: Promise<{ deviceId: string }> }) {
  const { deviceId } = await params;
  return <EldDeviceScreen deviceId={decodeURIComponent(deviceId)} />;
}
