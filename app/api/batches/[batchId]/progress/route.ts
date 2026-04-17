import { NextResponse } from "next/server";
import { getBatch, publicBatch } from "@/lib/storage/batchStore";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ batchId: string }> }
) {
  const { batchId } = await context.params;
  const batch = getBatch(batchId);
  if (!batch) {
    // The server may have restarted and lost ephemeral state.
    // Return a clear message so the client can surface a useful error instead of polling forever.
    return NextResponse.json(
      { error: "Batch not found. The server may have restarted — please re-upload your files." },
      { status: 404 }
    );
  }

  return NextResponse.json({ batch: publicBatch(batch) });
}
