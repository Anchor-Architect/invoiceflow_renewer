import { z } from "zod";

export const nullableString = z
  .union([z.string(), z.null()])
  .transform((val) => {
    if (val === null) return null;
    const trimmed = val.trim();
    return trimmed.length > 0 ? trimmed : null;
  });

export const claudeExtractionSchema = z.object({
  invoice_no: nullableString,
  serial: nullableString,
  date: nullableString,
  seller: z.object({
    name: nullableString,
    tax_code: nullableString
  }),
  buyer: z.object({
    name: nullableString,
    tax_code: nullableString
  }),
  items: z.array(
    z.object({
      description: nullableString,
      quantity: nullableString,
      unit_price: nullableString,
      amount: nullableString,
      vat_rate: nullableString
    })
  ),
  totals: z.object({
    subtotal: nullableString,
    vat: nullableString,
    total: nullableString
  }),
  raw_confidence_notes: z.array(z.string().trim()).default([]),
  ambiguous_fields: z.array(z.string().trim()).default([])
});

export type ClaudeExtractionSchema = z.infer<typeof claudeExtractionSchema>;

const extractionCandidateSchema = z.object({
  value: nullableString,
  confidence: z.number().min(0).max(1).default(0),
  raw_text_span: nullableString.default(null),
  reason: nullableString.default(null)
});

const extractedFieldSchema = z.object({
  value: nullableString,
  confidence: z.number().min(0).max(1).default(0),
  raw_text_span: nullableString.default(null),
  reason: nullableString.default(null),
  ambiguous: z.boolean().default(false),
  candidates: z.array(extractionCandidateSchema).default([])
});

export const llmInvoiceExtractionSchema = z.object({
  invoice_number: extractedFieldSchema,
  invoice_date: extractedFieldSchema,
  buyer_name: extractedFieldSchema,
  buyer_tax_code: extractedFieldSchema,
  seller_name: extractedFieldSchema,
  seller_tax_code: extractedFieldSchema,
  subtotal: extractedFieldSchema,
  vat_amount: extractedFieldSchema,
  total_amount: extractedFieldSchema,
  currency: extractedFieldSchema,
  invoice_type: extractedFieldSchema,
  raw_confidence_notes: z.array(z.string().trim()).default([]),
  ambiguous_fields: z.array(z.string().trim()).default([])
});

export type LlmInvoiceExtractionSchema = z.infer<typeof llmInvoiceExtractionSchema>;
