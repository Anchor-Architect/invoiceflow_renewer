const pad2 = (n: number) => String(n).padStart(2, "0");

export const normalizeInvoiceDate = (value: string | null): string | null => {
  if (!value) return null;

  const trimmed = value.trim();
  const direct = new Date(trimmed);
  if (!Number.isNaN(direct.getTime())) {
    return `${direct.getFullYear()}-${pad2(direct.getMonth() + 1)}-${pad2(direct.getDate())}`;
  }

  const match = trimmed.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (!match) return null;

  const d = Number(match[1]);
  const m = Number(match[2]);
  let y = Number(match[3]);
  if (y < 100) y += 2000;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) {
    return null;
  }
  return `${y}-${pad2(m)}-${pad2(d)}`;
};

export const quarterFromDate = (
  normalizedDate: string | null
): "Q1" | "Q2" | "Q3" | "Q4" | null => {
  if (!normalizedDate) return null;
  const month = Number(normalizedDate.split("-")[1]);
  if (!month || month < 1 || month > 12) return null;
  if (month <= 3) return "Q1";
  if (month <= 6) return "Q2";
  if (month <= 9) return "Q3";
  return "Q4";
};
