import { InvoiceDetail } from "@/features/invoices/invoice-detail";

export const metadata = { title: "Invoice" };

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ invoiceId: string }>;
}) {
  const { invoiceId } = await params;
  return <InvoiceDetail invoiceId={invoiceId} />;
}
