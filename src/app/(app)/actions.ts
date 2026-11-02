"use server";
import { inlineWorkerEnabled } from "@/lib/inline-worker";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { act, requireCtx } from "@/server/web/session";
import { ingestSignals, deleteSignal, SIGNAL_SOURCES, type SignalInputT } from "@/server/services/signals";
import { runAgent, getRun, addRule, removeRule, updateAgent } from "@/server/services/agents";
import { reviewDraft } from "@/server/services/drafts";
import { saveDoc, saveIntro, type IntroAnswers } from "@/server/services/memory";
import { clearSampleData } from "@/server/services/sample";
import { markOnboarded } from "@/server/services/tenants";
import { loadDemo } from "@/server/demo";
import { drain } from "@/server/worker-core";
import { switchTenant } from "@/lib/auth";
import { badRequest } from "@/lib/errors";

/** Single-box deployments run queued jobs right after the response; a separate worker also drains the queue. */
function kickWorker() {
  if (!inlineWorkerEnabled()) return;
  after(async () => {
    try {
      await drain(`inline:${process.pid}`, 5);
    } catch (e) {
      console.error("[inline worker]", e);
    }
  });
}

export async function addSignalsAction(input: { source: string; content: string; title?: string; account?: string; url?: string; split?: boolean }) {
  return act(async () => {
    const ctx = await requireCtx();
    if (!(SIGNAL_SOURCES as readonly string[]).includes(input.source)) throw badRequest("Pick a source");
    const text = input.content.trim();
    if (!text) throw badRequest("Paste at least one note");
    // "One per paragraph" lets people paste 20 call summaries at once.
    const chunks = input.split ? text.split(/\n\s*\n+/).map((c) => c.trim()).filter(Boolean) : [text];
    const rows: SignalInputT[] = chunks.map((content) => ({
      source: input.source as SignalInputT["source"],
      content,
      title: chunks.length === 1 ? input.title : undefined,
      account: input.account || null,
      url: input.url || null,
    }));
    const r = await ingestSignals(ctx, rows);
    revalidatePath("/", "layout");
    return r;
  });
}

export async function importCsvAction(rows: SignalInputT[]) {
  return act(async () => {
    const ctx = await requireCtx();
    const r = await ingestSignals(ctx, rows);
    revalidatePath("/", "layout");
    return r;
  });
}

export async function deleteSignalAction(id: string) {
  return act(async () => {
    const ctx = await requireCtx();
    await deleteSignal(ctx, id);
    revalidatePath("/signals");
  });
}

export async function runAgentAction(agentId: string, input: Record<string, unknown> = {}) {
  return act(async () => {
    const ctx = await requireCtx();
    const runId = await runAgent(ctx, agentId, input);
    kickWorker();
    return { runId };
  });
}

export async function runStatusAction(runId: string) {
  return act(async () => {
    const ctx = await requireCtx();
    const r = await getRun(ctx, runId);
    if (r.status === "succeeded" || r.status === "failed") revalidatePath("/", "layout");
    return r;
  });
}

export async function reviewAction(draftId: string, input: { decision: "approve" | "reject"; feedback?: string; remember?: boolean; body?: string }) {
  return act(async () => {
    const ctx = await requireCtx();
    const r = await reviewDraft(ctx, draftId, input);
    revalidatePath("/", "layout");
    return r;
  });
}

export async function saveDocAction(key: string, content: string, expectedVersion?: number) {
  return act(async () => {
    const ctx = await requireCtx();
    const r = await saveDoc(ctx, key, content, expectedVersion);
    revalidatePath("/memory", "layout");
    return r;
  }, "Saved");
}

export async function addRuleAction(agentId: string, rule: string) {
  return act(async () => {
    const ctx = await requireCtx();
    await addRule(ctx, agentId, rule);
    revalidatePath(`/agents/${agentId}`);
  });
}

export async function removeRuleAction(agentId: string, ruleId: string) {
  return act(async () => {
    const ctx = await requireCtx();
    await removeRule(ctx, ruleId);
    revalidatePath(`/agents/${agentId}`);
  });
}

export async function updateAgentAction(agentId: string, patch: unknown) {
  return act(async () => {
    const ctx = await requireCtx();
    await updateAgent(ctx, agentId, patch);
    revalidatePath("/", "layout");
  }, "Saved");
}

export async function loadDemoAction() {
  return act(async () => {
    const ctx = await requireCtx();
    const r = await loadDemo(ctx);
    revalidatePath("/", "layout");
    return r;
  });
}

export async function clearSampleAction() {
  return act(async () => {
    const ctx = await requireCtx();
    const r = await clearSampleData(ctx);
    revalidatePath("/", "layout");
    return r;
  });
}

export async function saveIntroAction(answers: IntroAnswers) {
  return act(async () => {
    const ctx = await requireCtx();
    const clean: IntroAnswers = { sell: String(answers?.sell ?? ""), buyers: String(answers?.buyers ?? ""), voice: String(answers?.voice ?? "") };
    if (!Object.values(clean).some((v) => v?.trim())) throw badRequest("Answer at least one, or skip for now");
    const r = await saveIntro(ctx, clean);
    await markOnboarded(ctx, "answered");
    revalidatePath("/", "layout");
    return r;
  });
}

export async function skipIntroAction() {
  return act(async () => {
    const ctx = await requireCtx();
    await markOnboarded(ctx, "skipped");
    revalidatePath("/today");
  });
}

export async function switchTenantAction(tenantId: string) {
  return act(async () => {
    await requireCtx();
    if (!(await switchTenant(tenantId))) throw badRequest("You're not a member of that workspace");
    revalidatePath("/", "layout");
  });
}
