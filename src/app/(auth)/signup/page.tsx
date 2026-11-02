import { AuthForm } from "@/components/auth-form";
import { signupAction } from "../actions";

export const metadata = { title: "Create account" };

export default function SignupPage() {
  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Build your growth system</h1>
      <p className="mb-8 text-ink-2">Agents that turn what customers say into pipeline. You approve everything.</p>
      <AuthForm
        action={signupAction}
        submit="Create account"
        fields={[
          { name: "name", label: "Your name", autoComplete: "name" },
          { name: "company", label: "Company", autoComplete: "organization" },
          { name: "email", label: "Work email", type: "email", autoComplete: "email" },
          { name: "password", label: "Password", type: "password", autoComplete: "new-password", hint: "10+ characters" },
        ]}
        footer={{ text: "Already have an account?", href: "/login", link: "Sign in" }}
      />
    </>
  );
}
