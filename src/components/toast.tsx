"use client";
import { useEffect, useState } from "react";
import { CircleCheck, CircleX } from "lucide-react";

type T = { id: number; text: string; tone: "ok" | "error" };
let push: ((t: Omit<T, "id">) => void) | null = null;
export const toast = {
  ok: (text: string) => push?.({ text, tone: "ok" }),
  error: (text: string) => push?.({ text, tone: "error" }),
};

export function Toaster() {
  const [items, setItems] = useState<T[]>([]);
  useEffect(() => {
    let n = 0;
    push = (t) => {
      const id = ++n;
      setItems((xs) => [...xs.slice(-2), { ...t, id }]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), t.tone === "error" ? 6000 : 3200);
    };
    return () => {
      push = null;
    };
  }, []);
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
      {items.map((t) => (
        <div key={t.id} className="animate-in flex items-center gap-2 rounded-xl bg-ink px-3.5 py-2.5 text-sm text-bg shadow-pop">
          {t.tone === "ok" ? <CircleCheck size={15} className="text-accent" /> : <CircleX size={15} className="text-danger" />}
          {t.text}
        </div>
      ))}
    </div>
  );
}
