"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Trash, Plus } from "lucide-react";
import { addRuleAction, removeRuleAction, updateAgentAction } from "@/app/(app)/actions";
import { Button, Input, Label, Textarea, cx, timeAgo } from "./ui";
import { toast } from "./toast";

type Spec = { mission: string; filters: string[]; output: string; goodLooksLike: string[]; approval: string; metric: string; lookbackDays: number; schedule: string; dataSources: string[]; writesTo: string };

const SCHEDULES: [string, string | null][] = [
  ["On demand", null],
  ["Weekday mornings", "0 7 * * 1-5"],
  ["Every morning", "0 7 * * *"],
  ["Mondays", "0 7 * * 1"],
  ["Fridays", "0 15 * * 5"],
];

export function AgentEditor({
  agent,
  models,
  canManage,
}: {
  agent: { id: string; name: string; enabled: boolean; schedule_cron: string | null; model: string; spec: Spec };
  models: { id: string; label: string }[];
  canManage: boolean;
}) {
  const [s, setS] = useState({
    name: agent.name,
    enabled: agent.enabled,
    cron: agent.schedule_cron,
    model: agent.model,
    mission: agent.spec.mission,
    filters: agent.spec.filters.join("\n"),
    output: agent.spec.output,
    good: agent.spec.goodLooksLike.join("\n"),
    approval: agent.spec.approval,
    metric: agent.spec.metric,
    lookback: agent.spec.lookbackDays,
  });
  const [pending, start] = useTransition();
  const router = useRouter();
  const set = <K extends keyof typeof s>(k: K, v: (typeof s)[K]) => setS((x) => ({ ...x, [k]: v }));
  const lines = (t: string) => t.split("\n").map((l) => l.trim()).filter(Boolean);
  const custom = s.cron && !SCHEDULES.some(([, c]) => c === s.cron);

  const save = () =>
    start(async () => {
      const r = await updateAgentAction(agent.id, {
        name: s.name,
        enabled: s.enabled,
        schedule_cron: s.cron,
        model: s.model,
        spec: { mission: s.mission, filters: lines(s.filters), output: s.output, goodLooksLike: lines(s.good), approval: s.approval, metric: s.metric, lookbackDays: Number(s.lookback) },
      });
      if (r.ok) {
        toast.ok("Job spec saved");
        router.refresh();
      } else toast.error(r.error);
    });

  const field = "grid gap-1.5 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-6 py-4 border-b border-line";
  return (
    <fieldset disabled={!canManage} className="disabled:opacity-80">
      <div className={field}>
        <Label>Status</Label>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={s.enabled} onChange={(e) => set("enabled", e.target.checked)} className="size-4 accent-[var(--accent)]" />
          {s.enabled ? "Active: runs on schedule" : "Paused"}
        </label>
      </div>
      <div className={field}>
        <Label>Name</Label>
        <Input value={s.name} onChange={(e) => set("name", e.target.value)} maxLength={80} />
      </div>
      <div className={field}>
        <Label>Mission</Label>
        <Textarea value={s.mission} onChange={(e) => set("mission", e.target.value)} rows={2} />
      </div>
      <div className={field}>
        <Label>Schedule</Label>
        <div>
          <div className="flex flex-wrap gap-1.5">
            {SCHEDULES.map(([l, c]) => (
              <button key={l} type="button" onClick={() => set("cron", c)} className={cx("h-8 rounded-lg px-3 text-[13px]", s.cron === c ? "bg-ink text-bg" : "bg-surface text-ink-2 ring-1 ring-line-strong")}>
                {l}
              </button>
            ))}
          </div>
          <Input className="mt-2 h-9 font-mono text-[13px]" value={s.cron ?? ""} placeholder="Custom cron, e.g. 0 9 * * 2" onChange={(e) => set("cron", e.target.value.trim() || null)} />
          {custom ? <p className="mt-1 text-xs text-ink-3">Custom schedule (UTC)</p> : null}
        </div>
      </div>
      <div className={field}>
        <Label>Model</Label>
        <div className="flex flex-wrap gap-1.5">
          {models.map((m) => (
            <button key={m.id} type="button" onClick={() => set("model", m.id)} className={cx("h-8 rounded-lg px-3 text-[13px]", s.model === m.id ? "bg-ink text-bg" : "bg-surface text-ink-2 ring-1 ring-line-strong")}>
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div className={field}>
        <Label hint="one per line">Filters</Label>
        <Textarea value={s.filters} onChange={(e) => set("filters", e.target.value)} rows={3} />
      </div>
      <div className={field}>
        <Label>Expected output</Label>
        <Textarea value={s.output} onChange={(e) => set("output", e.target.value)} rows={2} />
      </div>
      <div className={field}>
        <Label hint="one per line">Good looks like</Label>
        <Textarea value={s.good} onChange={(e) => set("good", e.target.value)} rows={3} />
      </div>
      <div className={field}>
        <Label>Approval step</Label>
        <Input value={s.approval} onChange={(e) => set("approval", e.target.value)} />
      </div>
      <div className={field}>
        <Label>Metric that matters</Label>
        <Input value={s.metric} onChange={(e) => set("metric", e.target.value)} />
      </div>
      <div className={field}>
        <Label>Look back</Label>
        <div className="flex items-center gap-2 text-sm text-ink-2">
          <Input type="number" min={1} max={365} value={s.lookback} onChange={(e) => set("lookback", Number(e.target.value))} className="h-9 w-24" /> days of signals
        </div>
      </div>
      <div className={field}>
        <Label>Reads and writes</Label>
        <p className="text-sm text-ink-2">
          Sources: {agent.spec.dataSources.join(", ")}. Writes to <code className="rounded bg-subtle px-1 font-mono text-xs">{agent.spec.writesTo}</code>.
        </p>
      </div>
      {canManage ? (
        <div className="pt-5">
          <Button variant="primary" onClick={save} disabled={pending}>
            {pending ? <LoaderCircle size={14} className="animate-spin" /> : null} Save job spec
          </Button>
        </div>
      ) : null}
    </fieldset>
  );
}

export function RulesEditor({ agentId, rules, canAdd, canRemove }: { agentId: string; rules: { id: string; rule: string; source: string; created_at: string }[]; canAdd: boolean; canRemove: boolean }) {
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div>
      {rules.length ? (
        <ul className="divide-y divide-line overflow-hidden rounded-xl bg-surface ring-1 ring-line">
          {rules.map((r) => (
            <li key={r.id} className="group flex items-start gap-3 px-4 py-3">
              <p className="flex-1 text-[14px]">{r.rule}</p>
              <span className="shrink-0 text-xs text-ink-3">{r.source === "correction" ? "from a review" : "added"} · {timeAgo(r.created_at)}</span>
              {canRemove ? (
                <button
                  aria-label="Remove rule"
                  className="text-ink-3 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100 focus:opacity-100"
                  onClick={() =>
                    start(async () => {
                      const res = await removeRuleAction(agentId, r.id);
                      if (!res.ok) toast.error(res.error);
                      router.refresh();
                    })
                  }
                >
                  <Trash size={14} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-3">No corrections yet. When you reject a draft with a reason, it becomes a rule here.</p>
      )}
      {canAdd ? (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await addRuleAction(agentId, text);
              if (!r.ok) return void toast.error(r.error);
              setText("");
              router.refresh();
            });
          }}
        >
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a rule, e.g. “Every insight needs a quote or a link.”" className="h-9" />
          <Button disabled={pending || text.trim().length < 3}>
            <Plus size={14} /> Add
          </Button>
        </form>
      ) : null}
    </div>
  );
}
