// Client-side image downscale + re-encode, run BEFORE upload. Goal: shrink big
// photos/screenshots so they fit under the server's 10MB ceiling and don't
// bloat storage — we shrink rather than reject. Uses canvas; runs in the
// browser only.

const MAX_DIM = 2000; // longest edge after downscale
const TARGET_BYTES = 2 * 1024 * 1024; // aim under ~2MB
const HARD_MAX = 10 * 1024 * 1024; // must end up under this

// Types we re-encode. SVG and GIF are passed through untouched (vector /
// animation would be destroyed by canvas re-encoding).
const RASTER = new Set(["image/png", "image/jpeg", "image/webp", "image/avif"]);

export interface CompressResult {
  file: File;
  changed: boolean;
}

export async function compressImage(file: File): Promise<CompressResult> {
  if (!RASTER.has(file.type)) {
    // can't safely re-encode; caller still size-checks against HARD_MAX
    return { file, changed: false };
  }
  if (file.size <= TARGET_BYTES) return { file, changed: false };

  const bitmap = await loadBitmap(file);
  const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { file, changed: false };
  ctx.drawImage(bitmap, 0, 0, w, h);
  if ("close" in bitmap) (bitmap as ImageBitmap).close?.();

  // Step quality down until under target (or floor reached).
  for (const q of [0.85, 0.7, 0.55, 0.4]) {
    const blob = await toBlob(canvas, "image/webp", q);
    if (blob && (blob.size <= TARGET_BYTES || q === 0.4)) {
      const out = new File([blob], renameExt(file.name, "webp"), {
        type: "image/webp",
      });
      // Only use the re-encoded version if it actually helped.
      return out.size < file.size ? { file: out, changed: true } : { file, changed: false };
    }
  }
  return { file, changed: false };
}

export function exceedsHardMax(file: File): boolean {
  return file.size > HARD_MAX;
}

function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file);
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function toBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function renameExt(name: string, ext: string): string {
  const base = name.replace(/\.[^.]+$/, "");
  return `${base || "image"}.${ext}`;
}
