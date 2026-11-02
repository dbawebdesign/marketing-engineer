"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { following } from "./run-button";

/** Re-renders the server page every few seconds while agents are working. */
export function LiveRefresh({ every = 2500 }: { every?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.hidden || following.n > 0) return;
      router.refresh();
    }, every);
    return () => clearInterval(t);
  }, [router, every]);
  return null;
}
