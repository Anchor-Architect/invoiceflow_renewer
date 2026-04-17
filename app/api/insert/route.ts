import { NextResponse } from "next/server";
import { insertValidInvoices } from "@/lib/google-sheets/insert";
import type { ProcessedInvoice } from "@/types/invoice";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const { invoices } = (await request.json()) as { invoices: ProcessedInvoice[] };
    if (!Array.isArray(invoices) || invoices.length === 0) {
      return NextResponse.json({ error: "No invoices provided" }, { status: 400 });
    }

    const summary = await insertValidInvoices(invoices);
    return NextResponse.json({ summary });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Insertion failed" },
      { status: 500 }
    );
  }
}
