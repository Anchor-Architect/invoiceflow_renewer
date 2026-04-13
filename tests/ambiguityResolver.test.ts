import { describe, expect, it } from "vitest";
import { resolveAmbiguities } from "@/lib/pipeline/ambiguityResolver";
import type { LlmInvoiceExtraction } from "@/types/pipeline";

const field = {
  value: null,
  confidence: 0.4,
  raw_text_span: null,
  reason: null,
  ambiguous: false,
  candidates: []
};

it("resolves buyer tax code candidate with label context", () => {
  const extracted: LlmInvoiceExtraction = {
    invoice_number: { ...field, value: "1" },
    invoice_serial: { ...field, value: null },
    invoice_date: { ...field, value: "01/01/2026" },
    buyer_name: { ...field, value: "CÔNG TY TNHH SAMSON PRODUCTION" },
    buyer_tax_code: {
      ...field,
      ambiguous: true,
      candidates: [
        { value: "0109276253", confidence: 0.7, raw_text_span: null, reason: "candidate A" },
        { value: "0316350473", confidence: 0.68, raw_text_span: null, reason: "candidate B" }
      ]
    },
    seller_name: { ...field, value: "Seller" },
    seller_tax_code: { ...field, value: "0109276253" },
    subtotal: { ...field, value: "100" },
    vat_amount: { ...field, value: "8" },
    total_amount: { ...field, value: "108" },
    currency: { ...field, value: "VND" },
    invoice_type: field,
    raw_confidence_notes: [],
    ambiguous_fields: []
  };

  const rawText = "Nguoi mua MST: 0316350473";
  const resolved = resolveAmbiguities(extracted, rawText);
  expect(resolved.resolved.buyer_tax_code).toBe("0316350473");
});
