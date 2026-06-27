// Copy text to the clipboard, working in BOTH secure and insecure contexts.
//
// `navigator.clipboard` only exists in a secure context (HTTPS or localhost).
// Over plain HTTP on a non-localhost host (e.g. http://dietpi:3000) it is
// `undefined`, so we fall back to a hidden <textarea> + document.execCommand
// ("copy"), which still works there. Returns true if any path succeeded.

export interface CopyDeps {
  // Async Clipboard API writer; omitted when the API is unavailable.
  clipboardWrite?: (text: string) => Promise<void>;
  // Legacy execCommand-based copy; omitted when there is no DOM.
  legacyCopy?: (text: string) => boolean;
}

export async function copyText(
  text: string,
  deps: CopyDeps = browserCopyDeps()
): Promise<boolean> {
  if (deps.clipboardWrite) {
    try {
      await deps.clipboardWrite(text);
      return true;
    } catch {
      // Secure-context API present but rejected (e.g. permission/focus) —
      // fall through to the legacy path.
    }
  }
  if (deps.legacyCopy) {
    try {
      return deps.legacyCopy(text);
    } catch {
      return false;
    }
  }
  return false;
}

// Resolve the real browser mechanisms at call time. Guards so it is safe to
// import in non-DOM environments (SSR, tests).
function browserCopyDeps(): CopyDeps {
  const hasClipboard =
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard?.writeText === "function";
  const hasDocument = typeof document !== "undefined";
  return {
    clipboardWrite: hasClipboard
      ? (text) => navigator.clipboard.writeText(text)
      : undefined,
    legacyCopy: hasDocument ? execCommandCopy : undefined,
  };
}

function execCommandCopy(text: string): boolean {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "-9999px";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(ta);
  }
}
