import { NextResponse } from "next/server";
import { processInvoicePipeline } from "@/lib/pipeline";
import { toPurchaseRow, toSalesRow } from "@/lib/transform/rows";
import type { ProcessedInvoice, ReviewReason } from "@/types/invoice";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const { fileName, text } = (await request.json()) as {
      fileName: string;
      text: string;
    };

    if (!fileName || !text) {
      return NextResponse.json({ error: "fileName and text are required" }, { status: 400 });
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

    if (status === "valid") {
      if (pipeline.invoiceType === "Purchase") {
        purchaseRow = toPurchaseRow(pipeline.extraction, pipeline.validation);
      } else if (pipeline.invoiceType === "Sales") {
        salesRow = toSalesRow(pipeline.extraction, pipeline.validation);
      } else {
        status = "review-needed";
        reasons.push({
          type: "Ambiguous",
          reason: "Invoice type (Purchase/Sales) could not be determined",
          evidence: []
        });
      }
    }

    const result: ProcessedInvoice = {
      fileId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      fileName,
      type: pipeline.invoiceType,
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
