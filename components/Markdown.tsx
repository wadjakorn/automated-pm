"use client";

import { renderMarkdown } from "@/lib/markdown";

// Renders a task description's Markdown. The HTML is produced by our own
// escape-first renderer (lib/markdown.ts) which is XSS-safe by construction, so
// dangerouslySetInnerHTML here is intentional and bounded.
export function Markdown({ source, className }: { source: string; className?: string }) {
  return (
    <div
      className={`md-body ${className ?? ""}`}
      dangerouslySetInnerHTML={{ __html: renderMarkdown(source) }}
    />
  );
}
