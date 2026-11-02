"use client";
import { useEffect, useRef, useState } from "react";

const FADE = 24;

/**
 * A horizontal strip that keeps the current item (aria-current) fully in view, with a soft
 * fade on whichever edge has more chips beyond it.
 */
export function ChipScroller({ className, children }: { className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const cur = el.querySelector<HTMLElement>("[aria-current]");
    if (cur) {
      // Measure against the strip itself (offsetLeft is relative to the nearest positioned ancestor).
      const box = el.getBoundingClientRect();
      const r = cur.getBoundingClientRect();
      const left = r.left - box.left + el.scrollLeft;
      const pad = parseFloat(getComputedStyle(el).paddingLeft) || 0;
      // Chips that already fit from the start stay put (no half-cut first chip); later ones are centered.
      const target = left + r.width <= el.clientWidth - pad - FADE ? 0 : left - el.clientWidth / 2 + r.width / 2;
      el.scrollLeft = Math.max(0, Math.min(target, el.scrollWidth - el.clientWidth));
    }
    const update = () => setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [children]);

  const mask = `linear-gradient(to right, ${edges.left ? "transparent" : "#000"}, #000 ${FADE}px, #000 calc(100% - ${FADE}px), ${edges.right ? "transparent" : "#000"})`;
  return (
    <div ref={ref} className={className} style={edges.left || edges.right ? { maskImage: mask, WebkitMaskImage: mask } : undefined}>
      {children}
    </div>
  );
}
