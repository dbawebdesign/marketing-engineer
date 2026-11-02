import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

export type ModelTier = "deep" | "fast";

export const MODELS: Record<ModelTier, string> = {
  deep: process.env.ME_MODEL_DEEP ?? "claude-opus-5-5",
  fast: process.env.ME_MODEL_FAST ?? "claude-sonnet-5-5",
};

// USD per 1M tokens, used for run cost accounting.
const PRICING: Record<string, { in: number; out: number }> = {
  "claude-opus-5-5": { in: 4, out: 20 },
  "claude-sonnet-5-5": { in: 2, out: 10 },
  "claude-haiku-5-5": { in: 0.1, out: 0.5 },
};

export type Usage = { model: string; inputTokens: number; outputTokens: number; costUsd: number };

export type GenerateArgs<S extends z.ZodType> = {
  model: string;
  system: string;
  prompt: string;
  schema: S;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
};

export class AiRefusal extends Error {}

let client: Anthropic | null = null;
export const aiEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

/**
 * One structured-output call to Claude. The schema is enforced server side
 * (output_config.format), so the result is validated JSON or an error, never prose.
 * The stable part of the prompt (system) is cached; the volatile context goes in the user turn.
 */
export async function generate<S extends z.ZodType>(args: GenerateArgs<S>): Promise<{ data: z.infer<S>; usage: Usage }> {
  client ??= new Anthropic({ maxRetries: 3, timeout: 10 * 60 * 1000 });
  const stream = client.messages.stream({
    model: args.model,
    max_tokens: args.maxTokens ?? 32000,
    thinking: { type: "adaptive" },
    output_config: { effort: args.effort ?? "medium", format: zodOutputFormat(args.schema) },
    system: [{ type: "text", text: args.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: args.prompt }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new AiRefusal("The model declined this request.");
  if (msg.stop_reason === "max_tokens") throw new Error("The model ran out of output room. Narrow the inputs and retry.");
  const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const data = args.schema.parse(JSON.parse(text));
  const p = PRICING[args.model] ?? { in: 4, out: 20 };
  const inputTokens = msg.usage.input_tokens + (msg.usage.cache_creation_input_tokens ?? 0) + (msg.usage.cache_read_input_tokens ?? 0);
  const outputTokens = msg.usage.output_tokens;
  const costUsd =
    (msg.usage.input_tokens * p.in + (msg.usage.cache_creation_input_tokens ?? 0) * p.in * 1.25 + (msg.usage.cache_read_input_tokens ?? 0) * p.in * 0.1 + outputTokens * p.out) / 1e6;
  return { data, usage: { model: args.model, inputTokens, outputTokens, costUsd } };
}
