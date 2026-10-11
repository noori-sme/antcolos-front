import { AdminDetailScreen } from "@/features/admins/admin-detail-screen";

export const metadata = { title: "Admin Details" };

export default async function Page({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  return <AdminDetailScreen userId={userId} />;
}
