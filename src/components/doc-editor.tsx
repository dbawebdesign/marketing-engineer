"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Pencil } from "lucide-react";
import { saveDocAction } from "@/app/(app)/actions";
import { Button, Kbd, Textarea } from "./ui";
import { toast } from "./toast";

export function DocEditor({ docKey, content, version, preview, hint, canEdit }: { docKey: string; content: string; version: number; preview: React.ReactNode; hint?: string; canEdit: boolean }) {
  const [editing, setEditing] = useState(!content.trim() && canEdit);
  const [value, setValue] = useState(content);
  const [pending, start] = useTransition();
  const router = useRouter();
  const dirty = value !== content;

  useEffect(() => {
    setValue(content);
    setEditing(!content.trim() && canEdit);
  }, [docKey, content, canEdit]);

  const save = () =>
    start(async () => {
      const r = await saveDocAction(docKey, value, version);
      if (!r.ok) return void toast.error(r.error);
      toast.ok("Saved. Agents will use this on their next run.");
      setEditing(false);
      router.refresh();
    });

  useEffect(() => {
    if (!editing) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (dirty) save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, dirty, value]);

  if (!editing)
    return (
      <div>
        <div className="rounded-2xl bg-surface p-7 ring-1 ring-line">{preview}</div>
        {canEdit ? (
          <Button variant="secondary" size="sm" className="mt-4" onClick={() => setEditing(true)}>
            <Pencil size={13} /> Edit
          </Button>
        ) : null}
      </div>
    );

  return (
    <div>
      {hint ? <p className="mb-3 text-sm text-ink-2">{hint}</p> : null}
      <Textarea value={value} onChange={(e) => setValue(e.target.value)} rows={22} className="font-mono text-[13px] leading-relaxed" autoFocus placeholder="Write in Markdown…" />
      <div className="mt-3 flex items-center gap-2">
        <Button variant="primary" onClick={save} disabled={!dirty || pending}>
          {pending ? <LoaderCircle size={14} className="animate-spin" /> : null} Save <Kbd>⌘S</Kbd>
        </Button>
        {content.trim() ? (
          <Button variant="ghost" onClick={() => { setValue(content); setEditing(false); }}>
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  );
}
