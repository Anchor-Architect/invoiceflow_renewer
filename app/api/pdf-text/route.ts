import { NextResponse } from "next/server";
import { extractPdfText } from "@/lib/pdf/extract";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const text = await extractPdfText(buffer);
    return NextResponse.json({ text });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to extract PDF text" },
      { status: 500 }
    );
  }
}
