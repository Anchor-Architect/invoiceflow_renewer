import { describe, expect, it } from "vitest";
import { validateNormalizedInvoice } from "@/lib/pipeline/validator";
import type { LlmInvoiceExtraction, NormalizedInvoiceData } from "@/types/pipeline";

const emptyField = {
  value: null,
  confidence: 0,
  raw_text_span: null,
  reason: null,
  ambiguous: false,
  candidates: []
};

const extracted: LlmInvoiceExtraction = {
  invoice_number: { ...emptyField, value: "0001" },
  invoice_serial: { ...emptyField, value: null },
  invoice_date: { ...emptyField, value: "01/02/2026" },
  buyer_name: { ...emptyField, value: "Buyer" },
  buyer_tax_code: { ...emptyField, value: "0316350473" },
  seller_name: { ...emptyField, value: "Seller" },
  seller_tax_code: { ...emptyField, value: "0109276253" },
  subtotal: { ...emptyField, value: "100" },
  vat_amount: { ...emptyField, value: "8" },
  total_amount: { ...emptyField, value: "108" },
  currency: { ...emptyField, value: "VND" },
  invoice_type: { ...emptyField, value: null },
  raw_confidence_notes: [],
  ambiguous_fields: []
};

const normalized: NormalizedInvoiceData = {
  invoice_number: "0001",
  invoice_serial: null,
  invoice_date: "2026-02-01",
  buyer_name: "Buyer",
  buyer_tax_code: "0316350473",
  seller_name: "Seller",
  seller_tax_code: "0109276253",
  subtotal: 100,
  vat_amount: 8,
  total_amount: 108,
  currency: "VND",
  invoice_type: null,
  quarter: "Q1"
};

describe("amount validation", () => {
  it("passes consistent subtotal/vat/total", () => {
    const issues = validateNormalizedInvoice(
      extracted,
      normalized,
      { invoiceType: "Purchase", reason: "buyer matches" },
      false
    );
    expect(issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  it("reports mismatch beyond tolerance", () => {
    const issues = validateNormalizedInvoice(
      extracted,
      { ...normalized, total_amount: 120 },
      { invoiceType: "Purchase", reason: "buyer matches" },
      false
    );
    expect(issues.some((i) => i.code === "amount_mismatch")).toBe(true);
  });
});
