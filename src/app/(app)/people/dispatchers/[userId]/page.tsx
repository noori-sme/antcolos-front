import { DispatcherDetailScreen } from "@/features/dispatchers/dispatcher-detail-screen";

export const metadata = { title: "Dispatcher Details" };

export default async function Page({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  return <DispatcherDetailScreen userId={userId} />;
}
