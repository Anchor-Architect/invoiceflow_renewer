import {
  COMPANY_NAME,
  COMPANY_TAX_CODE,
  type ClaudeInvoiceExtraction,
  type InvoiceType,
  type ReviewReason
} from "@/types/invoice";
import { normalizeText } from "@/lib/utils/text";

const normalizeTaxCode = (v: string | null): string | null => {
  if (!v) return null;
  const cleaned = v.replace(/[^0-9]/g, "");
  return cleaned.length > 0 ? cleaned : null;
};

export const classifyInvoice = (
  extraction: ClaudeInvoiceExtraction
): { type: InvoiceType; issues: ReviewReason[] } => {
  const issues: ReviewReason[] = [];
  const buyerTax = normalizeTaxCode(extraction.buyer.tax_code);
  const sellerTax = normalizeTaxCode(extraction.seller.tax_code);

  if (buyerTax === COMPANY_TAX_CODE) {
    if (sellerTax === COMPANY_TAX_CODE) {
      issues.push({
        type: "Ambiguous",
        reason: "seller and buyer both match company tax code",
        evidence: [
          `buyer.tax_code=${extraction.buyer.tax_code}`,
          `seller.tax_code=${extraction.seller.tax_code}`
        ]
      });
      return { type: "Unknown", issues };
    }
    return { type: "Purchase", issues };
  }

  if (sellerTax === COMPANY_TAX_CODE) {
    return { type: "Sales", issues };
  }

  const companyNameNorm = normalizeText(COMPANY_NAME);
  const buyerNameNorm = normalizeText(extraction.buyer.name);
  const sellerNameNorm = normalizeText(extraction.seller.name);

  if (buyerNameNorm && buyerNameNorm.includes(companyNameNorm)) {
    return { type: "Purchase", issues };
  }

  if (sellerNameNorm && sellerNameNorm.includes(companyNameNorm)) {
    return { type: "Sales", issues };
  }

  issues.push({
    type: "Ambiguous",
    reason: "unable to classify",
    evidence: [
      `buyer.tax_code=${extraction.buyer.tax_code ?? "null"}`,
      `seller.tax_code=${extraction.seller.tax_code ?? "null"}`,
      `buyer.name=${extraction.buyer.name ?? "null"}`,
      `seller.name=${extraction.seller.name ?? "null"}`
    ]
  });

  return { type: "Unknown", issues };
};
