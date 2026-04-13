import fs from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { claudeExtractionSchema } from "@/types/schemas";
import type { ClaudeInvoiceExtraction } from "@/types/invoice";

let cachedPrompt: string | null = null;

const loadPrompt = async (): Promise<string> => {
  if (cachedPrompt) return cachedPrompt;
  const promptPath = path.join(process.cwd(), "prompts", "claude-invoice-extraction.txt");
  cachedPrompt = await fs.readFile(promptPath, "utf8");
  return cachedPrompt;
};

const extractJsonObject = (input: string): string => {
  const start = input.indexOf("{");
  const end = input.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Claude response does not contain JSON object");
  }
  return input.slice(start, end + 1);
};

export const extractInvoiceWithClaude = async (
  invoiceText: string
): Promise<ClaudeInvoiceExtraction> => {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error("CLAUDE_API_KEY is missing");

  const anthropic = new Anthropic({ apiKey });
  const prompt = await loadPrompt();
  const model = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

  let response;
  try {
    response = await anthropic.messages.create({
      model,
      max_tokens: 1800,
      temperature: 0,
      system: prompt,
      messages: [
        {
          role: "user",
          content: `Extract data from this invoice text:\n\n${invoiceText.slice(0, 120000)}`
        }
      ]
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("not_found_error") || message.includes("model")) {
      throw new Error(
        `CLAUDE_MODEL is invalid or unavailable: ${model}. Set CLAUDE_MODEL to an available model (e.g. claude-sonnet-4-6).`
      );
    }
    throw error;
  }

  const text = response.content
    .filter((c) => c.type === "text")
    .map((c) => (c.type === "text" ? c.text : ""))
    .join("\n");

  const jsonString = extractJsonObject(text);
  const parsedJson = JSON.parse(jsonString);
  return claudeExtractionSchema.parse(parsedJson);
};
