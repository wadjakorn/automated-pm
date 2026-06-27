"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// Render a description as GitHub-flavored Markdown. No raw HTML is allowed
// (react-markdown ignores it by default), so user text is safe to display.
// Elements are styled with the app's theme tokens instead of a typography
// plugin, keeping the dependency surface small.
const components: Components = {
  h1: (p) => <h1 className="mt-3 mb-1 text-base font-semibold text-fg" {...p} />,
  h2: (p) => <h2 className="mt-3 mb-1 text-sm font-semibold text-fg" {...p} />,
  h3: (p) => <h3 className="mt-2 mb-1 text-sm font-semibold text-fg" {...p} />,
  p: (p) => <p className="my-1.5 leading-relaxed" {...p} />,
  a: (p) => (
    <a
      className="text-accent hover:underline"
      target="_blank"
      rel="noopener noreferrer"
      {...p}
    />
  ),
  ul: (p) => <ul className="my-1.5 list-disc pl-5" {...p} />,
  ol: (p) => <ol className="my-1.5 list-decimal pl-5" {...p} />,
  li: (p) => <li className="my-0.5" {...p} />,
  strong: (p) => <strong className="font-semibold text-fg" {...p} />,
  em: (p) => <em className="italic" {...p} />,
  del: (p) => <del className="text-fg-subtle" {...p} />,
  blockquote: (p) => (
    <blockquote
      className="my-1.5 border-l-2 border-border pl-3 text-fg-muted"
      {...p}
    />
  ),
  code: (p) => (
    <code
      className="rounded bg-bg-soft px-1 py-0.5 text-[12px] font-mono text-fg"
      {...p}
    />
  ),
  pre: (p) => (
    <pre
      className="my-1.5 overflow-x-auto rounded bg-bg-soft p-2 text-[12px] font-mono text-fg [&_code]:bg-transparent [&_code]:p-0"
      {...p}
    />
  ),
  hr: () => <hr className="my-3 border-border" />,
  table: (p) => (
    <div className="my-1.5 overflow-x-auto">
      <table className="w-full border-collapse text-xs" {...p} />
    </div>
  ),
  th: (p) => (
    <th className="border border-border px-2 py-1 text-left font-semibold" {...p} />
  ),
  td: (p) => <td className="border border-border px-2 py-1" {...p} />,
  img: (p) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="my-1.5 max-w-full rounded" alt={p.alt ?? ""} {...p} />
  ),
};

export function Markdown({ children }: { children: string }) {
  return (
    <div className="text-sm text-fg-muted">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
