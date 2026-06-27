// Tiny, dependency-free, XSS-safe Markdown -> HTML renderer. The app keeps its
// dependency tree lean, so instead of pulling react-markdown + a sanitizer we
// render a small, well-scoped subset and stay safe by construction:
//
//   1. Escape ALL HTML entities FIRST. After this step the source cannot
//      contain a live tag, attribute, or `javascript:` handler.
//   2. Only THEN apply transforms that emit our own fixed set of tags.
//   3. Every URL (image src / link href) passes through safeUrl(), which
//      whitelists schemes — so escaped text can never reintroduce script.
//
// Supported: images, links, **bold**, *italic*, `code`, ``` fences ```,
// # headings (1-3), - lists, --- rules, blank-line paragraphs, soft <br>.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Whitelist URL schemes. Returns null (caller drops it) for anything that
// could execute — javascript:, vbscript:, data:text/html, etc. data:image is
// allowed for inline previews; /api/uploads and other relative paths pass.
export function safeUrl(raw: string): string | null {
  const u = raw.trim();
  if (u === "") return null;
  if (u.startsWith("/") || u.startsWith("#")) return u; // relative / anchor
  if (/^https?:\/\//i.test(u)) return u;
  if (/^mailto:/i.test(u)) return u;
  if (/^data:image\/(png|jpeg|jpg|gif|webp|avif|svg\+xml);/i.test(u)) return u;
  return null;
}

// Inline transforms. Input MUST already be HTML-escaped. Order matters:
// images before links (both use [..](..)), code before emphasis so `*` inside
// backticks is left alone.
function renderInline(escaped: string): string {
  let s = escaped;

  // images: ![alt](url)
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => {
    const safe = safeUrl(url);
    if (!safe) return m; // leave literal (already escaped) rather than emit a bad tag
    return `<img src="${safe}" alt="${alt}" loading="lazy" class="md-img" />`;
  });

  // links: [text](url)
  s = s.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (m, text, url) => {
    const safe = safeUrl(url);
    if (!safe) return m;
    return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${text}</a>`;
  });

  // inline code
  s = s.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`);
  // bold then italic
  s = s.replace(/\*\*([^*]+)\*\*/g, (_m, t) => `<strong>${t}</strong>`);
  s = s.replace(/\*([^*]+)\*/g, (_m, t) => `<em>${t}</em>`);

  return s;
}

// Block-level: walk lines, group fences / lists / paragraphs.
export function renderMarkdown(src: string): string {
  if (!src) return "";
  const lines = escapeHtml(src).split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${renderInline(para.join("<br />"))}</p>`);
      para = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    // fenced code block ```
    if (/^```/.test(line.trim())) {
      flushPara();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      out.push(`<pre><code>${buf.join("\n")}</code></pre>`);
      continue;
    }

    // horizontal rule
    if (/^(---|\*\*\*)\s*$/.test(line.trim())) {
      flushPara();
      out.push("<hr />");
      i++;
      continue;
    }

    // heading # / ## / ###
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      flushPara();
      const level = h[1].length;
      out.push(`<h${level}>${renderInline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    // unordered list (consecutive "- " or "* ")
    if (/^[-*]\s+/.test(line)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        items.push(`<li>${renderInline(lines[i].replace(/^[-*]\s+/, ""))}</li>`);
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    // blank line -> paragraph break
    if (line.trim() === "") {
      flushPara();
      i++;
      continue;
    }

    para.push(line);
    i++;
  }
  flushPara();
  return out.join("\n");
}

// Plain-text preview for cards: drop image markdown entirely, keep alt/link
// text, strip the lightweight emphasis/heading markers. No HTML emitted.
export function markdownToPlainText(src: string): string {
  if (!src) return "";
  return src
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images -> nothing
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links -> text
    .replace(/`{1,3}/g, "")
    .replace(/^#{1,3}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^[-*]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}
