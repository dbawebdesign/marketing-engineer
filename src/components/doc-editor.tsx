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
  title,
  meta,
  startEditing = false,
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
  /** The doc's name, with its quiet meta line; the Edit button sits beside it. */
  title: React.ReactNode;
  meta?: React.ReactNode;
  /** Open in the editor (e.g. arriving from an Edit link elsewhere). */
  startEditing?: boolean;
}) {
  const startsOpen = (c: string) => canEdit && !c.trim() && !agentWritten;
  const [editing, setEditing] = useState(startsOpen(content) || (canEdit && startEditing));
  const [value, setValue] = useState(content);
  const [pending, start] = useTransition();
  const router = useRouter();
  const area = useRef<HTMLTextAreaElement>(null);
  const dirty = value !== content;

  const seenRef = useRef(`${docKey}\n${canEdit}\n${content}`);
  useEffect(() => {
    // Only a new doc or a saved version resets the editor, not the first render.
    const k = `${docKey}\n${canEdit}\n${content}`;
    if (seenRef.current === k) return;
    seenRef.current = k;
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

  const header = (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {meta ? <p className="mt-0.5 text-[13px] text-ink-3">{meta}</p> : null}
      </div>
      {canEdit && !editing ? (
        <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
          <Pencil size={13} /> {content.trim() ? "Edit" : "Write it yourself"}
        </Button>
      ) : null}
    </div>
  );

  if (!editing)
    return (
      <div>
        {header}
        <div className="rounded-2xl bg-surface p-6 ring-1 ring-line sm:p-8">{preview}</div>
      </div>
    );

  const empty = !value.trim();
  return (
    <div>
      {header}
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
