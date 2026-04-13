export const COMPANY_NAME = "CÔNG TY TNHH SAMSON PRODUCTION";
export const COMPANY_TAX_CODE = "0316350473";

export type TokenUsage = {
  input: number;
  output: number;
  model: string;
};

export type BatchTokenSummary = {
  totalInput: number;
  totalOutput: number;
  model: string;
  estimatedCostUsd: number;
};

export type InvoiceType = "Purchase" | "Sales" | "Unknown";

export type ProblemType =
  | "Duplicate"
  | "Ambiguous"
  | "Validation error"
  | "Processing failed";

export type ReviewReason = {
  type: ProblemType;
  reason: string;
  evidence: string[];
};

export type ClaudeParty = {
  name: string | null;
  tax_code: string | null;
};

export type ClaudeItem = {
  description: string | null;
  quantity: string | null;
  unit_price: string | null;
  amount: string | null;
  vat_rate: string | null;
};

export type ClaudeTotals = {
  subtotal: string | null;
  vat: string | null;
  total: string | null;
};

export type ClaudeInvoiceExtraction = {
  invoice_no: string | null;
  serial: string | null;
  date: string | null;
  seller: ClaudeParty;
  buyer: ClaudeParty;
  items: ClaudeItem[];
  totals: ClaudeTotals;
  raw_confidence_notes: string[];
  ambiguous_fields: string[];
};

export type ValidationResult = {
  normalizedDate: string | null;
  quarter: "Q1" | "Q2" | "Q3" | "Q4" | null;
  vatRate: number | null;
  goodsType: "service" | "goods";
  issues: ReviewReason[];
  warnings: Array<{
    reason: string;
    evidence: string[];
  }>;
};

export type PurchaseRow = {
  "Short description": string;
  "Invoice's name": string;
  "Issued Day": string;
  Quarter: string;
  "Provider's name": string;
  "Type of services/goods": string;
  Percentage: string;
  "Total excluded VAT": number;
  "VAT amount": number;
  Total: number;
};

export type SalesRow = {
  No: string;
  "Short description": string;
  "Invoice's name": string;
  "Issued Day": string;
  Quarter: string;
  "Customer's name": string;
  "Type of services/goods": string;
  Percentage: string;
  "Total excluded VAT": number;
  "VAT amount": number;
  Total: number;
};

export type ProcessedInvoice = {
  fileId: string;
  fileName: string;
  type: InvoiceType;
  status: "valid" | "review-needed" | "failed";
  extraction: ClaudeInvoiceExtraction | null;
  validation: ValidationResult | null;
  purchaseRow: PurchaseRow | null;
  salesRow: SalesRow | null;
  reasons: ReviewReason[];
  rawTextSnippet: string | null;
  duplicateKey?: string;
  tokenUsage: TokenUsage | null;
  pipelineTrace?: unknown;
};

export type BatchProgress = {
  percentage: number;
  processed: number;
  total: number;
  stage:
    | "Uploading files"
    | "Extracting text"
    | "Analyzing invoice"
    | "Validating results"
    | "Preparing rows"
    | "Ready for insertion";
  valid: number;
  reviewNeeded: number;
  failed: number;
};

export type InsertSummary = {
  purchaseInserted: number;
  salesInserted: number;
  skippedForReview: number;
  failed: number;
};

export type BatchState = {
  id: string;
  createdAt: string;
  files: { id: string; name: string }[];
  processedInvoices: ProcessedInvoice[];
  progress: BatchProgress;
  started: boolean;
  completed: boolean;
  insertSummary: InsertSummary | null;
  tokenSummary: BatchTokenSummary | null;
};
