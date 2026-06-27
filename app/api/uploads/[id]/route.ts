import { NextRequest, NextResponse } from "next/server";
import { errorResponse, notFound } from "@/lib/api-errors";
import { getUpload, readUploadBytes } from "@/lib/uploads";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// GET streams the stored image with its content-type. Immutable cache: ids are
// content-addressed-ish (random, never reused), so the bytes never change.
export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const row = getUpload(id);
    if (!row) throw notFound("upload");
    const bytes = readUploadBytes(row);
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "content-type": row.mime,
        "content-length": String(bytes.length),
        "cache-control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
