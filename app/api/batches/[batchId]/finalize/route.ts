import { NextResponse } from "next/server";
import { getBatch, publicBatch, updateBatch } from "@/lib/storage/batchStore";

export const runtime = "nodejs";

type FileEntry = { fileId: string; fileName: string; filePath: string };

// After all individual file uploads complete, client calls this to commit
// the full file list into state.json so processing can begin.
export async function POST(
  request: Request,
  context: { params: Promise<{ batchId: string }> }
) {
  try {
    const { batchId } = await context.params;
    const { files } = (await request.json()) as { files: FileEntry[] };

    if (!Array.isArray(files) || files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    const batch = updateBatch(batchId, (b) => {
      b.files = files.map((f) => ({ id: f.fileId, name: f.fileName }));
      b.sourceFiles = files.map((f) => ({
        id: f.fileId,
        name: f.fileName,
        filePath: f.filePath
      }));
      b.progress.total = files.length;
    });

    return NextResponse.json({ batch: publicBatch(batch) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to finalize batch" },
      { status: 500 }
    );
  }
}
