"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { LoaderCircle, Plus, Upload, X } from "lucide-react";
import { importCsvAction, runAgentAction } from "@/app/(app)/actions";
import { addNotesAction, pulseOfferAction } from "@/app/(app)/actions-signals";
import { Button, Input, Label, Textarea, buttonClass, cx, plural } from "./ui";
import { toast } from "./toast";
import { inferAccount } from "@/lib/infer-account";
import { inferSource } from "@/lib/infer-source";

const SOURCES: [string, string][] = [
  ["sales_call", "Sales call"],
  ["support_ticket", "Support ticket"],
  ["churn_note", "Churn note"],
  ["crm_note", "CRM note"],
  ["review", "Review"],
  ["social", "Social"],
  ["interview", "Interview"],
  ["survey", "Survey"],
  ["other", "Other"],
];

const LABEL = new Map(SOURCES);
/** Notes keep their edits while the paste around them changes. */
const noteKey = (n: string) => n.trim().slice(0, 120);
type Override = { source?: string; account?: string };

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let f = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (q) {
      if (c === '"' && text[i + 1] === '"') { f += '"'; i++; }
      else if (c === '"') q = false;
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(f); f = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else f += c;
  }
  row.push(f);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

export function AddSignals({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [source, setSource] = useState("sales_call");
  const [content, setContent] = useState("");
  const [account, setAccount] = useState("");
  // Per-note edits to the guessed source/account, keyed by the note's opening text.
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [split, setSplit] = useState(true);
  const [pending, start] = useTransition();
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    const onOpen = () => setOpen(true);
    window.addEventListener("me:add-signals", onOpen);
    return () => window.removeEventListener("me:add-signals", onOpen);
  }, []);

  // Esc closes; the page behind doesn't scroll; focus returns to the trigger.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const back = trigger.current;
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      back?.focus();
    };
  }, [open]);
  const texts = (split ? content.split(/\n\s*\n+/) : [content]).map((c) => c.trim()).filter(Boolean);
  const count = texts.length;
  // Each note gets its own source and account: your edit, else what the note says, else the defaults above.
  const notes = texts.map((text) => {
    const o = overrides[noteKey(text)] ?? {};
    const gSource = inferSource(text);
    const gAccount = inferAccount(text);
    return {
      key: noteKey(text),
      text,
      source: o.source ?? gSource ?? source,
      account: o.account ?? gAccount ?? account.trim(),
      guessed: { source: !o.source && !!gSource, account: o.account === undefined && !!gAccount },
    };
  });
  const setNote = (key: string, patch: Override) => setOverrides((m) => ({ ...m, [key]: { ...m[key], ...patch } }));

  /** Close, say what happened, and offer the run the new signals make possible. */
  const done = async (r: { inserted: number; duplicates: number }) => {
    const text = r.inserted
      ? `Added ${plural(r.inserted, "signal")}${r.duplicates ? ` · ${r.duplicates} already here` : ""}`
      : r.duplicates ? `${plural(r.duplicates, "signal")} already here` : "Nothing new to add";
    setContent("");
    setAccount("");
    setOverrides({});
    setOpen(false);
    router.refresh();
    const offer = r.inserted ? await pulseOfferAction().catch(() => null) : null;
    const pulse = offer?.ok ? offer.data : null;
    toast.ok(text, {
      key: "add-signals",
      action: pulse
        ? {
            label: `Run ${pulse.name}`,
            run: async () => {
              const run = await runAgentAction(pulse.id);
              if (!run.ok) return void toast.error(run.error, { key: "add-signals" });
              toast.ok(`${pulse.name} is running · its memo lands in your inbox`, { key: "add-signals" });
              router.refresh();
            },
          }
        : undefined,
    });
  };

  const onCsv = (f: File) =>
    start(async () => {
      if (f.size > 5_000_000) return void toast.error("CSV files up to 5 MB, please");
      const rows = parseCsv(await f.text());
      const head = rows.shift()?.map((h) => h.trim().toLowerCase()) ?? [];
      const ci = (n: string) => head.indexOf(n);
      if (ci("content") < 0) return void toast.error("Your CSV needs a “content” column");
      const valid = new Set(SOURCES.map((s) => s[0]));
      const data = rows.map((r) => ({
        source: (valid.has(r[ci("source")]?.trim() ?? "") ? r[ci("source")]!.trim() : source) as never,
        content: r[ci("content")] ?? "",
        title: ci("title") >= 0 ? r[ci("title")] : undefined,
        account: ci("account") >= 0 ? r[ci("account")] || null : null,
        url: ci("url") >= 0 ? r[ci("url")] || null : null,
        occurred_at: ci("occurred_at") >= 0 && r[ci("occurred_at")] ? (r[ci("occurred_at")] as never) : undefined,
      })).filter((r) => r.content.trim());
      const total = { inserted: 0, duplicates: 0 };
      for (let i = 0; i < data.length; i += 1000) {
        const res = await importCsvAction(data.slice(i, i + 1000));
        if (!res.ok) {
          if (total.inserted) router.refresh();
          return void toast.error(total.inserted ? `Added ${plural(total.inserted, "signal")}, then: ${res.error}` : res.error);
        }
        total.inserted += res.data?.inserted ?? 0;
        total.duplicates += res.data?.duplicates ?? 0;
      }
      await done(total);
    });

  const button = (
    <button ref={trigger} type="button" className={buttonClass("primary")} onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>
      <Plus size={14} /> Add signals
    </button>
  );
  if (!open || !mounted) return button;

  return (
    <>
      {button}
      {createPortal(
    <div className="fixed inset-0 z-40 flex justify-end bg-black/20 backdrop-blur-[2px]" onMouseDown={() => setOpen(false)}>
      <div className="animate-in flex h-dvh w-full max-w-[520px] flex-col bg-bg shadow-pop ring-1 ring-line" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="add-signals-title">
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 id="add-signals-title" className="font-semibold">Add signals</h2>
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)} aria-label="Close">
            <X size={16} />
          </Button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <div>
            <Label hint={count > 1 ? "for notes that don't say" : undefined}>{count > 1 ? "Default source" : "Where is this from?"}</Label>
            <div className="flex flex-wrap gap-1.5">
              {SOURCES.map(([v, l]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setSource(v)}
                  className={cx("h-8 rounded-lg px-3 text-[13px] transition-colors", source === v ? "bg-ink text-bg" : "bg-surface text-ink-2 ring-1 ring-line-strong hover:text-ink")}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          <label className="block">
            <Label hint={split && count > 1 ? plural(count, "note") : undefined}>Paste notes</Label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={count > 1 ? 7 : 12}
              autoFocus
              placeholder={"Paste call summaries, tickets, reviews…\n\nSeparate notes with a blank line to add many at once."}
            />
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} className="size-4 accent-[var(--accent)]" />
            Each paragraph is a separate note
          </label>
          <label className="block">
            <Label hint={count > 1 ? "for notes that don't name one" : "optional"}>{count > 1 ? "Default account" : "Account"}</Label>
            <Input value={account} onChange={(e) => setAccount(e.target.value)} placeholder="e.g. Polar Mechanical" />
          </label>
          {count ? (
            <div>
              <Label hint="read from each note · change any before adding">{count > 1 ? `${plural(count, "note")} to add` : "Note to add"}</Label>
              <ul className="divide-y divide-line overflow-hidden rounded-xl ring-1 ring-line" data-testid="note-rows">
                {notes.map((n, i) => (
                  <li key={`${i}:${n.key}`} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center">
                    <p className="min-w-0 flex-1 truncate text-[13px] text-ink-2" title={n.text}>{n.text.split("\n")[0]}</p>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <select
                        aria-label={`Source for note ${i + 1}`}
                        value={n.source}
                        onChange={(e) => setNote(n.key, { source: e.target.value })}
                        className={cx("h-7 rounded-full bg-surface pl-2.5 pr-1 text-[12px] ring-1 ring-line-strong", n.guessed.source ? "text-ink" : "text-ink-2")}
                      >
                        {SOURCES.map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                        {LABEL.has(n.source) ? null : <option value={n.source}>{n.source}</option>}
                      </select>
                      <input
                        aria-label={`Account for note ${i + 1}`}
                        value={n.account}
                        onChange={(e) => setNote(n.key, { account: e.target.value })}
                        placeholder="No account"
                        className="h-7 w-36 rounded-full bg-surface px-2.5 text-[12px] text-ink ring-1 ring-line-strong placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="rounded-xl border border-dashed border-line-strong p-4 text-sm text-ink-2">
            <p>
              Have an export? Upload a CSV with a <code className="rounded bg-subtle px-1">content</code> column, plus optional source, title, account, url, occurred_at.
            </p>
            <input ref={file} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && onCsv(e.target.files[0])} />
            <Button variant="secondary" size="sm" className="mt-3" onClick={() => file.current?.click()} disabled={pending}>
              <Upload size={13} /> Upload CSV
            </Button>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-6 py-4">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Done
          </Button>
          <Button
            variant="primary"
            disabled={pending || !count}
            onClick={() =>
              start(async () => {
                const r = await addNotesAction(notes.map((n) => ({ source: n.source, content: n.text, account: n.account || null })));
                if (!r.ok) toast.error(r.error);
                else if (r.data) await done(r.data);
              })
            }
          >
            {pending ? <LoaderCircle size={14} className="animate-spin" /> : null}
            Add {count > 1 ? plural(count, "note") : "note"}
          </Button>
        </div>
      </div>
    </div>,
        document.body,
      )}
    </>
  );
}
