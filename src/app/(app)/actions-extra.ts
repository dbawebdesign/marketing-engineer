"use server";
import { revalidatePath } from "next/cache";
import { act, requireCtx } from "@/server/web/session";
import { searchAll } from "@/server/services/search";
import { firstDraftOfRun, undoReview } from "@/server/services/review-extra";
import { isUuid } from "@/lib/db";
import { badRequest } from "@/lib/errors";

export async function searchAction(q: string) {
  return act(async () => {
    const ctx = await requireCtx();
    return searchAll(ctx, typeof q === "string" ? q : "");
  });
}

export async function undoReviewAction(draftId: string) {
  return act(async () => {
    if (!isUuid(draftId)) throw badRequest("Unknown draft");
    const ctx = await requireCtx();
    const r = await undoReview(ctx, draftId);
    revalidatePath("/", "layout");
    return r;
  });
}

export async function runFirstDraftAction(runId: string) {
  return act(async () => {
    if (!isUuid(runId)) throw badRequest("Unknown run");
    const ctx = await requireCtx();
    return firstDraftOfRun(ctx, runId);
  });
}
