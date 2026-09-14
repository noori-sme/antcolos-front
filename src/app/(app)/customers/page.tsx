import { redirect } from "next/navigation";

/**
 * The customers module became the directory: brokers, shippers and receivers
 * are one set of permanent profiles with locations and contacts of their own.
 * The old path stays as a redirect so existing links — including the entity
 * links on Needs You items — keep working.
 */
export default function Page() {
  redirect("/directory");
}
