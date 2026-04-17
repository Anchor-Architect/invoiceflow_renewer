"use client";

import { useMemo, useRef, useState } from "react";
import type { BatchState, BatchTokenSummary, ProcessedInvoice } from "@/types/invoice";

// ─── API helpers ────────────────────────────────────────────────────────────

type ApiError = { error: string };

const AI_CONCURRENCY = 2; // parallel Claude API calls

// Extract PDFs from ZIP client-side (avoids uploading large files to server)
const expandToPdfs = async (inputFiles: File[]): Promise<File[]> => {
  const zipFile = inputFiles.find((f) => f.name.toLowerCase().endsWith(".zip"));
  if (!zipFile) return inputFiles.filter((f) => f.name.toLowerCase().endsWith(".pdf"));

  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await zipFile.arrayBuffer());
  const pdfFiles: File[] = [];

  await Promise.all(
    Object.entries(zip.files).map(async ([name, entry]) => {
      if (!entry.dir && name.toLowerCase().endsWith(".pdf")) {
        const content = await entry.async("arraybuffer");
        const fileName = name.split("/").at(-1) ?? name;
        pdfFiles.push(new File([content], fileName, { type: "application/pdf" }));
      }
    })
  );

  if (pdfFiles.length === 0) throw new Error("ZIP does not contain any PDF files");
  return pdfFiles;
};

// Extract plain text from a PDF file in the browser using PDF.js
const extractTextFromPdf = async (file: File): Promise<string> => {
  const pdfjsLib = await import("pdfjs-dist");
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let fullText = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    fullText += pageText + "\n";
  }
  return fullText.replace(/\s+\n/g, "\n").trim();
};

// Send extracted text to server for AI analysis (tiny JSON, no file upload)
const analyzeInvoice = async (
  fileName: string,
  text: string
): Promise<ProcessedInvoice> => {
  const res = await fetch("/api/process-invoice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName, text })
  });
  const data = (await res.json()) as { result: ProcessedInvoice } | ApiError;
  if (!res.ok || !("result" in data)) {
    throw new Error("error" in data ? data.error : "Analysis failed");
  }
  return data.result;
};

// Detect duplicates client-side (same logic as server)
const detectDuplicates = (invoices: ProcessedInvoice[]): void => {
  const keyMap = new Map<string, string[]>();
  for (const inv of invoices) {
    if (!inv.duplicateKey) continue;
    const arr = keyMap.get(inv.duplicateKey) ?? [];
    arr.push(inv.fileId);
    keyMap.set(inv.duplicateKey, arr);
  }
  for (const inv of invoices) {
    if (!inv.duplicateKey) continue;
    if ((keyMap.get(inv.duplicateKey)?.length ?? 0) > 1) {
      inv.reasons.push({
        type: "Duplicate",
        reason: "The same invoice_number + seller_tax_code appears more than once in this batch",
        evidence: [`duplicate_key=${inv.duplicateKey}`]
      });
      if (inv.status !== "failed") {
        inv.status = "review-needed";
        inv.purchaseRow = null;
        inv.salesRow = null;
      }
    }
  }
};

// Aggregate token summary from processed invoices
const buildTokenSummary = (invoices: ProcessedInvoice[]): BatchTokenSummary | null => {
  const usages = invoices.filter((i) => i.tokenUsage != null).map((i) => i.tokenUsage!);
  if (usages.length === 0) return null;
  const model = usages[0].model;
  const totalInput = usages.reduce((s, t) => s + t.input, 0);
  const totalOutput = usages.reduce((s, t) => s + t.output, 0);
  const price = getPricePerM(model);
  return {
    totalInput,
    totalOutput,
    model,
    estimatedCostUsd: (totalInput * price.input + totalOutput * price.output) / 1_000_000
  };
};

// Insert valid invoices to Google Sheets
const insertToSheets = async (
  invoices: ProcessedInvoice[]
): Promise<BatchState["insertSummary"]> => {
  const res = await fetch("/api/insert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ invoices })
  });
  const data = (await res.json()) as { summary: BatchState["insertSummary"] } | ApiError;
  if (!res.ok || !("summary" in data)) {
    throw new Error("error" in data ? data.error : "Insertion failed");
  }
  return data.summary;
};

// ─── Cost helpers ────────────────────────────────────────────────────────────

const formatCost = (usd: number): string => {
  if (usd < 0.001) return `$${(usd * 1000).toFixed(3)}m`;
  return `$${usd.toFixed(4)}`;
};

const formatNumber = (n: number): string => n.toLocaleString("en-US");

const exportTokenCsv = (invoices: ProcessedInvoice[], summary: BatchTokenSummary | null) => {
  const header = "File Name,Status,Type,Input Tokens,Output Tokens,Total Tokens,Est. Cost (USD)";
  const pricePerM = getPricePerM(summary?.model ?? "");
  const rows = invoices.map((inv) => {
    const t = inv.tokenUsage;
    if (!t) return `"${inv.fileName}",${inv.status},${inv.type},0,0,0,0`;
    const cost = ((t.input * pricePerM.input + t.output * pricePerM.output) / 1_000_000).toFixed(6);
    return `"${inv.fileName}",${inv.status},${inv.type},${t.input},${t.output},${t.input + t.output},${cost}`;
  });
  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `token-report-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

const getPricePerM = (model: string): { input: number; output: number } => {
  if (model.includes("sonnet")) return { input: 3.0, output: 15.0 };
  if (model.includes("opus")) return { input: 15.0, output: 75.0 };
  return { input: 0.8, output: 4.0 }; // haiku default
};

// ─── Status / type helpers ───────────────────────────────────────────────────

const STATUS_LABEL: Record<ProcessedInvoice["status"], string> = {
  valid: "Valid",
  "review-needed": "Review Needed",
  failed: "Failed"
};

const STATUS_COLORS: Record<ProcessedInvoice["status"], string> = {
  valid: "bg-emerald-100 text-emerald-700 border-emerald-200",
  "review-needed": "bg-amber-100 text-amber-700 border-amber-200",
  failed: "bg-red-100 text-red-700 border-red-200"
};

const STATUS_DOT: Record<ProcessedInvoice["status"], string> = {
  valid: "bg-emerald-500",
  "review-needed": "bg-amber-500",
  failed: "bg-red-500"
};

const TYPE_LABEL: Record<string, string> = {
  Purchase: "Purchase",
  Sales: "Sales",
  Unknown: "Unknown"
};

const TYPE_COLORS: Record<string, string> = {
  Purchase: "bg-blue-100 text-blue-700",
  Sales: "bg-violet-100 text-violet-700",
  Unknown: "bg-slate-100 text-slate-500"
};

const STAGE_STEPS = ["File Upload", "Text Extraction", "AI Analysis", "Validation", "Ready for Insert"];

const stageIndex = (stage: string): number => {
  if (stage.includes("Uploading")) return 0;
  if (stage.includes("Extracting")) return 1;
  if (stage.includes("Analyzing")) return 2;
  if (stage.includes("Preparing") || stage.includes("Validating")) return 3;
  if (stage.includes("Ready")) return 4;
  return 0;
};

// ─── Main component ──────────────────────────────────────────────────────────

export function InvoiceApp() {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [batch, setBatch] = useState<BatchState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [uploadPhase, setUploadPhase] = useState<"extracting-zip" | "extracting-text" | "analyzing">("extracting-zip");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showTokenTable, setShowTokenTable] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [activeTab, setActiveTab] = useState<"all" | "valid" | "review" | "failed">("all");
  const [previewTab, setPreviewTab] = useState<"Purchase" | "Sales">("Purchase");

  const onDropFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    setSelectedFiles(Array.from(incoming));
    setError(null);
    setBatch(null);
  };

  const onStart = async () => {
    try {
      setBusy(true);
      setError(null);
      setUploadPct(null);

      // Step 1: extract PDFs from ZIP client-side
      setUploadPhase("extracting-zip");
      const pdfs = await expandToPdfs(selectedFiles);
      if (pdfs.length > 200) throw new Error("Maximum 200 invoice PDFs per batch");

      const batchId = `local-${Date.now().toString(36)}`;
      const now = new Date().toISOString();

      // Initialize local batch state (no server needed for processing)
      const localBatch: BatchState = {
        id: batchId,
        createdAt: now,
        files: pdfs.map((f, i) => ({ id: String(i), name: f.name })),
        processedInvoices: [],
        progress: { percentage: 0, processed: 0, total: pdfs.length, stage: "Extracting text", valid: 0, reviewNeeded: 0, failed: 0 },
        started: true,
        completed: false,
        insertSummary: null,
        tokenSummary: null
      };
      setBatch(localBatch);

      // Step 2: extract text from each PDF client-side (no upload to server!)
      setUploadPhase("extracting-text");
      const texts: { file: File; text: string }[] = [];
      for (let i = 0; i < pdfs.length; i++) {
        const text = await extractTextFromPdf(pdfs[i]);
        texts.push({ file: pdfs[i], text });
        setUploadPct(Math.round(((i + 1) / pdfs.length) * 100));
      }
      setUploadPct(null);

      // Step 3: analyze each invoice via AI (tiny JSON requests, no file upload)
      setUploadPhase("analyzing");
      const results: ProcessedInvoice[] = [];
      const queue = [...texts];
      let processed = 0;

      const workers = Array.from({ length: AI_CONCURRENCY }, async () => {
        while (queue.length > 0) {
          const next = queue.shift();
          if (!next) break;
          let result: ProcessedInvoice;
          try {
            result = await analyzeInvoice(next.file.name, next.text);
          } catch (e) {
            result = {
              fileId: `err-${Date.now()}`,
              fileName: next.file.name,
              type: "Unknown",
              status: "failed",
              extraction: null,
              validation: null,
              purchaseRow: null,
              salesRow: null,
              reasons: [{ type: "Processing failed", reason: e instanceof Error ? e.message : "Unknown error", evidence: [] }],
              rawTextSnippet: null,
              duplicateKey: undefined,
              tokenUsage: null
            };
          }
          results.push(result);
          processed++;
          // Update UI after each invoice
          setBatch((prev) => {
            if (!prev) return prev;
            const valid = results.filter((r) => r.status === "valid").length;
            const reviewNeeded = results.filter((r) => r.status === "review-needed").length;
            const failed = results.filter((r) => r.status === "failed").length;
            return {
              ...prev,
              processedInvoices: [...results],
              progress: {
                ...prev.progress,
                stage: "Analyzing invoice",
                processed,
                percentage: Math.round((processed / pdfs.length) * 100),
                valid,
                reviewNeeded,
                failed
              }
            };
          });
        }
      });
      await Promise.all(workers);

      // Step 4: detect duplicates & finalize
      detectDuplicates(results);
      const tokenSummary = buildTokenSummary(results);
      const sorted = [...results].sort((a, b) => a.fileName.localeCompare(b.fileName));

      setBatch((prev) => prev ? {
        ...prev,
        processedInvoices: sorted,
        tokenSummary,
        completed: true,
        progress: { ...prev.progress, percentage: 100, stage: "Ready for insertion", processed: pdfs.length }
      } : prev);

    } catch (e) {
      setUploadPct(null);
      setError(e instanceof Error ? e.message : "Failed to process invoices");
    } finally {
      setBusy(false);
    }
  };

  const onInsert = async () => {
    if (!batch) return;
    try {
      setBusy(true);
      setError(null);
      const summary = await insertToSheets(batch.processedInvoices);
      setBatch((prev) => prev ? { ...prev, insertSummary: summary } : prev);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to insert rows");
    } finally {
      setBusy(false);
    }
  };

  const invoices = batch?.processedInvoices ?? [];

  const filteredInvoices = useMemo(() => {
    if (activeTab === "all") return invoices;
    if (activeTab === "valid") return invoices.filter((i) => i.status === "valid");
    if (activeTab === "review") return invoices.filter((i) => i.status === "review-needed");
    return invoices.filter((i) => i.status === "failed");
  }, [invoices, activeTab]);

  const selectedInvoice = useMemo(
    () => invoices.find((i) => i.fileId === selectedId) ?? null,
    [invoices, selectedId]
  );

  const validPurchase = useMemo(
    () => invoices.filter((i) => i.status === "valid" && i.type === "Purchase"),
    [invoices]
  );
  const validSales = useMemo(
    () => invoices.filter((i) => i.status === "valid" && i.type === "Sales"),
    [invoices]
  );

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl space-y-5 px-4 py-6 md:px-8">
      {/* ── Header ── */}
      <header className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-6 py-4 shadow-sm">
        <div>
          <h1 className="text-xl font-bold text-ink">InvoiceFlow</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Automated invoice classification, validation &amp; Google Sheets export
          </p>
        </div>
        {batch?.tokenSummary && (
          <div className="hidden items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 md:flex">
            <span className="font-medium">Batch Cost</span>
            <span className="font-semibold text-ink">
              {formatCost(batch.tokenSummary.estimatedCostUsd)}
            </span>
            <span className="text-slate-400">|</span>
            <span>{formatNumber(batch.tokenSummary.totalInput + batch.tokenSummary.totalOutput)} tok</span>
          </div>
        )}
      </header>

      {/* ── Upload ── */}
      {!batch && (
        <section className="panel">
          <h2 className="section-title">Upload Files</h2>
          <div
            className={`relative rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
              dragOver ? "border-accent bg-teal-50" : "border-slate-300 bg-slate-50 hover:border-slate-400"
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); onDropFiles(e.dataTransfer.files); }}
          >
            <div className="pointer-events-none mb-3 text-3xl">📄</div>
            <p className="text-sm font-medium text-slate-700">
              Drag &amp; drop invoice PDFs or a ZIP file, or click to browse
            </p>
            <p className="mt-1 text-xs text-slate-400">Up to 200 PDFs or one ZIP archive</p>
            <input
              className="absolute inset-0 cursor-pointer opacity-0"
              type="file"
              multiple
              accept=".pdf,.zip"
              onChange={(e) => onDropFiles(e.target.files)}
            />
          </div>

          {selectedFiles.length > 0 && (
            <div className="mt-3 max-h-40 overflow-auto rounded-lg border border-slate-200 bg-white">
              <ul className="divide-y divide-slate-100 text-sm">
                {selectedFiles.map((file) => (
                  <li
                    key={`${file.name}-${file.size}`}
                    className="flex items-center justify-between px-4 py-2"
                  >
                    <span className="truncate text-slate-700">{file.name}</span>
                    <span className="ml-4 shrink-0 text-xs text-slate-400">
                      {(file.size / 1024).toFixed(0)} KB
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button
            className="mt-4 flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700 disabled:opacity-50"
            onClick={onStart}
            disabled={busy || selectedFiles.length === 0}
          >
            &#9654; Start Processing ({selectedFiles.length} file{selectedFiles.length !== 1 ? "s" : ""})
          </button>

          {/* Upload-phase loading overlay */}
          {busy && !batch && (
            <div className="mt-4 rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-700">
              {uploadPhase === "extracting-zip" ? (
                <div className="flex items-center gap-2">
                  <Spinner />
                  <span>Extracting ZIP file…</span>
                </div>
              ) : uploadPhase === "extracting-text" && uploadPct !== null ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2"><Spinner /><span>Reading PDF text…</span></div>
                    <span className="font-semibold">{uploadPct}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-teal-200">
                    <div className="h-full rounded-full bg-teal-500 transition-all duration-300" style={{ width: `${uploadPct}%` }} />
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2"><Spinner /><span>Starting AI analysis…</span></div>
              )}
            </div>
          )}
        </section>
      )}

      {/* ── Progress ── */}
      {batch && !batch.completed && (
        <section className="panel space-y-5">
          <h2 className="section-title">Processing</h2>

          {/* Big % + bar */}
          <div className="flex items-center gap-5">
            {/* Percentage ring */}
            <div className="relative flex h-20 w-20 shrink-0 items-center justify-center">
              <svg className="absolute inset-0 -rotate-90" viewBox="0 0 80 80">
                <circle cx="40" cy="40" r="34" fill="none" stroke="#e2e8f0" strokeWidth="8" />
                <circle
                  cx="40" cy="40" r="34" fill="none"
                  stroke="#0f766e" strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 34}`}
                  strokeDashoffset={`${2 * Math.PI * 34 * (1 - batch.progress.percentage / 100)}`}
                  className="transition-all duration-500"
                />
              </svg>
              <span className="text-lg font-bold text-ink">{batch.progress.percentage}%</span>
            </div>

            {/* Counts + stage */}
            <div className="flex-1 space-y-2">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-ink">{batch.progress.processed}</span>
                <span className="text-sm text-slate-400">/ {batch.progress.total} invoices</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Spinner />
                <span>{batch.progress.stage}</span>
              </div>
              {/* Bar */}
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-2 rounded-full bg-accent transition-all duration-500"
                  style={{ width: `${batch.progress.percentage}%` }}
                />
              </div>
            </div>
          </div>

          {/* Step indicators */}
          <div className="flex items-center gap-1">
            {STAGE_STEPS.map((step, i) => {
              const current = stageIndex(batch.progress.stage);
              const done = i < current;
              const active = i === current;
              return (
                <div key={step} className="flex flex-1 items-center gap-1">
                  <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                    done ? "bg-accent text-white" : active ? "bg-accent/20 text-accent ring-2 ring-accent" : "bg-slate-200 text-slate-400"
                  }`}>
                    {done ? "✓" : i + 1}
                  </div>
                  <span className={`hidden text-xs md:block ${active ? "font-semibold text-ink" : "text-slate-400"}`}>
                    {step}
                  </span>
                  {i < STAGE_STEPS.length - 1 && (
                    <div className={`h-0.5 flex-1 rounded ${done ? "bg-accent" : "bg-slate-200"}`} />
                  )}
                </div>
              );
            })}
          </div>

          {/* Live counters */}
          <div className="flex gap-4 text-sm">
            <span className="text-emerald-600">✓ Valid {batch.progress.valid}</span>
            <span className="text-amber-600">⚠ Review {batch.progress.reviewNeeded}</span>
            <span className="text-red-600">✕ Failed {batch.progress.failed}</span>
          </div>
        </section>
      )}

      {/* ── Summary cards ── */}
      {batch && batch.completed && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <SummaryCard
            label="Valid"
            value={batch.progress.valid}
            sub={`Purchase ${validPurchase.length} · Sales ${validSales.length}`}
            color="text-emerald-600"
            bg="bg-emerald-50 border-emerald-200"
            icon="✅"
          />
          <SummaryCard
            label="Review Needed"
            value={batch.progress.reviewNeeded}
            sub="Click to view details"
            color="text-amber-600"
            bg="bg-amber-50 border-amber-200"
            icon="⚠️"
          />
          <SummaryCard
            label="Failed"
            value={batch.progress.failed}
            sub="Check error details"
            color="text-red-600"
            bg="bg-red-50 border-red-200"
            icon="❌"
          />
          {batch.tokenSummary ? (
            <SummaryCard
              label="AI Processing Cost"
              value={formatCost(batch.tokenSummary.estimatedCostUsd)}
              sub={`${formatNumber(batch.tokenSummary.totalInput + batch.tokenSummary.totalOutput)} tokens`}
              color="text-slate-700"
              bg="bg-slate-50 border-slate-200"
              icon="🪙"
            />
          ) : (
            <SummaryCard
              label="Completed"
              value={batch.progress.total}
              sub="total files"
              color="text-slate-700"
              bg="bg-slate-50 border-slate-200"
              icon="📦"
            />
          )}
        </div>
      )}

      {/* ── Master-Detail ── */}
      {batch && invoices.length > 0 && (
        <section className="panel overflow-hidden p-0">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="section-title mb-2">Invoice List</h2>
            {/* Tab filter */}
            <div className="flex gap-1 text-xs">
              {(
                [
                  { key: "all", label: `All ${invoices.length}` },
                  { key: "valid", label: `Valid ${batch.progress.valid}` },
                  { key: "review", label: `Review ${batch.progress.reviewNeeded}` },
                  { key: "failed", label: `Failed ${batch.progress.failed}` }
                ] as const
              ).map(({ key, label }) => (
                <button
                  key={key}
                  onClick={() => setActiveTab(key)}
                  className={`rounded-md px-3 py-1 font-medium transition-colors ${
                    activeTab === key
                      ? "bg-accent text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex divide-x divide-slate-200" style={{ minHeight: 400 }}>
            {/* Left: list */}
            <div className="w-80 shrink-0 overflow-y-auto">
              {filteredInvoices.length === 0 ? (
                <p className="p-4 text-sm text-slate-400">No items found.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {filteredInvoices.map((inv) => (
                    <li key={inv.fileId}>
                      <button
                        className={`w-full px-4 py-3 text-left transition-colors hover:bg-slate-50 ${
                          selectedId === inv.fileId ? "border-l-2 border-accent bg-teal-50" : ""
                        }`}
                        onClick={() => setSelectedId(inv.fileId === selectedId ? null : inv.fileId)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="max-w-[150px] truncate text-xs font-medium text-slate-700" title={inv.fileName}>
                            {inv.fileName}
                          </p>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_COLORS[inv.status]}`}>
                              {STATUS_LABEL[inv.status]}
                            </span>
                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${TYPE_COLORS[inv.type]}`}>
                              {TYPE_LABEL[inv.type] ?? inv.type}
                            </span>
                          </div>
                        </div>
                        {inv.tokenUsage && (
                          <p className="mt-1 text-[10px] text-slate-400">
                            {formatNumber(inv.tokenUsage.input + inv.tokenUsage.output)} tok
                          </p>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Right: detail */}
            <div className="flex-1 overflow-y-auto p-5">
              {!selectedInvoice ? (
                <div className="flex h-full items-center justify-center">
                  <p className="text-sm text-slate-400">&#8592; Select an invoice to view details</p>
                </div>
              ) : (
                <InvoiceDetail invoice={selectedInvoice} />
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── Preview tables ── */}
      {batch && batch.completed && (validPurchase.length > 0 || validSales.length > 0) && (
        <section className="panel">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="section-title mb-0">Sheet Preview</h2>
            <div className="flex gap-1 text-xs">
              {(["Purchase", "Sales"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setPreviewTab(t)}
                  className={`rounded-md px-3 py-1 font-medium transition-colors ${
                    previewTab === t ? "bg-accent text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {t} ({t === "Purchase" ? validPurchase.length : validSales.length})
                </button>
              ))}
            </div>
          </div>
          <PreviewTable type={previewTab} invoices={previewTab === "Purchase" ? validPurchase : validSales} />
        </section>
      )}

      {/* ── Insert ── */}
      {batch && batch.completed && (
        <section className="panel">
          <h2 className="section-title">Insert to Google Sheets</h2>
          <div className="flex items-center gap-4">
            <button
              className="flex items-center gap-2 rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-50"
              disabled={busy || !batch.completed}
              onClick={onInsert}
            >
              {busy ? <><Spinner /> Inserting...</> : "📊 Insert to Sheets"}
            </button>
            {batch.insertSummary && (
              <div className="flex flex-wrap gap-3 text-sm">
                <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-700">
                  {batch.insertSummary.purchaseInserted} Purchase rows inserted
                </span>
                <span className="rounded-full bg-violet-100 px-3 py-1 text-violet-700">
                  {batch.insertSummary.salesInserted} Sales rows inserted
                </span>
                {batch.insertSummary.skippedForReview > 0 && (
                  <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-700">
                    {batch.insertSummary.skippedForReview} skipped for review
                  </span>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── Token analytics ── */}
      {batch && batch.completed && batch.tokenSummary && (
        <section className="panel">
          <button
            className="flex w-full items-center justify-between"
            onClick={() => setShowTokenTable((v) => !v)}
          >
            <h2 className="section-title mb-0">AI Token Usage</h2>
            <span className="text-xs text-slate-400">{showTokenTable ? "▲ Collapse" : "▼ Expand"}</span>
          </button>

          {showTokenTable && (
            <div className="mt-4 space-y-4">
              <TokenSummaryCards summary={batch.tokenSummary} total={invoices.length} />
              <div className="flex justify-end">
                <button
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                  onClick={() => exportTokenCsv(invoices, batch.tokenSummary)}
                >
                  📥 Export CSV
                </button>
              </div>
              <TokenTable invoices={invoices} summary={batch.tokenSummary} />
            </div>
          )}
        </section>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <span className="text-lg">⚠</span>
          <div className="flex-1">
            <p className="font-semibold">Error</p>
            <p className="mt-0.5 text-xs">{error}</p>
          </div>
        </div>
      )}
    </main>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Spinner() {
  return (
    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
  );
}

function SummaryCard({
  label, value, sub, color, bg, icon
}: {
  label: string; value: string | number; sub: string; color: string; bg: string; icon: string;
}) {
  return (
    <div className={`rounded-xl border p-4 ${bg}`}>
      <div className="flex items-center gap-2">
        <span className="text-lg">{icon}</span>
        <p className="text-xs font-medium text-slate-600">{label}</p>
      </div>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
      <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>
    </div>
  );
}

function InvoiceDetail({ invoice }: { invoice: ProcessedInvoice }) {
  const ext = invoice.extraction;
  const val = invoice.validation;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-ink">{invoice.fileName}</h3>
          <div className="mt-1 flex gap-2">
            <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${STATUS_COLORS[invoice.status]}`}>
              {STATUS_LABEL[invoice.status]}
            </span>
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${TYPE_COLORS[invoice.type]}`}>
              {TYPE_LABEL[invoice.type] ?? invoice.type}
            </span>
          </div>
        </div>
        {invoice.tokenUsage && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-right text-xs">
            <p className="font-medium text-slate-500">Tokens Used</p>
            <p className="font-bold text-slate-700">
              {formatNumber(invoice.tokenUsage.input + invoice.tokenUsage.output)}
            </p>
            <p className="text-slate-400">{invoice.tokenUsage.model.split("-").slice(1, 3).join("-")}</p>
          </div>
        )}
      </div>

      {/* Review reasons */}
      {invoice.reasons.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Review Reasons</p>
          {invoice.reasons.map((r, i) => (
            <div key={i} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs">
              <span className="rounded bg-amber-200 px-1.5 py-0.5 font-semibold text-amber-800">
                {r.type}
              </span>
              <p className="mt-1.5 text-slate-700">{r.reason}</p>
              {r.evidence.length > 0 && (
                <p className="mt-1 font-mono text-[11px] text-slate-500">
                  Evidence: {r.evidence.join(" | ")}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Extracted fields */}
      {ext && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Extracted Fields</p>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <FieldRow label="Invoice No" value={ext.invoice_no} />
            <FieldRow label="Serial (ký hiệu)" value={ext.serial} />
            <FieldRow label="Issue Date" value={val?.normalizedDate ?? ext.date} />
            <FieldRow label="Quarter" value={val?.quarter} />
            <FieldRow label="Seller Name" value={ext.seller.name} wide />
            <FieldRow label="Seller Tax Code" value={ext.seller.tax_code} />
            <FieldRow label="Buyer Name" value={ext.buyer.name} wide />
            <FieldRow label="Buyer Tax Code" value={ext.buyer.tax_code} />
          </div>
        </div>
      )}

      {/* Amounts */}
      {ext?.totals && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Amounts (VND)</p>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
            <div className="flex justify-between py-1">
              <span className="text-slate-500">Subtotal (ex. VAT)</span>
              <span className="font-medium">{ext.totals.subtotal ? Number(ext.totals.subtotal).toLocaleString("en-US") : "—"}</span>
            </div>
            <div className="flex justify-between border-t border-slate-200 py-1">
              <span className="text-slate-500">VAT ({val?.vatRate?.toFixed(0) ?? "?"}%)</span>
              <span className="font-medium">{ext.totals.vat ? Number(ext.totals.vat).toLocaleString("en-US") : "—"}</span>
            </div>
            <div className="flex justify-between border-t border-slate-200 py-1 font-semibold">
              <span>Total</span>
              <span>{ext.totals.total ? Number(ext.totals.total).toLocaleString("en-US") : "—"}</span>
            </div>
          </div>
        </div>
      )}

      {/* Token breakdown */}
      {invoice.tokenUsage && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Token Breakdown</p>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-slate-400">Input</p>
                <p className="mt-0.5 font-bold text-slate-700">{formatNumber(invoice.tokenUsage.input)}</p>
              </div>
              <div>
                <p className="text-slate-400">Output</p>
                <p className="mt-0.5 font-bold text-slate-700">{formatNumber(invoice.tokenUsage.output)}</p>
              </div>
              <div>
                <p className="text-slate-400">Total</p>
                <p className="mt-0.5 font-bold text-slate-700">{formatNumber(invoice.tokenUsage.input + invoice.tokenUsage.output)}</p>
              </div>
            </div>
            <p className="mt-2 text-center text-slate-400">Model: {invoice.tokenUsage.model}</p>
          </div>
        </div>
      )}

      {/* Raw text snippet */}
      {invoice.rawTextSnippet && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Raw PDF Text (preview)</p>
          <pre className="max-h-36 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-600">
            {invoice.rawTextSnippet}
          </pre>
        </div>
      )}
    </div>
  );
}

function FieldRow({
  label, value, wide = false
}: {
  label: string; value: string | null | undefined; wide?: boolean;
}) {
  return (
    <div className={`rounded-lg border border-slate-200 bg-white p-2 ${wide ? "col-span-2" : ""}`}>
      <p className="text-[10px] text-slate-400">{label}</p>
      <p className={`mt-0.5 font-medium ${value ? "text-slate-700" : "text-slate-300"}`}>
        {value ?? "—"}
      </p>
    </div>
  );
}

function TokenSummaryCards({ summary, total }: { summary: BatchTokenSummary; total: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="text-slate-400">Model</p>
        <p className="mt-1 break-all font-semibold text-slate-700">{summary.model}</p>
      </div>
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="text-slate-400">Total Input Tokens</p>
        <p className="mt-1 text-lg font-bold text-slate-700">{formatNumber(summary.totalInput)}</p>
      </div>
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <p className="text-slate-400">Total Output Tokens</p>
        <p className="mt-1 text-lg font-bold text-slate-700">{formatNumber(summary.totalOutput)}</p>
      </div>
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
        <p className="text-slate-400">Est. Cost (USD)</p>
        <p className="mt-1 text-lg font-bold text-emerald-700">{formatCost(summary.estimatedCostUsd)}</p>
        {total > 0 && (
          <p className="mt-0.5 text-slate-400">
            avg. {formatCost(summary.estimatedCostUsd / total)} / invoice
          </p>
        )}
      </div>
    </div>
  );
}

function TokenTable({ invoices, summary }: { invoices: ProcessedInvoice[]; summary: BatchTokenSummary }) {
  const pricePerM = getPricePerM(summary.model);
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full text-xs">
        <thead>
          <tr className="bg-slate-100 text-left text-slate-600">
            <th className="px-3 py-2 font-semibold">File Name</th>
            <th className="px-3 py-2 font-semibold">Status</th>
            <th className="px-3 py-2 font-semibold">Type</th>
            <th className="px-3 py-2 text-right font-semibold">Input tok</th>
            <th className="px-3 py-2 text-right font-semibold">Output tok</th>
            <th className="px-3 py-2 text-right font-semibold">Total tok</th>
            <th className="px-3 py-2 text-right font-semibold">Est. Cost</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {invoices.map((inv) => {
            const t = inv.tokenUsage;
            const cost = t
              ? (t.input * pricePerM.input + t.output * pricePerM.output) / 1_000_000
              : 0;
            return (
              <tr key={inv.fileId} className="hover:bg-slate-50">
                <td className="max-w-[200px] truncate px-3 py-2 text-slate-700" title={inv.fileName}>
                  {inv.fileName}
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${STATUS_COLORS[inv.status]}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[inv.status]}`} />
                    {STATUS_LABEL[inv.status]}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${TYPE_COLORS[inv.type]}`}>
                    {TYPE_LABEL[inv.type] ?? inv.type}
                  </span>
                </td>
                <td className="px-3 py-2 text-right text-slate-600">{t ? formatNumber(t.input) : "—"}</td>
                <td className="px-3 py-2 text-right text-slate-600">{t ? formatNumber(t.output) : "—"}</td>
                <td className="px-3 py-2 text-right font-medium text-slate-700">
                  {t ? formatNumber(t.input + t.output) : "—"}
                </td>
                <td className="px-3 py-2 text-right text-slate-600">{t ? formatCost(cost) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-300 bg-slate-100 font-semibold">
            <td className="px-3 py-2 text-slate-600" colSpan={3}>Total</td>
            <td className="px-3 py-2 text-right">{formatNumber(summary.totalInput)}</td>
            <td className="px-3 py-2 text-right">{formatNumber(summary.totalOutput)}</td>
            <td className="px-3 py-2 text-right">{formatNumber(summary.totalInput + summary.totalOutput)}</td>
            <td className="px-3 py-2 text-right text-emerald-700">{formatCost(summary.estimatedCostUsd)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function PreviewTable({ type, invoices }: { type: "Purchase" | "Sales"; invoices: ProcessedInvoice[] }) {
  const purchaseCols = ["Short description", "Invoice's name", "Issued Day", "Quarter", "Provider's name", "Type of services/goods", "Percentage", "Total excluded VAT", "VAT amount", "Total"];
  const salesCols = ["No", "Short description", "Invoice's name", "Issued Day", "Quarter", "Customer's name", "Type of services/goods", "Percentage", "Total excluded VAT", "VAT amount", "Total"];
  const cols = type === "Purchase" ? purchaseCols : salesCols;

  if (invoices.length === 0) {
    return <p className="py-4 text-center text-sm text-slate-400">No valid {type.toLowerCase()} invoices.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full border-collapse text-xs">
        <thead>
          <tr className="bg-slate-100 text-left">
            {cols.map((h) => (
              <th key={h} className="whitespace-nowrap border-b border-slate-200 px-3 py-2 font-semibold text-slate-600">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {invoices.map((invoice) => {
            const row = type === "Purchase" ? invoice.purchaseRow : invoice.salesRow;
            if (!row) return null;
            return (
              <tr key={invoice.fileId} className="hover:bg-slate-50">
                {Object.values(row).map((v, idx) => (
                  <td key={`${invoice.fileId}-${idx}`} className="whitespace-nowrap px-3 py-2 text-slate-700">
                    {typeof v === "number" ? v.toLocaleString("en-US") : String(v)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
