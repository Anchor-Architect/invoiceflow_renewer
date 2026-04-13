import type { ClassificationResult, NormalizedInvoiceData } from "@/types/pipeline";
import { OUR_COMPANY_MST } from "@/types/pipeline";

export const classifyInvoiceByMstRule = (
  normalized: NormalizedInvoiceData
): ClassificationResult => {
  const buyer = normalized.buyer_tax_code;
  const seller = normalized.seller_tax_code;

  if (seller === OUR_COMPANY_MST) {
    return {
      invoiceType: "Sales",
      reason: `seller_tax_code matches OUR_COMPANY_MST (${OUR_COMPANY_MST})`
    };
  }

  if (buyer === OUR_COMPANY_MST) {
    return {
      invoiceType: "Purchase",
      reason: `buyer_tax_code matches OUR_COMPANY_MST (${OUR_COMPANY_MST})`
    };
  }

  return {
    invoiceType: "Unknown",
    reason: `Neither buyer_tax_code (${buyer ?? "null"}) nor seller_tax_code (${seller ?? "null"}) matches OUR_COMPANY_MST (${OUR_COMPANY_MST})`
  };
};
