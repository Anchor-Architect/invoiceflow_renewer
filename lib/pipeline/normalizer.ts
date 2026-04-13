import type { LlmInvoiceExtraction, NormalizedInvoiceData } from "@/types/pipeline";

const toNull = (value: string | null | undefined): string | null => {
  if (value === null || value === undefined) return null;
  const v = value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  return v.length === 0 ? null : v;
};

export const cleanupText = (value: string | null | undefined): string | null => toNull(value);

export const normalizeTaxCode = (value: string | null | undefined): string | null => {
  const t = toNull(value);
  if (!t) return null;
  const digits = t.replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
};

export const normalizeMoney = (value: string | null | undefined): number | null => {
  const source = toNull(value);
  if (!source) return null;

  const compact = source.replace(/[\s\u00A0]/g, "");
  const stripped = compact.replace(/[^0-9,.-]/g, "");
  if (!stripped || stripped === "." || stripped === "," || stripped === "-") return null;

  const negative = stripped.startsWith("-") ? -1 : 1;
  const unsigned = stripped.replace(/-/g, "");

  const dotCount = (unsigned.match(/\./g) ?? []).length;
  const commaCount = (unsigned.match(/,/g) ?? []).length;

  let normalized = unsigned;
  if (dotCount > 0 && commaCount > 0) {
    const decimalSep = unsigned.lastIndexOf(".") > unsigned.lastIndexOf(",") ? "." : ",";
    const thousandSep = decimalSep === "." ? "," : ".";
    normalized = unsigned.replace(new RegExp(`\\${thousandSep}`, "g"), "");
    normalized = normalized.replace(decimalSep, ".");
  } else if (dotCount > 0) {
    const parts = unsigned.split(".");
    normalized = parts.length > 2 ? parts.join("") : parts[1]?.length <= 2 ? unsigned : parts.join("");
  } else if (commaCount > 0) {
    const parts = unsigned.split(",");
    normalized = parts.length > 2 ? parts.join("") : parts[1]?.length <= 2 ? unsigned.replace(",", ".") : parts.join("");
  }

  const parsed = Number(normalized) * negative;
  return Number.isFinite(parsed) ? parsed : null;
};

const parseDateParts = (day: number, month: number, year: number): string | null => {
  if (year < 1900 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

export const normalizeDate = (value: string | null | undefined): string | null => {
  const input = toNull(value);
  if (!input) return null;

  const iso = input.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (iso) {
    return parseDateParts(Number(iso[3]), Number(iso[2]), Number(iso[1]));
  }

  const dmy = input.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (dmy) {
    let year = Number(dmy[3]);
    if (year < 100) year += 2000;
    return parseDateParts(Number(dmy[1]), Number(dmy[2]), year);
  }

  const dateObj = new Date(input);
  if (!Number.isNaN(dateObj.getTime())) {
    return `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, "0")}-${String(
      dateObj.getDate()
    ).padStart(2, "0")}`;
  }

  return null;
};

const quarterFromDate = (date: string | null): "Q1" | "Q2" | "Q3" | "Q4" | null => {
  if (!date) return null;
  const month = Number(date.split("-")[1]);
  if (month >= 1 && month <= 3) return "Q1";
  if (month >= 4 && month <= 6) return "Q2";
  if (month >= 7 && month <= 9) return "Q3";
  if (month >= 10 && month <= 12) return "Q4";
  return null;
};

export const normalizeExtraction = (extracted: LlmInvoiceExtraction): NormalizedInvoiceData => {
  const invoiceDate = normalizeDate(extracted.invoice_date.value);

  return {
    invoice_number: cleanupText(extracted.invoice_number.value),
    invoice_serial: cleanupText(extracted.invoice_serial.value),
    invoice_date: invoiceDate,
    buyer_name: cleanupText(extracted.buyer_name.value),
    buyer_tax_code: normalizeTaxCode(extracted.buyer_tax_code.value),
    seller_name: cleanupText(extracted.seller_name.value),
    seller_tax_code: normalizeTaxCode(extracted.seller_tax_code.value),
    subtotal: normalizeMoney(extracted.subtotal.value),
    vat_amount: normalizeMoney(extracted.vat_amount.value),
    total_amount: normalizeMoney(extracted.total_amount.value),
    currency: cleanupText(extracted.currency.value) ?? "VND",
    invoice_type: cleanupText(extracted.invoice_type.value),
    quarter: quarterFromDate(invoiceDate)
  };
};
