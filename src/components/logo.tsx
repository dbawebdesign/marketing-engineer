export function Logo({ size = 22 }: { size?: number }) {
  // A signal line turning into an upward step: market signal → pipeline.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <rect width="24" height="24" rx="6.5" fill="var(--ink)" />
      <path d="M5 14.5h3.2l2-5 3 8 2-4.5H19" fill="none" stroke="var(--bg)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
