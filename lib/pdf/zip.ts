import JSZip from "jszip";

export type UploadedPdf = {
  id: string;
  name: string;
  buffer: Buffer;
};

const createId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

export const extractPdfsFromZip = async (
  zipBuffer: Buffer
): Promise<UploadedPdf[]> => {
  const zip = await JSZip.loadAsync(zipBuffer);
  const entries = Object.values(zip.files);
  const pdfEntries = entries.filter(
    (entry) => !entry.dir && entry.name.toLowerCase().endsWith(".pdf")
  );

  const files: UploadedPdf[] = [];
  for (const entry of pdfEntries) {
    const content = await entry.async("nodebuffer");
    files.push({
      id: createId(),
      name: entry.name.split("/").at(-1) ?? entry.name,
      buffer: content
    });
  }

  return files;
};

export const createUploadedPdf = (name: string, buffer: Buffer): UploadedPdf => ({
  id: createId(),
  name,
  buffer
});
