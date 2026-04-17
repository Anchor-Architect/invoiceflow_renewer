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

  const files = await Promise.all(
    pdfEntries.map(async (entry) => ({
      id: createId(),
      name: entry.name.split("/").at(-1) ?? entry.name,
      buffer: await entry.async("nodebuffer")
    }))
  );

  return files;
};

export const createUploadedPdf = (name: string, buffer: Buffer): UploadedPdf => ({
  id: createId(),
  name,
  buffer
});
