declare module "pdf-parse" {
  type PdfData = {
    text: string;
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: unknown;
    version: string;
  };

  function pdfParse(dataBuffer: Buffer): Promise<PdfData>;

  export default pdfParse;
}
