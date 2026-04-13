import type {
  ClaudeInvoiceExtraction,
  InvoiceType,
  ProcessedInvoice,
  ReviewReason,
  TokenUsage,
  ValidationResult
} from "@/types/invoice";
import type { InvoicePipelineTrace, ValidationIssue } from "@/types/pipeline";
import { extractInvoiceStructured } from "@/lib/pipeline/extractor";
import { normalizeExtraction } from "@/lib/pipeline/normalizer";
import { resolveAmbiguities } from "@/lib/pipeline/ambiguityResolver";
import { classifyInvoiceByMstRule } from "@/lib/pipeline/classifier";
import { buildDuplicateKey, validateNormalizedInvoice } from "@/lib/pipeline/validator";
import { decideInvoiceStatus } from "@/lib/pipeline/decisionEngine";

const toReviewReason = (issue: ValidationIssue): ReviewReason => ({
  type: issue.stage === "validation" ? "Validation error" : "Ambiguous",
  reason: issue.message,
  evidence: issue.evidence ?? (issue.field ? [issue.field] : [])
});

const toLegacyExtraction = (
  normalized: ReturnType<typeof normalizeExtraction>,
  extracted: Awaited<ReturnType<typeof extractInvoiceStructured>>["extraction"]
): ClaudeInvoiceExtraction => ({
  invoice_no: normalized.invoice_number,
  serial: normalized.invoice_serial,
  date: normalized.invoice_date,
  seller: {
    name: normalized.seller_name,
    tax_code: normalized.seller_tax_code
  },
  buyer: {
    name: normalized.buyer_name,
    tax_code: normalized.buyer_tax_code
  },
  items: [],
  totals: {
    subtotal: normalized.subtotal !== null ? String(normalized.subtotal) : null,
    vat: normalized.vat_amount !== null ? String(normalized.vat_amount) : null,
    total: normalized.total_amount !== null ? String(normalized.total_amount) : null
  },
  raw_confidence_notes: extracted.raw_confidence_notes,
  ambiguous_fields: extracted.ambiguous_fields
});

const toLegacyValidation = (
  normalized: ReturnType<typeof normalizeExtraction>,
  issues: ValidationIssue[]
): ValidationResult => ({
  normalizedDate: normalized.invoice_date,
  quarter: normalized.quarter,
  vatRate:
    normalized.subtotal && normalized.subtotal > 0 && normalized.vat_amount !== null
      ? (normalized.vat_amount / normalized.subtotal) * 100
      : null,
  goodsType: "goods",
  issues: issues.filter((i) => i.severity === "error").map(toReviewReason),
  warnings: issues.filter((i) => i.severity === "warning").map((w) => ({
    reason: w.message,
    evidence: w.evidence ?? []
  }))
});

export const processInvoicePipeline = async (invoiceText: string): Promise<{
  extraction: ClaudeInvoiceExtraction;
  validation: ValidationResult;
  invoiceType: InvoiceType;
  reasons: ReviewReason[];
  decisionStatus: "auto_approve" | "review_needed" | "reject";
  duplicateKey: string;
  tokenUsage: TokenUsage;
  trace: InvoicePipelineTrace;
}> => {
  const { extraction: extracted, tokenUsage } = await extractInvoiceStructured(invoiceText);
  const ambiguity = resolveAmbiguities(extracted, invoiceText);

  if (ambiguity.resolved.buyer_name) extracted.buyer_name.value = ambiguity.resolved.buyer_name;
  if (ambiguity.resolved.buyer_tax_code) extracted.buyer_tax_code.value = ambiguity.resolved.buyer_tax_code;
  if (ambiguity.resolved.seller_name) extracted.seller_name.value = ambiguity.resolved.seller_name;
  if (ambiguity.resolved.seller_tax_code) extracted.seller_tax_code.value = ambiguity.resolved.seller_tax_code;

  const normalized = normalizeExtraction(extracted);
  const classification = classifyInvoiceByMstRule(normalized);
  const validationIssues = validateNormalizedInvoice(extracted, normalized, classification, false);
  const decision = decideInvoiceStatus(validationIssues);
  const duplicateKey = buildDuplicateKey(normalized);

  const legacyExtraction = toLegacyExtraction(normalized, extracted);
  const legacyValidation = toLegacyValidation(normalized, validationIssues);
  const reasons = validationIssues.filter((i) => i.severity === "error").map(toReviewReason);

  return {
    extraction: legacyExtraction,
    validation: legacyValidation,
    invoiceType: classification.invoiceType,
    reasons,
    decisionStatus: decision.status,
    duplicateKey,
    tokenUsage,
    trace: {
      extracted,
      normalized,
      validationIssues,
      ambiguity,
      classification,
      decision,
      duplicateKey
    }
  };
};

export const traceToText = (trace: InvoicePipelineTrace): string => {
  return JSON.stringify(trace, null, 2);
};

export type { ProcessedInvoice };
