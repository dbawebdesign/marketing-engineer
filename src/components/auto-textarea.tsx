"use client";
import { forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef, type TextareaHTMLAttributes } from "react";
import { cx } from "./ui";

/** A textarea that grows to fit its content, so no line is ever clipped. */
export const AutoTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { bare?: boolean }>(function AutoTextarea(
  { className, bare, value, onChange, ...p },
  fwd,
) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(fwd, () => ref.current!);
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`;
  }, []);
  useLayoutEffect(fit, [value, fit]);
  useLayoutEffect(() => {
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [fit]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      className={cx(
        "block w-full resize-none overflow-hidden text-[15px] leading-relaxed text-ink placeholder:text-ink-3",
        bare
          ? "bg-transparent focus:outline-none"
          : "rounded-lg bg-surface px-3 py-2 ring-1 ring-line-strong transition-shadow focus:outline-none focus:ring-2 focus:ring-accent",
        className,
      )}
      {...p}
    />
  );
});
