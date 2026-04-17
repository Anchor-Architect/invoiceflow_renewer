import { NextResponse } from "next/server";
import { getBatch, publicBatch } from "@/lib/storage/batchStore";
import { processBatch } from "@/lib/batch/processBatch";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: { params: Promise<{ batchId: string }> }
) {
  const { batchId } = await context.params;
  const batch = getBatch(batchId);
  if (!batch) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  // Allow re-triggering if batch was interrupted (started but not completed)
  if (!batch.started || (batch.started && !batch.completed)) {
    void processBatch(batchId).catch((err) => {
      console.error("Batch processing failed", err);
    });
  }

  return NextResponse.json({ batch: publicBatch(batch) });
}
