import { createUploadedPdf, extractPdfsFromZip, type UploadedPdf } from "@/lib/pdf/zip";

const PDF_EXT = ".pdf";
const ZIP_EXT = ".zip";

const isPdf = (name: string) => name.toLowerCase().endsWith(PDF_EXT);
const isZip = (name: string) => name.toLowerCase().endsWith(ZIP_EXT);

export const ingestUploadedFiles = async (files: File[]): Promise<UploadedPdf[]> => {
  if (files.length === 0) {
    throw new Error("No files uploaded");
  }

  const zipFiles = files.filter((f) => isZip(f.name));
  const pdfFiles = files.filter((f) => isPdf(f.name));
  const invalidFiles = files.filter((f) => !isPdf(f.name) && !isZip(f.name));

  if (invalidFiles.length > 0) {
    throw new Error(`Unsupported file types: ${invalidFiles.map((f) => f.name).join(", ")}`);
  }

  if (zipFiles.length > 1) {
    throw new Error("Only one ZIP file is allowed per batch");
  }

  if (zipFiles.length > 0 && pdfFiles.length > 0) {
    throw new Error("Upload either a ZIP file or PDF files, not both");
  }

  let merged: UploadedPdf[] = [];

  if (zipFiles.length === 1) {
    const zipBuffer = Buffer.from(await zipFiles[0].arrayBuffer());
    merged = await extractPdfsFromZip(zipBuffer);
    if (merged.length === 0) {
      throw new Error("ZIP does not contain any PDF files");
    }
  } else {
    merged = await Promise.all(
      pdfFiles.map(async (file) => {
        const buffer = Buffer.from(await file.arrayBuffer());
        return createUploadedPdf(file.name, buffer);
      })
    );
  }

  if (merged.length > 200) {
    throw new Error("Maximum 200 invoice PDFs per batch");
  }

  return merged;
};
