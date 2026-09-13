import { redirect } from "next/navigation";

/** The public landing page lands here later; for now go straight into the product. */
export default function RootPage() {
  redirect("/home");
}
