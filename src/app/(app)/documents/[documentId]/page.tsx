import { DocumentDetailScreen } from "@/features/documents/document-detail-screen";

export const metadata = { title: "Document" };

export default async function Page({ params }: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await params;
  return <DocumentDetailScreen documentId={decodeURIComponent(documentId)} />;
}
