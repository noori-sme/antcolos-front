import { ContactProfileScreen } from "@/features/directory/contact-profile-screen";

export const metadata = { title: "Contact" };

export default async function Page({ params }: { params: Promise<{ contactId: string }> }) {
  const { contactId } = await params;
  return <ContactProfileScreen contactId={decodeURIComponent(contactId)} />;
}
