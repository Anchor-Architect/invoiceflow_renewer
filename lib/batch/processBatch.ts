import { workerPool } from "@/lib/queue/workerPool";
import { getBatch, getBatchDir, setProcessedInvoices, updateBatch } from "@/lib/storage/batchStore";
import { extractPdfText } from "@/lib/pdf/extract";
import { toPurchaseRow, toSalesRow } from "@/lib/transform/rows";
import type { BatchTokenSummary, ProcessedInvoice, ReviewReason, TokenUsage } from "@/types/invoice";
import { processInvoicePipeline } from "@/lib/pipeline";
import fs from "node:fs/promises";

// Pricing per 1M tokens (USD) — update when Anthropic changes rates
const PRICE_PER_M: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4.0 },
  "claude-haiku-4-5": { input: 0.8, output: 4.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-opus-4-6": { input: 15.0, output: 75.0 }
};

const estimateCost = (input: number, output: number, model: string): number => {
  const price = PRICE_PER_M[model] ?? { input: 0.8, output: 4.0 };
  return (input * price.input + output * price.output) / 1_000_000;
};

const addReason = (reasons: ReviewReason[], reason: ReviewReason) => {
  const key = `${reason.type}|${reason.reason}|${reason.evidence.join("|")}`;
  if (!reasons.some((r) => `${r.type}|${r.reason}|${r.evidence.join("|")}` === key)) {
    reasons.push(reason);
  }
};

const detectDuplicates = (invoices: ProcessedInvoice[]) => {
  const duplicateKeyMap = new Map<string, string[]>();
  for (const invoice of invoices) {
    if (!invoice.duplicateKey) continue;
    const arr = duplicateKeyMap.get(invoice.duplicateKey) ?? [];
    arr.push(invoice.fileId);
    duplicateKeyMap.set(invoice.duplicateKey, arr);
  }
  for (const invoice of invoices) {
    if (!invoice.duplicateKey) continue;
    if ((duplicateKeyMap.get(invoice.duplicateKey)?.length ?? 0) > 1) {
      addReason(invoice.reasons, {
        type: "Duplicate",
        reason: "The same invoice_number + seller_tax_code appears more than once in this batch",
        evidence: [`duplicate_key=${invoice.duplicateKey}`]
      });
      if (invoice.status !== "failed") {
        invoice.status = "review-needed";
        invoice.purchaseRow = null;
        invoice.salesRow = null;
      }
    }
  }
};

export const processBatch = async (batchId: string): Promise<void> => {
  const batch = getBatch(batchId);
  if (!batch) throw new Error("Batch not found");

  const concurrency = Math.max(1, Number(process.env.INVOICE_CONCURRENCY || 2));

  // Resume support: load any results already saved from a previous interrupted run
  const results: ProcessedInvoice[] = [...(batch.processedInvoices ?? [])];
  const allTokenUsages: TokenUsage[] = results
    .filter((r) => r.tokenUsage != null)
    .map((r) => r.tokenUsage as TokenUsage);

  const processedFileIds = new Set(results.map((r) => r.fileId));
  const remainingFiles = batch.sourceFiles.filter((f) => !processedFileIds.has(f.id));

  // If everything was already processed (e.g. re-trigger after completion), bail out
  if (remainingFiles.length === 0) {
    updateBatch(batchId, (b) => {
      b.progress.percentage = 100;
      b.progress.stage = "Ready for insertion";
      b.completed = true;
    });
    return;
  }

  updateBatch(batchId, (b) => {
    b.started = true;
    b.completed = false;
    b.progress.stage = "Extracting text";
    // Keep processed count from previous run so progress bar doesn't reset
    b.progress.processed = results.length;
    b.progress.percentage = Math.round((results.length / b.progress.total) * 100);
  });

  await workerPool(remainingFiles, concurrency, async (file) => {
    let local: ProcessedInvoice;

    try {
      updateBatch(batchId, (b) => { b.progress.stage = "Extracting text"; });
      const buffer = await fs.readFile(file.filePath);
      const text = await extractPdfText(buffer);

      updateBatch(batchId, (b) => { b.progress.stage = "Analyzing invoice"; });
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
        updateBatch(batchId, (b) => { b.progress.stage = "Preparing rows"; });
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

      local = {
        fileId: file.id,
        fileName: file.name,
        type: pipeline.invoiceType,
        status,
        extraction: pipeline.extraction,
        validation: pipeline.validation,
        purchaseRow,
        salesRow,
        reasons,
        rawTextSnippet: text.slice(0, 500),
        duplicateKey: pipeline.duplicateKey,
        tokenUsage: pipeline.tokenUsage,
        pipelineTrace: pipeline.trace
      };

      allTokenUsages.push(pipeline.tokenUsage);
    } catch (error) {
      local = {
        fileId: file.id,
        fileName: file.name,
        type: "Unknown",
        status: "failed",
        extraction: null,
        validation: null,
        purchaseRow: null,
        salesRow: null,
        reasons: [
          {
            type: "Processing failed",
            reason: "An error occurred while processing this invoice",
            evidence: [error instanceof Error ? error.message : "unknown error"]
          }
        ],
        rawTextSnippet: null,
        tokenUsage: null
      };
    }

    results.push(local);

    // Save result immediately after each invoice — survives instance restart
    updateBatch(batchId, (b) => {
      b.processedInvoices = results.map((r) => ({ ...r, pipelineTrace: undefined }));
      b.progress.processed = results.length;
      b.progress.percentage = Math.round((results.length / b.progress.total) * 100);
      b.progress.valid = results.filter((r) => r.status === "valid").length;
      b.progress.reviewNeeded = results.filter((r) => r.status === "review-needed").length;
      b.progress.failed = results.filter((r) => r.status === "failed").length;
    });
  });

  detectDuplicates(results);

  // Aggregate token summary across all invoices (including resumed ones)
  if (allTokenUsages.length > 0) {
    const model = allTokenUsages[0].model;
    const totalInput = allTokenUsages.reduce((s, t) => s + t.input, 0);
    const totalOutput = allTokenUsages.reduce((s, t) => s + t.output, 0);
    const tokenSummary: BatchTokenSummary = {
      totalInput,
      totalOutput,
      model,
      estimatedCostUsd: estimateCost(totalInput, totalOutput, model)
    };
    updateBatch(batchId, (b) => { b.tokenSummary = tokenSummary; });
  }

  // Persist trace for audit — use DATA_DIR-aware path
  const traceDir = getBatchDir(batchId);
  await fs.mkdir(traceDir, { recursive: true });
  await fs.writeFile(
    `${traceDir}/trace.jsonl`,
    results
      .map((r) =>
        JSON.stringify({
          fileId: r.fileId,
          fileName: r.fileName,
          status: r.status,
          reasons: r.reasons,
          duplicateKey: r.duplicateKey,
          tokenUsage: r.tokenUsage,
          trace: r.pipelineTrace ?? null
        })
      )
      .join("\n"),
    "utf8"
  );

  setProcessedInvoices(
    batchId,
    results
      .map((r) => ({ ...r, pipelineTrace: undefined }))
      .sort((a, b) => a.fileName.localeCompare(b.fileName))
  );

  updateBatch(batchId, (b) => {
    b.progress.processed = b.progress.total;
    b.progress.percentage = 100;
    b.progress.stage = "Ready for insertion";
    b.completed = true;
  });
};
