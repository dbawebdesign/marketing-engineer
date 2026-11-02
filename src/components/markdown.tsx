import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { normQuote, receiptFor, receiptsWithPhrase } from "@/lib/receipts";

type HNode = { type: string; value?: string; tagName?: string; properties?: Record<string, unknown>; children?: HNode[] };

/** A quoted passage in prose: straight or curly double quotes, one line. */
const QUOTED = /([“"])([^“”"\n]{4,400}?)([”"])/g;
const SKIP = new Set(["a", "code", "pre", "button"]);
const BLOCK = new Set(["blockquote", "ul", "ol", "pre", "table", "p", "div", "h1", "h2", "h3", "h4"]);

const textOf = (n: HNode): string => (n.type === "text" ? (n.value ?? "") : (n.children ?? []).map(textOf).join(""));

/**
 * Marks quoted passages that match a receipt (so they can open their signal), and gives each
 * list-item claim a count of the receipts behind it: the quotes under it, plus receipts that
 * contain a phrase the claim quotes (e.g. “emergency dispatch” came up in 5 signals).
 */
function receiptPlugin(quotes: string[]) {
  return () => (tree: HNode) => {
    const mark = (node: HNode) => {
      if (!node.children || (node.tagName && SKIP.has(node.tagName))) return;
      const out: HNode[] = [];
      for (const c of node.children) {
        if (c.type !== "text" || !c.value) {
          mark(c);
          out.push(c);
          continue;
        }
        const v = c.value;
        let at = 0;
        for (const m of v.matchAll(QUOTED)) {
          const i = receiptFor(m[2]!, quotes);
          if (i < 0) continue;
          if (m.index! > at) out.push({ type: "text", value: v.slice(at, m.index) });
          out.push({ type: "element", tagName: "span", properties: { dataReceipt: String(i) }, children: [{ type: "text", value: m[0] }] });
          at = m.index! + m[0].length;
        }
        out.push(at ? { type: "text", value: v.slice(at) } : c);
      }
      node.children = out.filter((x) => x.type !== "text" || x.value);
    };
    mark(tree);

    const used = (n: HNode, acc: Set<number>) => {
      if (n.properties?.dataReceipt !== undefined) acc.add(Number(n.properties.dataReceipt));
      n.children?.forEach((c) => used(c, acc));
      return acc;
    };
    const hasLi = (n: HNode): boolean => (n.children ?? []).some((c) => c.tagName === "li" || hasLi(c));
    const claims = (n: HNode) => {
      for (const c of n.children ?? []) {
        if (c.tagName === "li" && !hasLi(c)) {
          // The claim is the item's first paragraph, or (in a tight list) its inline run before any block.
          const kids = (c.children ??= []);
          const p = kids.find((x) => x.tagName === "p");
          const blockAt = kids.findIndex((x) => x.tagName && BLOCK.has(x.tagName));
          const headKids = p ? (p.children ?? []) : kids.slice(0, blockAt < 0 ? kids.length : blockAt);
          const ids = used(c, new Set<number>());
          for (const m of headKids.map(textOf).join("").matchAll(QUOTED)) for (const i of receiptsWithPhrase(m[2]!, quotes)) ids.add(i);
          if (ids.size) {
            const chip: HNode = { type: "element", tagName: "span", properties: { dataReceiptCount: [...ids].sort((a, b) => a - b).join(",") }, children: [] };
            if (p) (p.children ??= []).push(chip);
            else kids.splice(blockAt < 0 ? kids.length : blockAt, 0, chip);
          }
        } else claims(c);
      }
    };
    claims(tree);
  };
}

type Opts = { children: string; receipts?: { quote: string }[]; onReceipt?: (index: number) => void };

/** Parsed trees for drafts that may be shown again soon (the inbox's open draft and its neighbours). */
const cache = new Map<string, { src: string; tree: React.ReactNode; handler: { current: ((i: number) => void) | null } }>();
const CACHE_MAX = 40;

function build({ children, receipts, onReceipt }: Opts, handler?: { current: ((i: number) => void) | null }) {
  const quotes = receipts?.length && (onReceipt || handler) ? receipts.map((r) => normQuote(r.quote)) : null;
  const open = handler ? (i: number) => handler.current?.(i) : onReceipt;
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={quotes ? [receiptPlugin(quotes)] : []}
      urlTransform={(url) => (/^(https?:|mailto:|#|\/(?!\/))/i.test(url) ? url : "")}
      components={{
        a: ({ node: _n, ...p }) => <a {...p} target="_blank" rel="noopener noreferrer nofollow" />,
        // Never load remote images from agent output: an injected image URL would leak data on view.
        img: ({ alt }) => (alt ? <span className="text-ink-3">[image: {alt}]</span> : null),
        span: ({ node: _n, children: kids, ...p }) => {
          const props = p as Record<string, unknown>;
          const one = props["data-receipt"];
          const many = props["data-receipt-count"];
          if (open && typeof one === "string")
            return (
              <button
                type="button"
                data-receipt-quote
                title="Open the signal behind this quote"
                onClick={() => open(Number(one))}
                className="cursor-pointer rounded-[3px] text-left underline decoration-accent/50 decoration-1 underline-offset-[3px] transition-colors hover:bg-accent-soft hover:decoration-accent [font:inherit]"
              >
                {kids}
              </button>
            );
          if (open && typeof many === "string") {
            const ids = many.split(",").map(Number);
            return (
              <button
                type="button"
                data-receipt-chip
                title={`${ids.length} receipt${ids.length === 1 ? "" : "s"} behind this claim. Open the first.`}
                onClick={() => open(ids[0]!)}
                className="ml-1.5 inline-flex h-[18px] translate-y-[-1px] items-center rounded-full bg-accent-soft px-1.5 align-middle text-[11px] font-medium text-accent tnum hover:bg-accent hover:text-bg"
              >
                {ids.length} receipt{ids.length === 1 ? "" : "s"}
              </button>
            );
          }
          return <span {...(p as React.HTMLAttributes<HTMLSpanElement>)}>{kids}</span>;
        },
      }}
    >
      {children}
    </ReactMarkdown>
  );
}

/**
 * Parse now and keep the tree, so showing this text later skips parsing. react-markdown is a
 * synchronous, hook-free function, so its output can be computed outside render.
 */
function cached(key: string, o: Opts) {
  const src = `${o.children}\u0000${o.receipts?.map((r) => r.quote).join("\u0001") ?? ""}`;
  let e = cache.get(key);
  if (!e || e.src !== src) {
    const handler = { current: o.onReceipt ?? null };
    const el = build(o, handler) as React.ReactElement<Parameters<typeof ReactMarkdown>[0]>;
    e = { src, tree: (ReactMarkdown as (p: Parameters<typeof ReactMarkdown>[0]) => React.ReactNode)(el.props), handler };
    cache.set(key, e);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  }
  return e;
}

/** Warm the cache for text that's likely to be shown next. */
export function warmMarkdown(key: string, o: Omit<Opts, "onReceipt">) {
  cached(key, o);
}

/**
 * Renders agent output and memory docs. Raw HTML is never rendered (react-markdown
 * escapes it by default), and links are forced to safe protocols, because agent
 * output is derived from untrusted customer signals. Images are never fetched.
 *
 * With `receipts`, quoted passages that match an evidence quote become buttons that call
 * `onReceipt`, and list-item claims get a small receipt count. With `cacheKey`, the parsed
 * tree is kept (see warmMarkdown).
 */
export function Markdown({
  children,
  className,
  receipts,
  onReceipt,
  cacheKey,
}: {
  children: string;
  className?: string;
  receipts?: { quote: string }[];
  onReceipt?: (index: number) => void;
  cacheKey?: string;
}) {
  let tree: React.ReactNode;
  if (cacheKey) {
    const e = cached(cacheKey, { children, receipts, onReceipt });
    e.handler.current = onReceipt ?? null;
    tree = e.tree;
  } else tree = build({ children, receipts, onReceipt });
  return <div className={`prose-me ${className ?? ""}`}>{tree}</div>;
}
