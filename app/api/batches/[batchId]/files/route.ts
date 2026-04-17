import { NextResponse } from "next/server";
import { addFilesToBatch, publicBatch } from "@/lib/storage/batchStore";
import { ingestUploadedFiles } from "@/lib/pdf/ingest";

export const runtime = "nodejs";
export const maxDuration = 30; // each chunk is small, 30s is plenty

// Adds a chunk of files to an existing batch.
// Called multiple times by the client during chunked upload.
export async function POST(
  request: Request,
  context: { params: Promise<{ batchId: string }> }
) {
  try {
    const { batchId } = await context.params;
    const form = await request.formData();
    const files = form.getAll("files").filter((f): f is File => f instanceof File);

    if (files.length === 0) {
      return NextResponse.json({ error: "No files in chunk" }, { status: 400 });
    }

    const uploadedPdfs = await ingestUploadedFiles(files);
    const batch = await addFilesToBatch(batchId, uploadedPdfs);

    return NextResponse.json({ batch: publicBatch(batch) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to add files" },
      { status: 400 }
    );
  }
}
