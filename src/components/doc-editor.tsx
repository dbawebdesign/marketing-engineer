"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, LoaderCircle, Pencil } from "lucide-react";
import { saveDocAction } from "@/app/(app)/actions";
import { AutoTextarea } from "./auto-textarea";
import { Button, Kbd } from "./ui";
import { toast } from "./toast";

export function DocEditor({
  docKey,
  content,
  version,
  preview,
  hint,
  template,
  agentWritten,
  canEdit,
}: {
  docKey: string;
  content: string;
  version: number;
  preview: React.ReactNode;
  hint?: string;
  template?: string;
  /** Docs an agent keeps up to date: show the empty state, not an open editor. */
  agentWritten?: boolean;
  canEdit: boolean;
}) {
  const startsOpen = (c: string) => !c.trim() && canEdit && !agentWritten;
  const [editing, setEditing] = useState(startsOpen(content));
  const [value, setValue] = useState(content);
  const [pending, start] = useTransition();
  const router = useRouter();
  const area = useRef<HTMLTextAreaElement>(null);
  const dirty = value !== content;

  useEffect(() => {
    setValue(content);
    setEditing(startsOpen(content));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        <div className="rounded-2xl bg-surface p-6 ring-1 ring-line sm:p-8">{preview}</div>
        {canEdit ? (
          <Button variant="secondary" size="sm" className="mt-4" onClick={() => setEditing(true)}>
            <Pencil size={13} /> {content.trim() ? "Edit" : "Write it yourself"}
          </Button>
        ) : null}
      </div>
    );

  const empty = !value.trim();
  return (
    <div>
      <div className="rounded-2xl bg-surface ring-1 ring-line transition-shadow focus-within:ring-line-strong focus-within:shadow-soft">
        {(hint || template) && empty ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5 sm:px-6">
            {hint ? <p className="min-w-0 flex-1 text-[14px] text-ink-2">{hint}</p> : <span />}
            {template ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setValue(template);
                  requestAnimationFrame(() => area.current?.focus());
                }}
              >
                <FileText size={13} /> Start from a template
              </Button>
            ) : null}
          </div>
        ) : null}
        <AutoTextarea
          ref={area}
          bare
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={12}
          aria-label="Document"
          className="px-5 py-4 sm:px-6"
          placeholder={template ? "Write here, or start from the template above. Markdown works." : "Write here. Markdown works."}
        />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button variant="primary" onClick={save} disabled={!dirty || pending}>
          {pending ? <LoaderCircle size={14} className="animate-spin" /> : null} Save <Kbd>⌘S</Kbd>
        </Button>
        {content.trim() || agentWritten ? (
          <Button
            variant="ghost"
            onClick={() => {
              setValue(content);
              setEditing(false);
            }}
          >
            Cancel
          </Button>
        ) : dirty ? (
          <Button variant="ghost" onClick={() => setValue(content)}>
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  );
}
