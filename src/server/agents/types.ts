import type { z } from "zod";
import type { ModelTier } from "@/lib/ai/provider";
import type { SignalLite, VerifiedEvidence } from "./evidence";

export const SYSTEMS = ["customer_truth", "founder_content", "outbound_signal", "creative_testing", "ai_search", "growth_cockpit"] as const;
export type System = (typeof SYSTEMS)[number];

export const SYSTEM_META: Record<System, { label: string; short: string; blurb: string }> = {
  customer_truth: { label: "Customer truth", short: "Truth", blurb: "What the market is telling us, with receipts." },
  founder_content: { label: "Founder content", short: "Content", blurb: "Turns real customer pain into posts in the founder's voice." },
  outbound_signal: { label: "Outbound signals", short: "Outbound", blurb: "Reaches the right accounts when timing hurts." },
  creative_testing: { label: "Creative testing", short: "Creative", blurb: "One offer, many angles, measured." },
  ai_search: { label: "AI search", short: "AI search", blurb: "Makes the company easy for AI assistants to understand and cite." },
  growth_cockpit: { label: "Growth cockpit", short: "Cockpit", blurb: "The weekly read: what changed, what won, what to test next." },
};

/** The written job spec, the way you'd write a job description for a person. */
export type JobSpec = {
  mission: string;
  dataSources: string[];
  schedule: string; // human-readable; the cron lives on the agent row
  filters: string[];
  output: string;
  goodLooksLike: string[];
  approval: string;
  metric: string;
  writesTo: string;
  lookbackDays: number;
};

export type DraftInput = {
  type: string;
  title: string;
  body: string;
  payload?: Record<string, unknown>;
  evidence?: VerifiedEvidence[];
};

export type MemoryDocLite = { key: string; title: string; content: string; version: number };

export type MetricsDigest = {
  window: { from: string; to: string };
  totals: Record<string, number>;
  byAngle: { angle: string; kind: string; value: number }[];
  experiments: { id: string; name: string; status: string; metric: string; variants: { label: string; impressions?: number; conversions?: number }[] }[];
  approvals: { system: string; approved: number; rejected: number; pending: number }[];
};

export type RunContext = {
  tenantName: string;
  agentName: string;
  spec: JobSpec;
  signals: SignalLite[];
  signalMap: Map<string, SignalLite>;
  docs: Record<string, MemoryDocLite | undefined>;
  rules: string[];
  recentFeedback: { title: string; status: string; feedback: string | null }[];
  metrics?: MetricsDigest;
  input: Record<string, unknown>;
  now: Date;
};

export type TemplateResult = {
  drafts: DraftInput[];
  /** One sentence for the run log. When the run is not substantive, this is the specific reason. */
  summary: string;
  stats: Record<string, number>;
  /**
   * Whether the output says something worth a human's review (a memo with at least one change,
   * a batch with hooks, at least one post or message, an answer pack with answers).
   * When false the runner keeps no drafts and finishes the run with `summary` as the reason.
   */
  substantive: boolean;
};

/**
 * What an agent needs before a run is worth starting. Counted on the same window and sources
 * the runner reads, so the readiness shown on screen and the runner's own check agree.
 */
export type ReadinessSpec = {
  /** Minimum signals from the agent's sources (default MIN_SIGNALS). */
  min?: number;
  /** A signal the agent can actually build from (e.g. one with a buying trigger). */
  usable?: (s: SignalLite) => boolean;
  /** Minimum usable signals (default 1 when `usable` is set). */
  minUsable?: number;
  /** "with a buying trigger (hiring, a new location, funding or a bad review)". */
  usableNoun?: string;
  /** Apply `usable` only on the offline engine (a model can work from any signal). */
  usableOfflineOnly?: boolean;
  /** Memory docs that must have content, with the name people see. */
  docs?: { key: string; label: string }[];
};

export type AgentTemplate<S extends z.ZodType = z.ZodType> = {
  id: string;
  system: System;
  name: string;
  tagline: string;
  tier: ModelTier;
  defaultCron: string | null;
  spec: JobSpec;
  /** Growth OS documents this agent reads. */
  reads: string[];
  signalSources?: string[];
  needsMetrics?: boolean;
  readiness?: ReadinessSpec;
  schema: S;
  systemPrompt: string;
  prompt(rc: RunContext): string;
  offline(rc: RunContext): z.infer<S>;
  finalize(data: z.infer<S>, rc: RunContext): TemplateResult;
};
