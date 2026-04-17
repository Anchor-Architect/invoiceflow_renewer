import { NextResponse } from "next/server";
import { getBatchDir } from "@/lib/storage/batchStore";
import { getBatch } from "@/lib/storage/batchStore";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const maxDuration = 15;

// Accepts a single PDF file, writes it to the batch directory.
// Returns the fileId + fileName so the client can include it in /finalize.
// No state.json update here — avoids race conditions on parallel uploads.
export async function POST(
  request: Request,
  context: { params: Promise<{ batchId: string }> }
) {
  try {
    const { batchId } = await context.params;

    const batch = getBatch(batchId);
    if (!batch) {
      return NextResponse.json({ error: "Batch not found" }, { status: 404 });
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json({ error: "Only PDF files are accepted" }, { status: 400 });
    }

    const fileId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    const safeName = path.basename(file.name).replace(/[^a-zA-Z0-9._-]/g, "_");
    const filePath = path.join(getBatchDir(batchId), `${fileId}-${safeName}`);

    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(filePath, buffer);

    return NextResponse.json({ fileId, fileName: file.name, filePath });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to upload file" },
      { status: 500 }
    );
  }
}
