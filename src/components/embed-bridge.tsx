"use client";
import { useEffect } from "react";

const KEY = "me:parent-origin";

function parentOrigin(): string | null {
  try {
    const fromUrl = new URLSearchParams(location.search).get("parent_origin");
    if (fromUrl && /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(fromUrl)) sessionStorage.setItem(KEY, fromUrl);
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Tell the host page about events (e.g. a draft was approved). Never posts to "*". */
export function emitEmbed(name: string, data: Record<string, unknown> = {}) {
  const origin = parentOrigin();
  if (origin && window.parent !== window) window.parent.postMessage({ type: "me:event", name, data }, origin);
}

/** Keeps the host iframe sized to the content. Mounted only in embed mode. */
export function EmbedBridge() {
  useEffect(() => {
    const origin = parentOrigin();
    if (!origin || window.parent === window) return;
    let last = 0;
    const send = () => {
      const h = Math.ceil(document.documentElement.scrollHeight);
      if (h !== last) {
        last = h;
        window.parent.postMessage({ type: "me:resize", height: h }, origin);
      }
    };
    const ro = new ResizeObserver(send);
    ro.observe(document.body);
    send();
    return () => ro.disconnect();
  }, []);
  return null;
}
