// Description Markdown is rendered with react-markdown (components/Markdown.tsx).
// This helper produces a flat plain-text preview for compact spots like the
// board card, where rendering full Markdown (images, headings) would blow up
// the layout — drop images entirely, unwrap links, strip the lightweight
// emphasis/heading/list markers.
export function markdownToPlainText(src: string): string {
  if (!src) return "";
  return src
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images -> nothing
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links -> text
    .replace(/`{1,3}/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/^\s*\|?[-:\s|]+\|?\s*$/gm, "") // GFM table separator rows
    .replace(/\|/g, " ") // table cell pipes
    .replace(/\s+/g, " ")
    .trim();
}
