import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { loginAction } from "../actions";
import { currentSession } from "@/server/web/session";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if ((await currentSession())?.tenant) redirect("/today");
  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Welcome back</h1>
      <p className="mb-8 text-ink-2">Sign in to your growth system.</p>
      <AuthForm
        action={loginAction}
        submit="Sign in"
        fields={[
          { name: "email", label: "Email", type: "email", autoComplete: "email" },
          { name: "password", label: "Password", type: "password", autoComplete: "current-password" },
        ]}
        footer={{ text: "New here?", href: "/signup", link: "Create an account" }}
      />
    </>
  );
}
