import type { InvoiceType } from "@/types/invoice";

export const OUR_COMPANY_MST = "0316350473";

export type ImportantFieldKey =
  | "invoice_number"
  | "invoice_date"
  | "buyer_name"
  | "buyer_tax_code"
  | "seller_name"
  | "seller_tax_code"
  | "subtotal"
  | "vat_amount"
  | "total_amount"
  | "currency"
  | "invoice_type";

export type ExtractionCandidate = {
  value: string | null;
  confidence: number;
  raw_text_span: string | null;
  reason: string | null;
};

export type ExtractedField = {
  value: string | null;
  confidence: number;
  raw_text_span: string | null;
  reason: string | null;
  ambiguous: boolean;
  candidates: ExtractionCandidate[];
};

export type LlmInvoiceExtraction = {
  invoice_number: ExtractedField;
  invoice_serial: ExtractedField;
  invoice_date: ExtractedField;
  buyer_name: ExtractedField;
  buyer_tax_code: ExtractedField;
  seller_name: ExtractedField;
  seller_tax_code: ExtractedField;
  subtotal: ExtractedField;
  vat_amount: ExtractedField;
  total_amount: ExtractedField;
  currency: ExtractedField;
  invoice_type: ExtractedField;
  raw_confidence_notes: string[];
  ambiguous_fields: string[];
};

export type NormalizedInvoiceData = {
  invoice_number: string | null;
  invoice_serial: string | null;
  invoice_date: string | null;
  buyer_name: string | null;
  buyer_tax_code: string | null;
  seller_name: string | null;
  seller_tax_code: string | null;
  subtotal: number | null;
  vat_amount: number | null;
  total_amount: number | null;
  currency: string | null;
  invoice_type: string | null;
  quarter: "Q1" | "Q2" | "Q3" | "Q4" | null;
};

export type ValidationSeverity = "error" | "warning";

export type ValidationIssue = {
  code: string;
  stage: "normalization" | "validation" | "classification" | "ambiguity";
  severity: ValidationSeverity;
  message: string;
  field?: ImportantFieldKey | string;
  evidence?: string[];
};

export type AmbiguityResolutionRecord = {
  field: ImportantFieldKey;
  selected: string | null;
  selectedScore: number;
  considered: Array<{ value: string | null; score: number; reason: string }>;
  unresolved: boolean;
};

export type AmbiguityResolutionOutput = {
  resolved: Partial<Record<ImportantFieldKey, string | null>>;
  records: AmbiguityResolutionRecord[];
  remainingAmbiguous: ImportantFieldKey[];
};

export type ClassificationResult = {
  invoiceType: InvoiceType;
  reason: string;
};

export type DecisionStatus = "auto_approve" | "review_needed" | "reject";

export type FinalDecision = {
  status: DecisionStatus;
  reason: string;
};

export type InvoicePipelineTrace = {
  extracted: LlmInvoiceExtraction;
  normalized: NormalizedInvoiceData;
  validationIssues: ValidationIssue[];
  ambiguity: AmbiguityResolutionOutput;
  classification: ClassificationResult;
  decision: FinalDecision;
  duplicateKey: string;
};
