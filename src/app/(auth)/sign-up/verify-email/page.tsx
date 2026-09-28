import { redirect } from "next/navigation";

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (token) {
    redirect(`/sign-in?verifyToken=${token}`);
  }
  redirect("/sign-in");
}
