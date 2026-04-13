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
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  return NextResponse.json({ batch: publicBatch(batch) });
}
