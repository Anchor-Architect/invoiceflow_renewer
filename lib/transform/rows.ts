import type { ClaudeInvoiceExtraction, PurchaseRow, SalesRow, ValidationResult } from "@/types/invoice";
import { parseNumber } from "@/lib/utils/number";

// "1C25TGN-00001" or just "00001" when serial is absent
const invoiceName = (serial: string | null, invoiceNo: string | null): string => {
  if (serial && invoiceNo) return `${serial}-${invoiceNo}`;
  if (invoiceNo) return invoiceNo;
  return serial ?? "UNKNOWN";
};

const percentage = (vatRate: number | null): string => {
  if (vatRate === null) return "";
  return `${vatRate}%`;
};

export const toPurchaseRow = (
  extraction: ClaudeInvoiceExtraction,
  validation: ValidationResult
): PurchaseRow => ({
  "Short description": extraction.seller.name ?? "",
  "Invoice's name": invoiceName(extraction.serial, extraction.invoice_no),
  "Issued Day": validation.normalizedDate ?? "",
  Quarter: validation.quarter ?? "",
  "Provider's name": extraction.seller.name ?? "",
  "Type of services/goods": validation.goodsType,
  Percentage: percentage(validation.vatRate),
  "Total excluded VAT": parseNumber(extraction.totals.subtotal) ?? 0,
  "VAT amount": parseNumber(extraction.totals.vat) ?? 0,
  Total: parseNumber(extraction.totals.total) ?? 0
});

export const toSalesRow = (
  extraction: ClaudeInvoiceExtraction,
  validation: ValidationResult
): SalesRow => ({
  No: "",
  "Short description": extraction.buyer.name ?? "",
  "Invoice's name": invoiceName(extraction.serial, extraction.invoice_no),
  "Issued Day": validation.normalizedDate ?? "",
  Quarter: validation.quarter ?? "",
  "Customer's name": extraction.buyer.name ?? "",
  "Type of services/goods": validation.goodsType,
  Percentage: percentage(validation.vatRate),
  "Total excluded VAT": parseNumber(extraction.totals.subtotal) ?? 0,
  "VAT amount": parseNumber(extraction.totals.vat) ?? 0,
  Total: parseNumber(extraction.totals.total) ?? 0
});
