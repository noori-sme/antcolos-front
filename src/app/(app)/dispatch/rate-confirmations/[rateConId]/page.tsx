import { RateConReviewScreen } from "@/features/rate-confirmations/review-screen";

export const metadata = { title: "Rate confirmation" };

export default async function Page({
  params,
}: {
  params: Promise<{ rateConId: string }>;
}) {
  const { rateConId } = await params;
  return <RateConReviewScreen rateConId={rateConId} />;
}
