import { ExternalShareScreen } from "@/features/driver/external-share-screen";

export const metadata = {
  title: "Shared documents",
  // A share link is private to whoever was given it, and it is not a page that
  // belongs in a search index.
  robots: { index: false, follow: false },
};

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ExternalShareScreen token={decodeURIComponent(token)} />;
}
