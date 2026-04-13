import fs from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { TokenUsage } from "@/types/invoice";
import type { ExtractedField, LlmInvoiceExtraction } from "@/types/pipeline";

let cachedPrompt: string | null = null;

const loadPrompt = async (): Promise<string> => {
  if (cachedPrompt) return cachedPrompt;
  cachedPrompt = await fs.readFile(
    path.join(process.cwd(), "prompts", "claude-invoice-extraction-compact.txt"),
    "utf8"
  );
  return cachedPrompt;
};

const extractJsonObject = (input: string): string => {
  const start = input.indexOf("{");
  const end = input.lastIndexOf("}");
  if (start < 0 || end < 0 || end <= start) {
    throw new Error("Claude response does not contain a JSON object");
  }
  return input.slice(start, end + 1);
};

// Exponential backoff: waits 2^attempt * base ms, capped at maxMs
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const withRetry = async <T>(
  fn: () => Promise<T>,
  maxAttempts = 5,
  baseDelayMs = 2000
): Promise<T> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const msg = error instanceof Error ? error.message : String(error);
      const isRateLimit =
        msg.includes("rate_limit") ||
        msg.includes("429") ||
        msg.includes("overloaded") ||
        msg.includes("529");

      if (!isRateLimit) throw error; // non-rate-limit errors bubble up immediately

      const delayMs = Math.min(baseDelayMs * 2 ** attempt, 60_000);
      console.warn(`Rate limit hit (attempt ${attempt + 1}/${maxAttempts}). Retrying in ${delayMs}ms…`);
      await sleep(delayMs);
    }
  }
  throw lastError;
};

type CompactExtraction = {
  invoice_number: string | null;
  invoice_serial: string | null;
  invoice_date: string | null;
  seller_name: string | null;
  seller_tax_code: string | null;
  buyer_name: string | null;
  buyer_tax_code: string | null;
  subtotal: number | string | null;
  vat_amount: number | string | null;
  total_amount: number | string | null;
};

const toField = (value: string | null): ExtractedField => ({
  value,
  confidence: value !== null ? 0.9 : 0.0,
  raw_text_span: value,
  reason: null,
  ambiguous: false,
  candidates: []
});

const numToField = (value: number | string | null): ExtractedField =>
  toField(value !== null ? String(value) : null);

export type ExtractionResult = {
  extraction: LlmInvoiceExtraction;
  tokenUsage: TokenUsage;
};

export const extractInvoiceStructured = async (invoiceText: string): Promise<ExtractionResult> => {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error("CLAUDE_API_KEY is missing");

  const anthropic = new Anthropic({ apiKey });

  // Haiku is ~20x cheaper than Sonnet; override with CLAUDE_MODEL if needed
  const model = process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001";
  const prompt = await loadPrompt();

  // Vietnamese invoices are compact; 5000 chars is more than enough
  const textToSend = invoiceText.slice(0, 5000);

  const response = await withRetry(() =>
    anthropic.messages.create({
      model,
      temperature: 0,
      max_tokens: 500,
      system: prompt,
      messages: [{ role: "user", content: `Extract from invoice:\n\n${textToSend}` }]
    }).catch((error) => {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("not_found_error") || msg.includes("model")) {
        throw new Error(
          `CLAUDE_MODEL is invalid or unavailable: ${model}. Set CLAUDE_MODEL to a valid model like claude-haiku-4-5-20251001.`
        );
      }
      throw error;
    })
  );

  const text = response.content
    .filter((c) => c.type === "text")
    .map((c) => (c.type === "text" ? c.text : ""))
    .join("\n");

  const compact: CompactExtraction = JSON.parse(extractJsonObject(text));

  const extraction: LlmInvoiceExtraction = {
    invoice_number: toField(compact.invoice_number ?? null),
    invoice_serial: toField(compact.invoice_serial ?? null),
    invoice_date: toField(compact.invoice_date ?? null),
    buyer_name: toField(compact.buyer_name ?? null),
    buyer_tax_code: toField(compact.buyer_tax_code ?? null),
    seller_name: toField(compact.seller_name ?? null),
    seller_tax_code: toField(compact.seller_tax_code ?? null),
    subtotal: numToField(compact.subtotal ?? null),
    vat_amount: numToField(compact.vat_amount ?? null),
    total_amount: numToField(compact.total_amount ?? null),
    currency: toField("VND"),
    invoice_type: toField(null),
    raw_confidence_notes: [],
    ambiguous_fields: []
  };

  const tokenUsage: TokenUsage = {
    input: response.usage.input_tokens,
    output: response.usage.output_tokens,
    model
  };

  return { extraction, tokenUsage };
};
