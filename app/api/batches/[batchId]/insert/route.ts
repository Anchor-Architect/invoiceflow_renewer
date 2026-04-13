import { NextResponse } from "next/server";
import { getBatch, publicBatch, updateBatch } from "@/lib/storage/batchStore";
import { insertValidInvoices } from "@/lib/google-sheets/insert";

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

  if (!batch.completed) {
    return NextResponse.json({ error: "Batch is not ready for insertion" }, { status: 400 });
  }

  try {
    const summary = await insertValidInvoices(batch.processedInvoices);
    const updated = updateBatch(batchId, (b) => {
      b.insertSummary = summary;
    });

    return NextResponse.json({ summary, batch: publicBatch(updated) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Insertion failed" },
      { status: 500 }
    );
  }
}
