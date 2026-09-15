import { AuditEventDetailScreen } from "@/features/audit/event-detail-screen";

export const metadata = { title: "Audit event" };

export default async function Page({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  return <AuditEventDetailScreen eventId={eventId} />;
}
