import { normalizeText } from "@/lib/utils/text";
import type {
  AmbiguityResolutionOutput,
  ExtractedField,
  ImportantFieldKey,
  LlmInvoiceExtraction
} from "@/types/pipeline";

const LABELS: Record<ImportantFieldKey, string[]> = {
  invoice_number: ["so", "invoice no", "so hoa don"],
  invoice_date: ["ngay", "date"],
  buyer_name: ["buyer", "nguoi mua", "don vi mua", "ten don vi"],
  buyer_tax_code: ["mst nguoi mua", "nguoi mua mst", "buyer tax", "ma so thue", "mst"],
  seller_name: ["seller", "nguoi ban", "don vi ban"],
  seller_tax_code: ["mst", "tax code", "ma so thue", "seller tax"],
  subtotal: ["cong tien hang", "amount before vat", "subtotal"],
  vat_amount: ["tien thue", "vat amount", "tax amount"],
  total_amount: ["tong cong", "total payment", "total amount"],
  currency: ["vnd", "currency"],
  invoice_type: ["invoice type"]
};

const findLabelBoost = (rawText: string, value: string, labels: string[]): number => {
  if (!value) return 0;
  const text = normalizeText(rawText);
  const val = normalizeText(value);
  const idx = text.indexOf(val);
  if (idx < 0) return 0;
  const left = text.slice(Math.max(0, idx - 80), idx);
  return labels.some((label) => left.includes(label)) ? 0.15 : 0;
};

const scoreCandidate = (
  field: ImportantFieldKey,
  candidate: { value: string | null; confidence: number; reason: string | null },
  rawText: string
): { score: number; reason: string } => {
  const base = Math.max(0, Math.min(1, candidate.confidence));
  const value = candidate.value ?? "";
  const labelBoost = findLabelBoost(rawText, value, LABELS[field]);
  const final = Math.min(1, base + labelBoost);
  return {
    score: final,
    reason: `base=${base.toFixed(2)} labelBoost=${labelBoost.toFixed(2)} ${candidate.reason ?? ""}`
  };
};

const resolveField = (
  key: ImportantFieldKey,
  field: ExtractedField,
  rawText: string
): AmbiguityResolutionOutput["records"][number] => {
  const candidatePool = [
    { value: field.value, confidence: field.confidence, reason: field.reason },
    ...field.candidates.map((c) => ({ value: c.value, confidence: c.confidence, reason: c.reason }))
  ].filter((c, idx, arr) => arr.findIndex((x) => x.value === c.value) === idx);

  const scored = candidatePool.map((c) => {
    const score = scoreCandidate(key, c, rawText);
    return {
      value: c.value,
      score: score.score,
      reason: score.reason
    };
  });

  const top = scored.sort((a, b) => b.score - a.score)[0] ?? {
    value: null,
    score: 0,
    reason: "no candidates"
  };

  const unresolved = field.ambiguous && top.score < 0.7;

  return {
    field: key,
    selected: top.value,
    selectedScore: top.score,
    considered: scored,
    unresolved
  };
};

export const resolveAmbiguities = (
  extracted: LlmInvoiceExtraction,
  rawText: string
): AmbiguityResolutionOutput => {
  const targetFields: ImportantFieldKey[] = [
    "buyer_name",
    "buyer_tax_code",
    "seller_name",
    "seller_tax_code"
  ];

  const records = targetFields.map((key) => resolveField(key, extracted[key], rawText));

  const resolved = Object.fromEntries(records.map((r) => [r.field, r.selected])) as Partial<
    Record<ImportantFieldKey, string | null>
  >;

  return {
    resolved,
    records,
    remainingAmbiguous: records.filter((r) => r.unresolved).map((r) => r.field)
  };
};
