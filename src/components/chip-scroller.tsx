"use client";
import { useEffect, useRef } from "react";

/** A horizontal strip that keeps the current item (aria-current) in view. */
export function ChipScroller({ className, children }: { className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    const cur = el?.querySelector<HTMLElement>("[aria-current]");
    if (el && cur) el.scrollLeft = cur.offsetLeft - el.clientWidth / 2 + cur.offsetWidth / 2;
  });
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
