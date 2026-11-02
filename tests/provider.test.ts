import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

// Mock the SDK: capture the request and return a scripted final message.
const calls: Record<string, unknown>[] = [];
let next: { stop_reason: string; text: string } = { stop_reason: "end_turn", text: "{}" };
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      stream: (req: Record<string, unknown>) => {
        calls.push(req);
        return {
          finalMessage: async () => ({
            stop_reason: next.stop_reason,
            content: [{ type: "thinking", thinking: "…" }, { type: "text", text: next.text }],
            usage: { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 2000 },
          }),
        };
      },
    };
  },
}));

const { generate, AiRefusal, MODELS } = await import("@/lib/ai/provider");
const { TEMPLATES } = await import("@/server/agents/registry");
const schema = z.object({ headline: z.string(), claims: z.array(z.object({ text: z.string() })) });

describe("Claude provider contract", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("sends a streamed structured-output request with adaptive thinking and a cached system prompt", async () => {
    next = { stop_reason: "end_turn", text: JSON.stringify({ headline: "h", claims: [{ text: "c" }] }) };
    const r = await generate({ model: MODELS.deep, system: "sys", prompt: "user", schema, effort: "high" });
    expect(r.data.headline).toBe("h");
    const req = calls[0]!;
    expect(req.model).toBe("claude-opus-5-5");
    expect(req.thinking).toEqual({ type: "adaptive" });
    expect((req.output_config as { effort: string }).effort).toBe("high");
    expect((req.output_config as { format: { type: string } }).format.type).toBe("json_schema");
    expect((req.system as { cache_control: unknown }[])[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(req).not.toHaveProperty("temperature");
    // Cost: 1000 in * $4 + 2000 cached * $0.4 + 500 out * $20, per 1M tokens.
    expect(r.usage.costUsd).toBeCloseTo((1000 * 4 + 2000 * 0.4 + 500 * 20) / 1e6, 8);
  });

  it("surfaces refusals and truncation as errors, never as partial data", async () => {
    next = { stop_reason: "refusal", text: "" };
    await expect(generate({ model: MODELS.fast, system: "s", prompt: "p", schema })).rejects.toBeInstanceOf(AiRefusal);
    next = { stop_reason: "max_tokens", text: '{"headline":' };
    await expect(generate({ model: MODELS.fast, system: "s", prompt: "p", schema })).rejects.toThrow(/output room/);
  });

  it("rejects output that doesn't match the schema", async () => {
    next = { stop_reason: "end_turn", text: JSON.stringify({ headline: 3 }) };
    await expect(generate({ model: MODELS.fast, system: "s", prompt: "p", schema })).rejects.toThrow();
  });

  it("every agent template's schema converts to a structured-output format", () => {
    for (const t of TEMPLATES) expect(() => zodOutputFormat(t.schema as never), t.id).not.toThrow();
  });
});
