import { NextResponse } from "next/server";
import { processInvoicePipeline } from "@/lib/pipeline";
import { toPurchaseRow, toSalesRow } from "@/lib/transform/rows";
import type { ProcessedInvoice, ReviewReason } from "@/types/invoice";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const { fileName, text, invoiceType } = (await request.json()) as {
      fileName: string;
      text: string;
      invoiceType?: "Purchase" | "Sales";
    };

    if (!fileName || !text) {
      return NextResponse.json({ error: "fileName and text are required" }, { status: 400 });
    }
    if (invoiceType !== "Purchase" && invoiceType !== "Sales") {
      return NextResponse.json({ error: "invoiceType must be Purchase or Sales" }, { status: 400 });
    }

    const pipeline = await processInvoicePipeline(text);
    const reasons: ReviewReason[] = [...pipeline.reasons];

    let status: ProcessedInvoice["status"] =
      pipeline.decisionStatus === "auto_approve"
        ? "valid"
        : pipeline.decisionStatus === "reject"
          ? "failed"
          : "review-needed";

    let purchaseRow = null;
    let salesRow = null;

    const effectiveInvoiceType = invoiceType;

    if (status === "valid") {
      if (effectiveInvoiceType === "Purchase") {
        purchaseRow = toPurchaseRow(pipeline.extraction, pipeline.validation);
      } else if (effectiveInvoiceType === "Sales") {
        salesRow = toSalesRow(pipeline.extraction, pipeline.validation);
      }
    }

    const result: ProcessedInvoice = {
      fileId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      fileName,
      type: effectiveInvoiceType,
      status,
      extraction: pipeline.extraction,
      validation: pipeline.validation,
      purchaseRow,
      salesRow,
      reasons,
      rawTextSnippet: text.slice(0, 500),
      duplicateKey: pipeline.duplicateKey,
      tokenUsage: pipeline.tokenUsage
    };

    return NextResponse.json({ result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Processing failed" },
      { status: 500 }
    );
  }
}
