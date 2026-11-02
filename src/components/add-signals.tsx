"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { LoaderCircle, Plus, Upload, X } from "lucide-react";
import { addSignalsAction, importCsvAction } from "@/app/(app)/actions";
import { Button, Input, Label, Textarea, buttonClass, cx, plural } from "./ui";
import { toast } from "./toast";

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
  const count = split ? content.split(/\n\s*\n+/).filter((c) => c.trim()).length : content.trim() ? 1 : 0;

  const done = (r: { inserted: number; duplicates: number }) => {
    toast.ok(`Added ${plural(r.inserted, "signal")}${r.duplicates ? ` · ${r.duplicates} already here` : ""}`);
    setContent("");
    setAccount("");
    router.refresh();
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
      for (let i = 0; i < data.length; i += 1000) {
        const res = await importCsvAction(data.slice(i, i + 1000));
        if (!res.ok) return void toast.error(res.error);
        if (res.data) done(res.data);
      }
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
            <Label>Where is this from?</Label>
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
              rows={12}
              autoFocus
              placeholder={"Paste call summaries, tickets, reviews…\n\nSeparate notes with a blank line to add many at once."}
            />
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} className="size-4 accent-[var(--accent)]" />
            Each paragraph is a separate note
          </label>
          <label className="block">
            <Label hint="optional">Account</Label>
            <Input value={account} onChange={(e) => setAccount(e.target.value)} placeholder="e.g. Polar Mechanical" />
          </label>
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
                const r = await addSignalsAction({ source, content, account, split });
                if (!r.ok) toast.error(r.error);
                else if (r.data) done(r.data);
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
