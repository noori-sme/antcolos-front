import { FacilityProfileScreen } from "@/features/directory/facility-profile-screen";

export const metadata = { title: "Location" };

export default async function Page({ params }: { params: Promise<{ facilityId: string }> }) {
  const { facilityId } = await params;
  return <FacilityProfileScreen facilityId={decodeURIComponent(facilityId)} />;
}
