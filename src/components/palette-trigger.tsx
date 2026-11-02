"use client";
export function PaletteTrigger({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new Event("me:palette"))}>
      {children}
    </button>
  );
}
