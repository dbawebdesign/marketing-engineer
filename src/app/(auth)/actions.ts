"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createSession, destroySession } from "@/lib/auth";
import { login, signup } from "@/server/services/tenants";
import { limit } from "@/server/web/ratelimit";
import { AppError } from "@/lib/errors";
import { ZodError } from "zod";
import { trustedIp } from "@/lib/client-ip";

export type AuthState = { error?: string; fields?: Record<string, string> };

async function ipKey(prefix: string) {
  return `${prefix}:${trustedIp(await headers())}`;
}

export async function loginAction(_: AuthState, form: FormData): Promise<AuthState> {
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  const fields = { email };
  if (!limit(await ipKey("login-ip"), 10, 60) || !limit(`login-email:${email.trim().toLowerCase().slice(0, 254)}`, 10, 300) || !limit("login-global", 300, 60))
    return { error: "Too many attempts. Wait a minute and try again.", fields };
  const r = await login(email, password);
  if (!r) return { error: "That email and password don't match.", fields };
  await createSession(r.userId, r.tenantId);
  redirect("/today");
}

export async function signupAction(_: AuthState, form: FormData): Promise<AuthState> {
  const data = Object.fromEntries(["name", "email", "password", "company"].map((k) => [k, String(form.get(k) ?? "")]));
  const fields = { name: data.name!, email: data.email!, company: data.company! };
  if (!limit(await ipKey("signup-ip"), 5, 300) || !limit("signup-global", 60, 300)) return { error: "Too many sign-ups from this network. Try again later.", fields };
  try {
    const { userId, tenantId } = await signup(data);
    await createSession(userId, tenantId);
  } catch (e) {
    if (e instanceof AppError) return { error: e.message, fields };
    if (e instanceof ZodError) return { error: e.issues[0]?.message, fields };
    console.error(e);
    return { error: "We couldn't create your account. Try again.", fields };
  }
  redirect("/today?welcome=1");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
