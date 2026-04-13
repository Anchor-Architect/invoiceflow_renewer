import type { InsertSummary, ProcessedInvoice } from "@/types/invoice";
import { getSheetsClient } from "@/lib/google-sheets/client";

const PURCHASE_TAB = "Purchase";
const SALES_TAB = "Sales";

const purchaseRowToValues = (row: NonNullable<ProcessedInvoice["purchaseRow"]>) => [
  row["Short description"],
  row["Invoice's name"],
  row["Issued Day"],
  row.Quarter,
  row["Provider's name"],
  row["Type of services/goods"],
  row.Percentage,
  row["Total excluded VAT"],
  row["VAT amount"],
  row.Total
];

const salesRowToValues = (row: NonNullable<ProcessedInvoice["salesRow"]>) => [
  row.No,
  row["Short description"],
  row["Invoice's name"],
  row["Issued Day"],
  row.Quarter,
  row["Customer's name"],
  row["Type of services/goods"],
  row.Percentage,
  row["Total excluded VAT"],
  row["VAT amount"],
  row.Total
];

const getNextSalesNo = async (): Promise<number> => {
  const { sheets, spreadsheetId } = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SALES_TAB}!A:A`
  });

  const values = res.data.values ?? [];
  let maxNo = 0;
  for (let i = 1; i < values.length; i += 1) {
    const v = Number(values[i]?.[0]);
    if (Number.isFinite(v) && v > maxNo) maxNo = v;
  }
  return maxNo + 1;
};

export const insertValidInvoices = async (
  invoices: ProcessedInvoice[]
): Promise<InsertSummary> => {
  const valid = invoices.filter((i) => i.status === "valid");
  const purchase = valid.filter((i) => i.type === "Purchase" && i.purchaseRow);
  const sales = valid.filter((i) => i.type === "Sales" && i.salesRow);

  const summary: InsertSummary = {
    purchaseInserted: 0,
    salesInserted: 0,
    skippedForReview: invoices.filter((i) => i.status !== "valid").length,
    failed: 0
  };

  const { sheets, spreadsheetId } = await getSheetsClient();

  if (purchase.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${PURCHASE_TAB}!A:J`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: purchase
          .map((i) => i.purchaseRow)
          .filter((r): r is NonNullable<typeof r> => !!r)
          .map(purchaseRowToValues)
      }
    });
    summary.purchaseInserted = purchase.length;
  }

  if (sales.length > 0) {
    let nextNo = await getNextSalesNo();
    const salesRows = sales
      .map((i) => i.salesRow)
      .filter((r): r is NonNullable<typeof r> => !!r)
      .map((row) => ({ ...row, No: String(nextNo++) }));

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${SALES_TAB}!A:K`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: salesRows.map(salesRowToValues)
      }
    });
    summary.salesInserted = salesRows.length;
  }

  return summary;
};
