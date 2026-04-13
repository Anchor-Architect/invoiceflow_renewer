import { NextResponse } from "next/server";
import { createBatch, publicBatch } from "@/lib/storage/batchStore";
import { ingestUploadedFiles } from "@/lib/pdf/ingest";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const files = form.getAll("files").filter((f): f is File => f instanceof File);

    const uploadedPdfs = await ingestUploadedFiles(files);
    const batch = createBatch(uploadedPdfs);

    return NextResponse.json({ batch: publicBatch(batch) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create batch" },
      { status: 400 }
    );
  }
}
