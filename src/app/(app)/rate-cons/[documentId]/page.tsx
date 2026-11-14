import { RateConReviewScreen } from "@/features/rate-con-intake/review-screen";

export const metadata = { title: "Review Rate Con" };

export default async function Page({ params }: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await params;
  return <RateConReviewScreen documentId={documentId} />;
}
