"use server";
import { revalidatePath } from "next/cache";
import { act, requireCtx } from "@/server/web/session";
import { createApiKey, revokeApiKey } from "@/lib/apikeys";
import { getEmbedSecret, rotateEmbedSecret, updateTenant } from "@/server/services/tenants";

export async function createKeyAction(name: string, scopes: string[]) {
  return act(async () => {
    const ctx = await requireCtx();
    const k = await createApiKey(ctx, { name, scopes });
    revalidatePath("/settings");
    return { key: k.key };
  });
}

export async function revokeKeyAction(id: string) {
  return act(async () => {
    const ctx = await requireCtx();
    await revokeApiKey(ctx, id);
    revalidatePath("/settings");
  });
}

export async function revealSecretAction() {
  return act(async () => getEmbedSecret(await requireCtx()));
}

export async function rotateSecretAction() {
  return act(async () => {
    const s = await rotateEmbedSecret(await requireCtx());
    return s;
  });
}

export async function updateWorkspaceAction(input: { name?: string; allowed_origins?: string[] }) {
  return act(async () => {
    await updateTenant(await requireCtx(), input);
    revalidatePath("/", "layout");
  }, "Saved");
}
