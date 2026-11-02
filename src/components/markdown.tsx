import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders agent output and memory docs. Raw HTML is never rendered (react-markdown
 * escapes it by default), and links are forced to safe protocols, because agent
 * output is derived from untrusted customer signals.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={`prose-me ${className ?? ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => (/^(https?:|mailto:|#|\/)/i.test(url) ? url : "")}
        components={{ a: ({ node: _n, ...p }) => <a {...p} target="_blank" rel="noopener noreferrer nofollow" /> }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
