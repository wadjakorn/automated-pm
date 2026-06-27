import { NextRequest } from "next/server";
import { handle, badRequest } from "@/lib/api-errors";
import { currentUser } from "@/lib/auth";
import { extForMime, saveUpload, MAX_UPLOAD_BYTES } from "@/lib/uploads";

export const dynamic = "force-dynamic";

// POST multipart/form-data with a single `file` field. Stores the image on disk
// and returns { id, url, mime, size }. Anonymous allowed (attribution-only).
// Compression happens client-side; this is the hard size/type gate.
export function POST(req: NextRequest) {
  return handle(async () => {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw badRequest("multipart field `file` is required");

    const mime = file.type;
    if (!extForMime(mime))
      throw badRequest(`unsupported image type: ${mime || "unknown"}`);
    if (file.size > MAX_UPLOAD_BYTES)
      throw badRequest(
        `image is ${(file.size / 1024 / 1024).toFixed(1)}MB; max is ${MAX_UPLOAD_BYTES / 1024 / 1024}MB after compression`
      );

    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.length === 0) throw badRequest("empty file");

    const me = currentUser(req);
    const row = saveUpload(bytes, mime, file.name || null, me?.id ?? null);
    return { id: row.id, url: `/api/uploads/${row.id}`, mime: row.mime, size: row.size };
  });
}
