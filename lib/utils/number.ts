export const parseNumber = (value: string | null): number | null => {
  if (!value) return null;
  const compact = value.replace(/[\s\u00A0]/g, "");
  const kept = compact.replace(/[^0-9,.-]/g, "");
  if (!kept || kept === "." || kept === "-" || kept === ",") return null;

  const sign = kept.startsWith("-") ? "-" : "";
  const unsigned = kept.replace(/-/g, "");
  let normalized = unsigned;

  const dotCount = (unsigned.match(/\./g) ?? []).length;
  const commaCount = (unsigned.match(/,/g) ?? []).length;

  if (dotCount > 0 && commaCount > 0) {
    const lastDot = unsigned.lastIndexOf(".");
    const lastComma = unsigned.lastIndexOf(",");
    const decimalSep = lastDot > lastComma ? "." : ",";
    const thousandSep = decimalSep === "." ? "," : ".";
    normalized = unsigned.replace(new RegExp(`\\${thousandSep}`, "g"), "");
    normalized = normalized.replace(decimalSep, ".");
  } else if (dotCount > 0) {
    const parts = unsigned.split(".");
    if (parts.length > 2) {
      normalized = parts.join("");
    } else {
      const frac = parts[1] ?? "";
      normalized = frac.length <= 2 ? unsigned : parts.join("");
    }
  } else if (commaCount > 0) {
    const parts = unsigned.split(",");
    if (parts.length > 2) {
      normalized = parts.join("");
    } else {
      const frac = parts[1] ?? "";
      normalized = frac.length <= 2 ? unsigned.replace(",", ".") : parts.join("");
    }
  }

  const numeric = `${sign}${normalized}`;
  if (!numeric || numeric === "." || numeric === "-") return null;
  const parsed = Number(numeric);
  return Number.isFinite(parsed) ? parsed : null;
};

export const nearlyEqual = (a: number, b: number, tolerance = 1): boolean => {
  return Math.abs(a - b) <= tolerance;
};
