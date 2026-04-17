import type { BatchState, ProcessedInvoice } from "@/types/invoice";
import type { UploadedPdf } from "@/lib/pdf/zip";
import fs from "node:fs";
import path from "node:path";

type InternalBatchState = BatchState & {
  sourceFiles: { id: string; name: string; filePath: string }[];
};

// On Render: mount a Persistent Disk at /data and set BATCH_DATA_DIR=/data/batches
// This survives instance restarts; without it, state is lost if the instance recycles.
const DATA_DIR = process.env.BATCH_DATA_DIR || path.join(process.cwd(), ".data", "batches");

const ensureDataDir = () => {
  fs.mkdirSync(DATA_DIR, { recursive: true });
};

const batchDir = (batchId: string) => path.join(DATA_DIR, batchId);
const batchStatePath = (batchId: string) => path.join(batchDir(batchId), "state.json");

const writeState = (state: InternalBatchState) => {
  ensureDataDir();
  fs.mkdirSync(batchDir(state.id), { recursive: true });
  fs.writeFileSync(batchStatePath(state.id), JSON.stringify(state, null, 2), "utf8");
};

const createId = () =>
  `batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const createBatch = async (files: UploadedPdf[]): Promise<InternalBatchState> => {
  const id = createId();
  ensureDataDir();
  fs.mkdirSync(batchDir(id), { recursive: true });

  // Write all PDF files to disk in parallel (much faster than sequential sync writes)
  const sourceFiles = await Promise.all(
    files.map(async (f) => {
      const safeName = path.basename(f.name).replace(/[^a-zA-Z0-9._-]/g, "_");
      const filePath = path.join(batchDir(id), `${f.id}-${safeName}`);
      await fs.promises.writeFile(filePath, f.buffer);
      return { id: f.id, name: f.name, filePath };
    })
  );

  const state: InternalBatchState = {
    id,
    createdAt: new Date().toISOString(),
    files: files.map((f) => ({ id: f.id, name: f.name })),
    sourceFiles,
    processedInvoices: [],
    progress: {
      percentage: 0,
      processed: 0,
      total: files.length,
      stage: "Uploading files",
      valid: 0,
      reviewNeeded: 0,
      failed: 0
    },
    started: false,
    completed: false,
    insertSummary: null,
    tokenSummary: null
  };
  writeState(state);
  return state;
};

export const getBatch = (batchId: string): InternalBatchState | null => {
  const statePath = batchStatePath(batchId);
  if (!fs.existsSync(statePath)) return null;
  const raw = fs.readFileSync(statePath, "utf8");
  return JSON.parse(raw) as InternalBatchState;
};

export const updateBatch = (
  batchId: string,
  updater: (current: InternalBatchState) => void
): InternalBatchState => {
  const current = getBatch(batchId);
  if (!current) throw new Error("Batch not found");
  updater(current);
  writeState(current);
  return current;
};

export const publicBatch = (state: InternalBatchState): BatchState => ({
  id: state.id,
  createdAt: state.createdAt,
  files: state.files,
  processedInvoices: state.processedInvoices,
  progress: state.progress,
  started: state.started,
  completed: state.completed,
  insertSummary: state.insertSummary,
  tokenSummary: state.tokenSummary ?? null
});

export const setProcessedInvoices = (batchId: string, invoices: ProcessedInvoice[]) => {
  updateBatch(batchId, (batch) => {
    batch.processedInvoices = invoices;
    const valid = invoices.filter((x) => x.status === "valid").length;
    const reviewNeeded = invoices.filter((x) => x.status === "review-needed").length;
    const failed = invoices.filter((x) => x.status === "failed").length;
    batch.progress.valid = valid;
    batch.progress.reviewNeeded = reviewNeeded;
    batch.progress.failed = failed;
  });
};
