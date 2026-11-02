"use client";
import { useActionState } from "react";
import Link from "next/link";
import { Button, Input, Label } from "./ui";
import type { AuthState } from "@/app/(auth)/actions";

type Field = { name: string; label: string; type?: string; autoComplete?: string; placeholder?: string; hint?: string };

export function AuthForm({
  action,
  fields,
  submit,
  footer,
}: {
  action: (s: AuthState, f: FormData) => Promise<AuthState>;
  fields: Field[];
  submit: string;
  footer: { text: string; href: string; link: string };
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-4" noValidate>
      {fields.map((f, i) => (
        <label key={f.name} className="block">
          <Label hint={f.hint}>{f.label}</Label>
          <Input
            name={f.name}
            type={f.type ?? "text"}
            autoComplete={f.autoComplete}
            placeholder={f.placeholder}
            defaultValue={f.type === "password" ? undefined : state.fields?.[f.name]}
            autoFocus={i === 0}
            required
          />
        </label>
      ))}
      {state.error ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      <Button variant="primary" className="h-10 w-full" disabled={pending}>
        {pending ? "One moment…" : submit}
      </Button>
      <p className="pt-2 text-center text-sm text-ink-2">
        {footer.text}{" "}
        <Link href={footer.href} className="font-medium text-ink underline-offset-4 hover:underline">
          {footer.link}
        </Link>
      </p>
    </form>
  );
}
