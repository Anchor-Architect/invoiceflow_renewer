import type {
  ClassificationResult,
  ImportantFieldKey,
  LlmInvoiceExtraction,
  NormalizedInvoiceData,
  ValidationIssue
} from "@/types/pipeline";

const VAT_RATES = [0, 0.05, 0.08, 0.1];

export const buildDuplicateKey = (normalized: NormalizedInvoiceData): string => {
  const invoice = (normalized.invoice_number ?? "").trim().toLowerCase();
  const sellerTax = (normalized.seller_tax_code ?? "").trim();
  return `${invoice}|${sellerTax}`;
};

const pushIssue = (
  issues: ValidationIssue[],
  issue: Omit<ValidationIssue, "severity"> & { severity?: ValidationIssue["severity"] }
) => {
  issues.push({ severity: issue.severity ?? "error", ...issue });
};

const validateRequired = (normalized: NormalizedInvoiceData, issues: ValidationIssue[]) => {
  const required: Array<[keyof NormalizedInvoiceData, string]> = [
    ["invoice_date", "invoice_date"],
    ["invoice_number", "invoice_number"],
    ["seller_tax_code", "seller_tax_code"],
    ["buyer_tax_code", "buyer_tax_code"],
    ["total_amount", "total_amount"]
  ];

  for (const [field, label] of required) {
    if (normalized[field] === null || normalized[field] === "") {
      pushIssue(issues, {
        code: "required_missing",
        stage: "validation",
        field: label,
        message: `Missing required field: ${label}`
      });
    }
  }
};

const validateDate = (normalized: NormalizedInvoiceData, issues: ValidationIssue[]) => {
  if (!normalized.invoice_date) return;
  const dt = new Date(normalized.invoice_date);
  if (Number.isNaN(dt.getTime())) {
    pushIssue(issues, {
      code: "date_invalid",
      stage: "normalization",
      field: "invoice_date",
      message: `Invalid normalized date: ${normalized.invoice_date}`
    });
    return;
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (dt.getTime() > today) {
    pushIssue(issues, {
      code: "date_future",
      stage: "validation",
      field: "invoice_date",
      message: `Invoice date is in the future: ${normalized.invoice_date}`
    });
  }
};

const validateTaxCode = (normalized: NormalizedInvoiceData, issues: ValidationIssue[]) => {
  for (const field of ["buyer_tax_code", "seller_tax_code"] as const) {
    const val = normalized[field];
    if (!val) continue;
    if (!/^\d+$/.test(val) || (val.length !== 10 && val.length !== 13)) {
      pushIssue(issues, {
        code: "tax_code_invalid",
        stage: "validation",
        field,
        message: `Invalid tax code format in ${field}: ${val}`
      });
    }
  }
};

const validateAmounts = (normalized: NormalizedInvoiceData, issues: ValidationIssue[]) => {
  const { subtotal, vat_amount: vat, total_amount: total } = normalized;

  if (total !== null && total <= 0) {
    pushIssue(issues, {
      code: "total_non_positive",
      stage: "validation",
      field: "total_amount",
      message: "total_amount must be greater than 0"
    });
  }

  if (subtotal !== null && vat !== null && total !== null) {
    const diff = Math.abs(subtotal + vat - total);
    if (diff > 1) {
      pushIssue(issues, {
        code: "amount_mismatch",
        stage: "validation",
        field: "total_amount",
        message: "subtotal + vat_amount does not match total_amount within tolerance",
        evidence: [
          `subtotal=${subtotal}`,
          `vat_amount=${vat}`,
          `total_amount=${total}`,
          `diff=${diff}`
        ]
      });
    }
  }

  if (subtotal !== null && subtotal > 0 && vat !== null) {
    const effectiveRate = vat / subtotal;
    const nearest = VAT_RATES.reduce((acc, r) =>
      Math.abs(r - effectiveRate) < Math.abs(acc - effectiveRate) ? r : acc
    );
    if (Math.abs(nearest - effectiveRate) > 0.02) {
      pushIssue(issues, {
        code: "vat_rate_unusual",
        stage: "validation",
        field: "vat_amount",
        message: `Effective VAT rate ${(effectiveRate * 100).toFixed(2)}% is outside expected ranges`,
        evidence: [`effective_rate=${effectiveRate}`, `nearest_rate=${nearest}`],
        severity: "warning"
      });
    }
  }
};

const validateFieldExtraction = (extracted: LlmInvoiceExtraction, issues: ValidationIssue[]) => {
  const mapping: Array<[ImportantFieldKey, string]> = [
    ["invoice_number", "invoice_number"],
    ["invoice_date", "invoice_date"],
    ["buyer_tax_code", "buyer_tax_code"],
    ["seller_tax_code", "seller_tax_code"],
    ["total_amount", "total_amount"]
  ];

  for (const [field, label] of mapping) {
    if (extracted[field].ambiguous) {
      pushIssue(issues, {
        code: "critical_ambiguous",
        stage: "ambiguity",
        field: label,
        message: `Critical field is ambiguous: ${label}`,
        evidence: extracted[field].candidates.map((c) => c.value ?? "null")
      });
    }
  }
};

const validateClassification = (
  classification: ClassificationResult,
  allowUnknownType: boolean,
  issues: ValidationIssue[]
) => {
  if (classification.invoiceType === "Unknown" && !allowUnknownType) {
    pushIssue(issues, {
      code: "unknown_classification",
      stage: "classification",
      field: "invoice_type",
      message: "invoice_type cannot remain unknown"
    });
  }
};

export const validateNormalizedInvoice = (
  extracted: LlmInvoiceExtraction,
  normalized: NormalizedInvoiceData,
  classification: ClassificationResult,
  allowUnknownType = false
): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];

  validateRequired(normalized, issues);
  validateDate(normalized, issues);
  validateTaxCode(normalized, issues);
  validateAmounts(normalized, issues);
  validateFieldExtraction(extracted, issues);
  validateClassification(classification, allowUnknownType, issues);

  if ((normalized.invoice_number ?? "").length > 0 && (normalized.invoice_number ?? "").length < 3) {
    pushIssue(issues, {
      code: "invoice_number_short",
      stage: "validation",
      field: "invoice_number",
      message: "invoice_number must be at least 3 characters"
    });
  }

  return issues;
};
