import { NextResponse } from "next/server";
import { initBatch, publicBatch } from "@/lib/storage/batchStore";

export const runtime = "nodejs";

// Creates an empty batch with a known total file count.
// Client calls this once, then uploads files in chunks via /api/batches/[id]/files.
export async function POST(request: Request) {
  try {
    const { total } = (await request.json()) as { total: number };
    if (!total || total < 1 || total > 200) {
      return NextResponse.json({ error: "total must be between 1 and 200" }, { status: 400 });
    }
    const batch = initBatch(total);
    return NextResponse.json({ batch: publicBatch(batch) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to init batch" },
      { status: 400 }
    );
  }
}
