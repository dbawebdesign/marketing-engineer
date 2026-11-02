"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { buttonClass, cx } from "./ui";

/** Copies text and confirms in place: the label flips to "Copied" for a moment. */
export function CopyButton({ text, label = "Copy", className, variant = "secondary" }: { text: string; label?: string; className?: string; variant?: "secondary" | "ghost" }) {
  const [done, setDone] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (t.current && clearTimeout(t.current)), []);
  return (
    <button
      type="button"
      className={cx(buttonClass(variant, "sm"), "h-7 px-2.5 text-[12.5px]", className)}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          if (t.current) clearTimeout(t.current);
          t.current = setTimeout(() => setDone(false), 1600);
        } catch {
          /* clipboard blocked: leave the label as is */
        }
      }}
    >
      {done ? <Check size={13} className="text-accent" /> : <Copy size={13} />}
      <span aria-live="polite">{done ? "Copied" : label}</span>
    </button>
  );
}
