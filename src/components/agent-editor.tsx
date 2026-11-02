"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, LoaderCircle, Trash, Plus } from "lucide-react";
import { addRuleAction, removeRuleAction, updateAgentAction } from "@/app/(app)/actions";
import { DAY_NAMES, fmtTime, parseCron, toCron, type SimpleSchedule } from "@/lib/schedule";
import { AutoTextarea } from "./auto-textarea";
import { Button, Input, Label, cx, timeAgo } from "./ui";
import { toast } from "./toast";

type Spec = { mission: string; filters: string[]; output: string; goodLooksLike: string[]; approval: string; metric: string; lookbackDays: number; schedule: string; dataSources: string[]; writesTo: string };

const FREQS: { key: "none" | SimpleSchedule["freq"]; label: string }[] = [
  { key: "none", label: "On demand" },
  { key: "daily", label: "Every day" },
  { key: "weekdays", label: "Weekdays" },
  { key: "weekly", label: "Weekly" },
];

const chip = (on: boolean) =>
  cx("h-8 rounded-lg px-3 text-[13px] transition-colors", on ? "bg-ink font-medium text-bg" : "bg-surface text-ink-2 ring-1 ring-line-strong hover:bg-subtle hover:text-ink");
const select = "h-8 rounded-lg bg-surface pl-2.5 pr-7 text-[13px] text-ink ring-1 ring-line-strong focus:outline-none focus:ring-2 focus:ring-accent";

function SchedulePicker({ cron, timezone, onChange }: { cron: string | null; timezone: string; onChange: (c: string | null) => void }) {
  const parsed = parseCron(cron);
  const [custom, setCustom] = useState(!!cron && !parsed);
  // Keep the agent's own time (and day) when switching between chips.
  const [last, setLast] = useState<SimpleSchedule>(parsed ?? { freq: "weekdays", day: 1, hour: 7, minute: 0 });
  useEffect(() => {
    if (parsed) setLast(parsed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cron]);
  const active = custom ? null : !cron ? "none" : (parsed?.freq ?? null);
  const set = (s: SimpleSchedule) => {
    setLast(s);
    onChange(toCron(s));
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="How often">
        {FREQS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="radio"
            aria-checked={active === f.key}
            onClick={() => {
              setCustom(false);
              if (f.key === "none") onChange(null);
              else set({ ...last, freq: f.key });
            }}
            className={chip(active === f.key)}
          >
            {f.label}
          </button>
        ))}
        <button type="button" role="radio" aria-checked={custom} onClick={() => setCustom(true)} className={chip(custom)}>
          Custom…
        </button>
      </div>
      {!custom && cron && parsed ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[14px] text-ink-2">
          {parsed.freq === "weekly" ? (
            <>
              on
              <select aria-label="Day" className={select} value={parsed.day} onChange={(e) => set({ ...parsed, day: Number(e.target.value) })}>
                {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                  <option key={d} value={d}>
                    {DAY_NAMES[d]}
                  </option>
                ))}
              </select>
            </>
          ) : null}
          at
          <select aria-label="Time" className={select} value={`${parsed.hour}:${parsed.minute}`} onChange={(e) => {
            const [h, m] = e.target.value.split(":").map(Number);
            set({ ...parsed, hour: h!, minute: m! });
          }}>
            {parsed.minute % 30 !== 0 ? <option value={`${parsed.hour}:${parsed.minute}`}>{fmtTime(parsed.hour, parsed.minute)}</option> : null}
            {Array.from({ length: 48 }, (_, i) => [Math.floor(i / 2), (i % 2) * 30] as const).map(([h, m]) => (
              <option key={`${h}:${m}`} value={`${h}:${m}`}>
                {fmtTime(h, m)}
              </option>
            ))}
          </select>
          <span className="text-ink-3">{timezone}</span>
        </div>
      ) : null}
      {custom ? (
        <div className="mt-3">
          <Input
            className="h-9 max-w-xs font-mono text-[13px]"
            value={cron ?? ""}
            placeholder="0 9 * * 2"
            aria-label="Cron expression"
            onChange={(e) => onChange(e.target.value.trim() || null)}
          />
          <p className="mt-1.5 text-[13px] text-ink-3">Five-field cron in {timezone}, at most once an hour.</p>
        </div>
      ) : null}
    </div>
  );
}

const MODEL_LABEL = { deep: "Deep — best judgment", fast: "Fast — quick drafts" };

export function AgentEditor({
  agent,
  models,
  canManage,
}: {
  agent: { id: string; name: string; enabled: boolean; schedule_cron: string | null; model: string; timezone: string; spec: Spec };
  models: { id: string; tier: "deep" | "fast" }[];
  canManage: boolean;
}) {
  const initial = useMemo(
    () => ({
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
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(agent)],
  );
  const [base, setBase] = useState(initial);
  const [resets, setResets] = useState(0);
  const [s, setS] = useState(initial);
  useEffect(() => {
    setBase(initial);
    setS(initial);
  }, [initial]);
  const [pending, start] = useTransition();
  const router = useRouter();
  const set = <K extends keyof typeof s>(k: K, v: (typeof s)[K]) => setS((x) => ({ ...x, [k]: v }));
  const lines = (t: string) => t.split("\n").map((l) => l.trim()).filter(Boolean);
  const dirty = JSON.stringify(s) !== JSON.stringify(base);
  // After a save, the bar stays a moment to say so, then goes.
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(false), 1800);
    return () => clearTimeout(t);
  }, [saved]);
  useEffect(() => {
    if (dirty) setSaved(false);
  }, [dirty]);

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
        setSaved(true);
        setBase(s);
        router.refresh();
      } else toast.error(r.error);
    });

  useEffect(() => {
    if (!dirty) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        save();
      }
    };
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onLeave);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, s]);

  const field = "grid gap-2 border-b border-line py-5 sm:grid-cols-[168px_minmax(0,1fr)] sm:gap-6";
  return (
    <div>
      <fieldset disabled={!canManage} className="disabled:opacity-80">
        <div className={field}>
          <Label>Status</Label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              role="switch"
              aria-checked={s.enabled}
              aria-label="Agent active"
              onClick={() => set("enabled", !s.enabled)}
              className={cx("relative h-5 w-9 shrink-0 rounded-full transition-colors motion-reduce:transition-none", s.enabled ? "bg-accent" : "bg-line-strong")}
            >
              <span className={cx("absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow-soft transition-transform motion-reduce:transition-none", s.enabled && "translate-x-4")} />
            </button>
            <span className="text-[14px] text-ink-2">{s.enabled ? "Active: runs on its schedule" : "Paused: runs only when you click Run"}</span>
          </div>
        </div>
        <div className={field}>
          <Label>Name</Label>
          <Input aria-label="Name" value={s.name} onChange={(e) => set("name", e.target.value)} maxLength={80} />
        </div>
        <div className={field}>
          <Label>Mission</Label>
          <AutoTextarea aria-label="Mission" value={s.mission} onChange={(e) => set("mission", e.target.value)} rows={2} />
        </div>
        <div className={field}>
          <Label>Schedule</Label>
          <SchedulePicker key={resets} cron={s.cron} timezone={agent.timezone || "UTC"} onChange={(c) => set("cron", c)} />
        </div>
        <div className={field}>
          <Label>Model</Label>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Model">
            {models.map((m) => (
              <button key={m.id} type="button" role="radio" aria-checked={s.model === m.id} title={m.id} onClick={() => set("model", m.id)} className={chip(s.model === m.id)}>
                {MODEL_LABEL[m.tier]}
              </button>
            ))}
          </div>
        </div>
        <div className={field}>
          <Label hint="one per line">Filters</Label>
          <AutoTextarea aria-label="Filters" value={s.filters} onChange={(e) => set("filters", e.target.value)} rows={2} />
        </div>
        <div className={field}>
          <Label>Expected output</Label>
          <AutoTextarea aria-label="Expected output" value={s.output} onChange={(e) => set("output", e.target.value)} rows={2} />
        </div>
        <div className={field}>
          <Label hint="one per line">Good looks like</Label>
          <AutoTextarea aria-label="Good looks like" value={s.good} onChange={(e) => set("good", e.target.value)} rows={2} />
        </div>
        <div className={field}>
          <Label>Approval step</Label>
          <AutoTextarea aria-label="Approval step" value={s.approval} onChange={(e) => set("approval", e.target.value)} rows={1} />
        </div>
        <div className={field}>
          <Label>Metric that matters</Label>
          <AutoTextarea aria-label="Metric that matters" value={s.metric} onChange={(e) => set("metric", e.target.value)} rows={1} />
        </div>
        <div className={field}>
          <Label>Look back</Label>
          <div className="flex items-center gap-2 text-[14px] text-ink-2">
            <Input type="number" min={1} max={365} value={s.lookback} onChange={(e) => set("lookback", Number(e.target.value))} className="h-9 !w-20 tnum" aria-label="Days to look back" /> days of signals
          </div>
        </div>
        <div className={cx(field, "border-b-0")}>
          <Label>Reads and writes</Label>
          <p className="text-[14px] text-ink-2">
            Reads {agent.spec.dataSources.join(", ")}. Writes to {agent.spec.writesTo}.
          </p>
        </div>
      </fieldset>
      {canManage && saved && !dirty ? (
        <div className="sticky bottom-[calc(69px+env(safe-area-inset-bottom))] z-20 mt-4 md:bottom-4">
          <div className="animate-in flex h-12 items-center gap-2 rounded-xl bg-surface pl-4 pr-2 shadow-pop ring-1 ring-line" role="status">
            <Check size={15} className="text-accent" aria-hidden />
            <span className="flex-1 text-[14px] text-ink">Saved</span>
          </div>
        </div>
      ) : null}
      {canManage && dirty ? (
        <div className="sticky bottom-[calc(69px+env(safe-area-inset-bottom))] z-20 mt-4 md:bottom-4">
          <div className="animate-in flex items-center gap-2 rounded-xl bg-surface py-2 pl-4 pr-2 shadow-pop ring-1 ring-line" role="region" aria-label="Unsaved changes">
            <span className="flex-1 text-[14px] text-ink-2">Unsaved changes</span>
            <Button variant="ghost" size="sm" onClick={() => {
                setS(base);
                setResets((n) => n + 1);
              }}
              disabled={pending}>
              Discard
            </Button>
            <Button variant="primary" size="sm" onClick={save} disabled={pending}>
              {pending ? <LoaderCircle size={14} className="animate-spin" /> : null} Save
            </Button>
          </div>
        </div>
      ) : null}
    </div>
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
              <div className="min-w-0 flex-1">
                <p className="text-[14px]">{r.rule}</p>
                <p className="mt-0.5 text-[13px] text-ink-3">{r.source === "correction" ? "From a review" : "Added"} · {timeAgo(r.created_at)}</p>
              </div>
              {canRemove ? (
                <button
                  aria-label="Remove rule"
                  className="mt-0.5 rounded text-ink-3 opacity-0 transition-opacity hover:text-danger focus:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
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
        <p className="text-[14px] text-ink-3">No corrections yet. When you reject a draft with a reason, it becomes a rule here.</p>
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
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a rule" className="h-9" aria-label="New rule" />
          <Button disabled={pending || text.trim().length < 3}>
            <Plus size={14} /> Add
          </Button>
        </form>
      ) : null}
    </div>
  );
}
