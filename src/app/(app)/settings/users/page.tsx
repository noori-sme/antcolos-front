import { API_MODE } from "@/lib/api/mode";
import { MembersScreen } from "@/features/access/members-screen";
import { PeopleScreen } from "@/features/access/people-screen";

export const metadata = { title: "People" };

/** http mode (plan 12): the real member roster. Mock mode keeps the fixture screen. */
const Screen = API_MODE === "http" ? MembersScreen : PeopleScreen;

export default function Page() {
  return <Screen />;
}
