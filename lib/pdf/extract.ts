import pdfParse from "pdf-parse";

export const extractPdfText = async (buffer: Buffer): Promise<string> => {
  const parsed = await pdfParse(buffer);
  return (parsed.text ?? "").replace(/\s+\n/g, "\n").trim();
};
