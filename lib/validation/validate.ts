import type { ClaudeInvoiceExtraction, ReviewReason, ValidationResult } from "@/types/invoice";
import { normalizeInvoiceDate, quarterFromDate } from "@/lib/utils/date";
import { inferGoodsType } from "@/lib/utils/text";
import { nearlyEqual, parseNumber } from "@/lib/utils/number";

const requiredFieldIssues = (extraction: ClaudeInvoiceExtraction): ReviewReason[] => {
  const checks: Array<[boolean, string, string]> = [
    [!!extraction.invoice_no, "invoice_no", `invoice_no=${extraction.invoice_no ?? "null"}`],
    [!!extraction.date, "date", `date=${extraction.date ?? "null"}`],
    [
      !!extraction.seller.name,
      "seller.name",
      `seller.name=${extraction.seller.name ?? "null"}`
    ],
    [!!extraction.buyer.name, "buyer.name", `buyer.name=${extraction.buyer.name ?? "null"}`],
    [
      !!extraction.totals.total,
      "totals.total",
      `totals.total=${extraction.totals.total ?? "null"}`
    ]
  ];

  return checks
    .filter((c) => !c[0])
    .map((c) => ({
      type: "Ambiguous" as const,
      reason: `missing required field: ${c[1]}`,
      evidence: [c[2]]
    }));
};

const inferVatRate = (extraction: ClaudeInvoiceExtraction): {
  rate: number | null;
  issues: ReviewReason[];
  warnings: ValidationResult["warnings"];
} => {
  const itemRates = extraction.items
    .map((i) => parseNumber(i.vat_rate))
    .filter((x): x is number => x !== null)
    .map((r) => (r > 1 ? r : r * 100));

  if (itemRates.length === 0) return { rate: null, issues: [], warnings: [] };

  const unique = [...new Set(itemRates.map((r) => Math.round(r * 100) / 100))];
  if (unique.length > 1) {
    return {
      rate: null,
      issues: [],
      warnings: [
        {
          reason: "multiple VAT rates found and no clear invoice-level rate",
          evidence: [`item_vat_rates=${unique.join(",")}`]
        }
      ]
    };
  }

  return { rate: unique[0], issues: [], warnings: [] };
};

const isBlockingAmbiguousField = (field: string): boolean => {
  const corePrefixes = [
    "invoice_no",
    "date",
    "seller.name",
    "seller.tax_code",
    "buyer.name",
    "buyer.tax_code",
    "totals.total",
    "totals.subtotal",
    "totals.vat"
  ];
  return corePrefixes.some((prefix) => field === prefix || field.startsWith(`${prefix}.`));
};

export const validateExtraction = (extraction: ClaudeInvoiceExtraction): ValidationResult => {
  const issues: ReviewReason[] = [];
  const warnings: ValidationResult["warnings"] = [];
  issues.push(...requiredFieldIssues(extraction));

  const normalizedDate = normalizeInvoiceDate(extraction.date);
  const quarter = quarterFromDate(normalizedDate);

  if (extraction.date && !normalizedDate) {
    issues.push({
      type: "Validation error",
      reason: "impossible or invalid invoice date",
      evidence: [`date=${extraction.date}`]
    });
  }

  const subtotal = parseNumber(extraction.totals.subtotal);
  const vat = parseNumber(extraction.totals.vat);
  const total = parseNumber(extraction.totals.total);

  if (extraction.totals.total && total === null) {
    issues.push({
      type: "Validation error",
      reason: "invalid numeric conversion for totals.total",
      evidence: [`totals.total=${extraction.totals.total}`]
    });
  }

  if (subtotal !== null && vat !== null && total !== null && !nearlyEqual(subtotal + vat, total, 2)) {
    issues.push({
      type: "Validation error",
      reason: "subtotal + vat does not match total",
      evidence: [`subtotal=${subtotal}`, `vat=${vat}`, `total=${total}`]
    });
  }

  const vatRateResult = inferVatRate(extraction);
  issues.push(...vatRateResult.issues);
  warnings.push(...vatRateResult.warnings);

  if (vatRateResult.rate !== null && subtotal !== null && vat !== null) {
    const expectedVat = subtotal * (vatRateResult.rate / 100);
    if (!nearlyEqual(expectedVat, vat, 2)) {
      issues.push({
        type: "Validation error",
        reason: "VAT amount mismatch with subtotal and VAT rate",
        evidence: [
          `subtotal=${subtotal}`,
          `vat_rate=${vatRateResult.rate}`,
          `expected_vat=${expectedVat.toFixed(2)}`,
          `vat=${vat}`
        ]
      });
    }
  }

  const blockingAmbiguous = extraction.ambiguous_fields.filter(isBlockingAmbiguousField);
  if (blockingAmbiguous.length > 0) {
    issues.push({
      type: "Ambiguous",
      reason: "claude reported ambiguous fields on key invoice fields",
      evidence: blockingAmbiguous
    });
  }
  const nonBlockingAmbiguous = extraction.ambiguous_fields.filter(
    (field) => !isBlockingAmbiguousField(field)
  );
  if (nonBlockingAmbiguous.length > 0) {
    warnings.push({
      reason: "claude reported ambiguous non-key fields",
      evidence: nonBlockingAmbiguous
    });
  }

  const firstDescription = extraction.items[0]?.description ?? null;

  return {
    normalizedDate,
    quarter,
    vatRate: vatRateResult.rate,
    goodsType: inferGoodsType(firstDescription),
    issues,
    warnings
  };
};
