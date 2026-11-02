import { redirect } from "next/navigation";
import { currentSession } from "@/server/web/session";

export default async function Home() {
  redirect((await currentSession())?.tenant ? "/today" : "/login");
}
