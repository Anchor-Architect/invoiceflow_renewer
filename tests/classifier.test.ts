import { describe, expect, it } from "vitest";
import { classifyInvoiceByMstRule } from "@/lib/pipeline/classifier";

const base = {
  invoice_number: "0001",
  invoice_serial: null,
  invoice_date: "2026-02-01",
  buyer_name: "B",
  buyer_tax_code: null,
  seller_name: "S",
  seller_tax_code: null,
  subtotal: 100,
  vat_amount: 8,
  total_amount: 108,
  currency: "VND",
  invoice_type: null,
  quarter: "Q1" as const
};

describe("MST-based classification", () => {
  it("classifies sales when seller tax code is ours", () => {
    const result = classifyInvoiceByMstRule({ ...base, seller_tax_code: "0316350473" });
    expect(result.invoiceType).toBe("Sales");
  });

  it("classifies purchase when buyer tax code is ours", () => {
    const result = classifyInvoiceByMstRule({ ...base, buyer_tax_code: "0316350473" });
    expect(result.invoiceType).toBe("Purchase");
  });

  it("returns unknown when neither buyer nor seller MST matches ours", () => {
    const result = classifyInvoiceByMstRule({ ...base, seller_tax_code: "0109276253" });
    expect(result.invoiceType).toBe("Unknown");
  });
});
