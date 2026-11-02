"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import { saveIntroAction, skipIntroAction } from "@/app/(app)/actions";
import { INTRO_FIELDS, type IntroAnswers, type IntroName } from "@/lib/intro-fields";
import { AutoTextarea } from "./auto-textarea";
import { Button, plural } from "./ui";
import { toast } from "./toast";
import { useBase } from "./nav";

/**
 * Three short answers before anything else, so agents write as this company, not a generic one.
 * Each answer becomes the first version of a memory doc. Only empty docs are asked about.
 */
export function IntroStep({ ask, canSkip = true }: { ask: IntroName[]; canSkip?: boolean }) {
  const fields = INTRO_FIELDS.filter((f) => ask.includes(f.name));
  const [v, setV] = useState<IntroAnswers>({});
  const [pending, start] = useTransition();
  const [skipping, startSkip] = useTransition();
  const router = useRouter();
  const base = useBase();
  const any = fields.some((f) => v[f.name]?.trim());
  const save = () =>
    start(async () => {
      const r = await saveIntroAction(v);
      if (!r.ok) return void toast.error(r.error);
      toast.ok(`Saved to ${plural(r.data?.saved ?? 0, "memory doc")}. Agents read them on every run.`);
      router.replace(`${base}/today`);
      router.refresh();
    });
  return (
    <section className="mt-10 rounded-2xl bg-surface p-6 shadow-soft ring-1 ring-line sm:p-8" aria-labelledby="intro-h">
      <h2 id="intro-h" className="text-lg font-semibold tracking-tight">
        First, who are you?
      </h2>
      <p className="mt-1 max-w-xl text-ink-2">A few lines each is plenty. Agents read these before every run, so drafts sound like you and target your buyers.</p>
      <form
        className="mt-6 space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (any) save();
        }}
      >
        {fields.map((f) => (
          <label key={f.name} className="block">
            <span className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px] font-medium text-ink-2">
              {f.label}
              <span className="hidden font-normal text-ink-3 sm:inline">Saved to {f.doc}</span>
            </span>
            <AutoTextarea
              name={f.name}
              rows={f.rows}
              value={v[f.name] ?? ""}
              onChange={(e) => setV((p) => ({ ...p, [f.name]: e.target.value }))}
              placeholder={f.placeholder}
              maxLength={20000}
              className="py-2.5"
            />
          </label>
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" disabled={!any || pending}>
            {pending ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" /> : null} Save and continue
          </Button>
          {canSkip ? (
            <button
              type="button"
              disabled={skipping || pending}
              className="text-sm text-ink-3 hover:text-ink-2 disabled:opacity-60"
              onClick={() =>
                startSkip(async () => {
                  const r = await skipIntroAction();
                  if (!r.ok) return void toast.error(r.error);
                  router.replace(`${base}/today`);
                  router.refresh();
                })
              }
            >
              Skip for now
            </button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
