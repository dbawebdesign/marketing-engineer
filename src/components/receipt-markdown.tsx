"use client";
import { useCallback, useState } from "react";
import { Markdown } from "./markdown";
import { SignalSheet } from "./signal-sheet";

type Receipt = { signal_id: string; quote: string };

/**
 * A saved doc (truth file, weekly brief) with its quotes linked to the signals behind them,
 * the same way a draft reads in the inbox: a quote opens its signal in a side sheet.
 */
export function ReceiptMarkdown({ children, receipts }: { children: string; receipts: Receipt[] }) {
  const [open, setOpen] = useState<Receipt | null>(null);
  const onReceipt = useCallback((i: number) => setOpen(receipts[i] ?? null), [receipts]);
  return (
    <>
      <Markdown receipts={receipts.length ? receipts : undefined} onReceipt={receipts.length ? onReceipt : undefined}>
        {children}
      </Markdown>
      {open ? <SignalSheet id={open.signal_id} quote={open.quote} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
