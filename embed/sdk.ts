/**
 * Marketing Engineer embed SDK (dependency-free). Built to public/embed/v1.js with
 * `pnpm build:embed`, exposed as the global `MarketingEngineer`.
 *
 *   <div id="me"></div>
 *   <script src="https://YOUR-ME-HOST/embed/v1.js"></script>
 *   <script>
 *     const handle = MarketingEngineer.mount(document.getElementById("me"), {
 *       baseUrl: "https://YOUR-ME-HOST",
 *       token: TOKEN_FROM_YOUR_BACKEND, // short-lived HS256 JWT, one per mount
 *       path: "/drafts",
 *       theme: "auto",
 *       onEvent: (e) => console.log(e.name, e.data),
 *     });
 *     // later: handle.unmount();
 *   </script>
 *
 * Messages from the frame are only accepted when they come from `baseUrl`'s origin AND
 * from this iframe's window.
 */

export type Theme = "light" | "dark" | "auto";

export type MountOptions = {
  baseUrl: string;
  token: string;
  path?: string;
  theme?: Theme;
  /** Fixed height in px; disables auto-resize. */
  height?: number;
  minHeight?: number;
  maxHeight?: number;
  title?: string;
  onEvent?: (event: { name: string; data: unknown }) => void;
  onResize?: (height: number) => void;
};

export type MountHandle = { iframe: HTMLIFrameElement; unmount: () => void };

const mounted = new WeakMap<Element, MountHandle>();

function originOf(url: string): string {
  const u = new URL(url);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("MarketingEngineer: baseUrl must be http(s)");
  return u.origin;
}

export function mount(el: Element | string, opts: MountOptions): MountHandle {
  const target = typeof el === "string" ? document.querySelector(el) : el;
  if (!target) throw new Error("MarketingEngineer: mount element not found");
  if (!opts || !opts.token) throw new Error("MarketingEngineer: token is required");
  const origin = originOf(opts.baseUrl);
  mounted.get(target)?.unmount();

  const path = opts.path && /^\/[A-Za-z0-9\-._~/]*$/.test(opts.path) ? opts.path : "/";
  const qs = new URLSearchParams({ token: opts.token, path, parent_origin: window.location.origin });
  if (opts.theme) qs.set("theme", opts.theme);

  const minH = opts.minHeight ?? 320;
  const maxH = opts.maxHeight ?? 20000;
  const iframe = document.createElement("iframe");
  iframe.src = `${origin}/embed/start?${qs.toString()}`;
  iframe.title = opts.title ?? "Marketing Engineer";
  iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups");
  iframe.setAttribute("allow", "clipboard-write");
  iframe.setAttribute("loading", "lazy");
  iframe.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  iframe.style.cssText = `display:block;width:100%;border:0;color-scheme:normal;height:${opts.height ?? minH}px`;

  function onMessage(ev: MessageEvent) {
    if (ev.origin !== origin || ev.source !== iframe.contentWindow) return;
    const msg = ev.data as { type?: unknown; height?: unknown; name?: unknown; data?: unknown } | null;
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "me:resize" && opts.height === undefined && typeof msg.height === "number" && Number.isFinite(msg.height)) {
      const h = Math.round(Math.min(maxH, Math.max(minH, msg.height)));
      iframe.style.height = `${h}px`;
      opts.onResize?.(h);
    } else if (msg.type === "me:event" && typeof msg.name === "string" && msg.name.length <= 100) {
      try {
        opts.onEvent?.({ name: msg.name, data: msg.data });
      } catch (e) {
        console.error("MarketingEngineer onEvent handler threw", e);
      }
    }
  }

  window.addEventListener("message", onMessage);
  target.appendChild(iframe);

  const handle: MountHandle = {
    iframe,
    unmount() {
      window.removeEventListener("message", onMessage);
      iframe.remove();
      if (mounted.get(target) === handle) mounted.delete(target);
    },
  };
  mounted.set(target, handle);
  return handle;
}

/** Remove whatever is mounted in `el`. */
export function unmount(el: Element | string): void {
  const target = typeof el === "string" ? document.querySelector(el) : el;
  if (target) mounted.get(target)?.unmount();
}

export const version = "1";
