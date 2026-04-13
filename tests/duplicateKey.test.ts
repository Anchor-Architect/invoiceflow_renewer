import { describe, expect, it } from "vitest";
import { buildDuplicateKey } from "@/lib/pipeline/validator";

describe("duplicate key", () => {
  it("uses invoice_number + seller_tax_code", () => {
    expect(
      buildDuplicateKey({
        invoice_number: "AB-001",
        invoice_serial: null,
        seller_tax_code: "0312345678",
        invoice_date: "2026-01-01",
        buyer_name: null,
        buyer_tax_code: null,
        seller_name: null,
        subtotal: null,
        vat_amount: null,
        total_amount: null,
        currency: null,
        invoice_type: null,
        quarter: null
      })
    ).toBe("ab-001|0312345678");
  });
});
