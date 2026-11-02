import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getSession, ctxFromSession } from "@/lib/auth";
import type { Ctx } from "@/lib/ctx";

/** Per-request memoized session lookup for server components and actions. */
export const currentSession = cache(getSession);

export async function isEmbed() {
  return (await headers()).get("x-me-embed") === "1";
}

export async function requireCtx(): Promise<Ctx> {
  const s = await currentSession();
  if (!s) redirect((await isEmbed()) ? "/embed/expired" : "/login");
  const ctx = ctxFromSession(s);
  if (!ctx) redirect("/login");
  return ctx;
}

/** Wrap a server action body: maps known errors to a user-facing message instead of a crash. */
export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

export async function act<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message };
  } catch (e: unknown) {
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) throw e;
    const { AppError } = await import("@/lib/errors");
    const { ZodError } = await import("zod");
    if (e instanceof AppError) return { ok: false, error: e.message };
    if (e instanceof ZodError) return { ok: false, error: e.issues[0]?.message ?? "Check the form and try again" };
    console.error("[action]", e);
    return { ok: false, error: "Something went wrong. Try again in a moment." };
  }
}
