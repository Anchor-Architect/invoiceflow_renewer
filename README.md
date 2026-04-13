# InvoiceFlow Renewer MVP

A full-stack TypeScript MVP for semi-automated invoice processing:

1. Upload up to 200 invoice PDFs (or one ZIP containing PDFs)
2. Extract text from PDF files
3. Analyze invoice content with Claude (JSON-only extraction)
4. Validate and classify invoices into `Purchase` or `Sales`
5. Surface only problematic invoices in a review panel
6. Insert only valid rows into fixed Google Sheets tabs (`Purchase`, `Sales`)

## Tech Stack

- Next.js (App Router)
- TypeScript
- Tailwind CSS
- API routes
- Claude API (`@anthropic-ai/sdk`)
- Google Sheets API (`googleapis`)
- PDF extraction (`pdf-parse`)
- ZIP extraction (`jszip`)
- Zod schema validation
- In-memory batch state store (MVP)

## Implemented Features

- Upload workflow
  - Multiple PDF upload
  - One ZIP upload with PDF extraction
  - Max 200 files per batch
  - Unsupported file rejection

- Processing pipeline per invoice
  - Extract text from PDF
  - Claude extraction with strict JSON schema parse
  - Required-field and financial validation
  - Purchase/Sales classification using your company info:
    - Company name: `CÔNG TY TNHH SAMSON PRODUCTION`
    - Tax code: `0316350473`
  - Duplicate detection within current batch
  - Review-needed routing with reason + evidence

- Real-time progress (polling)
  - Percentage
  - Processed/total
  - Stage label:
    - Uploading files
    - Extracting text
    - Analyzing invoice
    - Validating results
    - Preparing rows
    - Ready for insertion

- UI sections
  - Upload section (drag-drop + picker + selected file list)
  - Progress section
  - Result summary cards
  - Review panel (problematic invoices only)
  - Preview tables for valid Purchase and Sales rows
  - Insert section + insertion summary

- Google Sheets insertion
  - Insert only valid rows
  - Purchase rows to `Purchase` tab
  - Sales rows to `Sales` tab
  - Sales `No` auto-generated from current sheet column A max + 1

## Fixed Google Sheets Columns

The app preserves these exact fixed columns.

### Purchase tab columns
- Short description
- Invoice's name
- Issued Day
- Quarter
- Provider's name
- Type of services/goods
- Percentage
- Total excluded VAT
- VAT amount
- Total

### Sales tab columns
- No
- Short description
- Invoice's name
- Issued Day
- Quarter
- Customer's name
- Type of services/goods
- Percentage
- Total excluded VAT
- VAT amount
- Total

## Project Structure

- `app/`
  - `page.tsx` UI entry
  - `api/batches/*` upload/process/progress/insert routes
- `components/`
  - `invoice-app.tsx` main upload/review/insert UI
- `lib/`
  - `batch/processBatch.ts` orchestration + duplicate detection
  - `claude/client.ts` Claude integration + schema parsing
  - `pdf/` zip ingestion and PDF text extraction
  - `validation/validate.ts` validation rules
  - `classification/classify.ts` purchase/sales logic
  - `transform/rows.ts` Google Sheets row mapping
  - `google-sheets/` Sheets client and insertion
  - `queue/workerPool.ts` controlled concurrency
  - `storage/batchStore.ts` in-memory batch state
  - `utils/` date/number/text normalization
- `types/`
  - `invoice.ts` shared domain types
  - `schemas.ts` zod schemas for Claude output
- `prompts/`
  - `claude-invoice-extraction.txt` editable extraction prompt template

## Environment Variables

Create `.env.local` from `.env.example`:

```bash
cp .env.example .env.local
```

Required:

- `CLAUDE_API_KEY`
- `GOOGLE_CLIENT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `GOOGLE_SHEET_ID`

Optional:

- `CLAUDE_MODEL` (default: `claude-3-7-sonnet-latest`)
- `INVOICE_CONCURRENCY` (default: `5`)

### Google private key format

If your key contains newlines, keep escaped `\\n` in `.env.local`; code converts it to real newlines internally.

## Setup & Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Processing and Review Logic Summary

- Review-needed includes:
  - `Duplicate`
  - `Ambiguous`
  - `Validation error`
  - `Processing failed`
- Each problematic invoice includes:
  - file name
  - problem type
  - reason
  - evidence
  - extracted key fields
  - raw text snippet (if available)

## What Is Complete

- End-to-end MVP flow from upload to insertion
- Real invoice-oriented extraction/validation/classification pipeline
- Controlled concurrency worker pool
- Review-only panel for exceptions
- Strict fixed-tab row mapping for Google Sheets

## What Is Optional / Future Improvement

- Persistent DB for batch state (current MVP uses in-memory storage)
- Server push (SSE/WebSocket) instead of polling
- Duplicate checks against existing sheet rows (currently only intra-batch duplicate detection is implemented)
- Manual approval UI for promoting review-needed rows into valid rows
- Auth, user isolation, and audit logging

