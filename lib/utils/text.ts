export const normalizeText = (value: string | null | undefined): string =>
  (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

export const firstItemDescription = (value: string | null): string => {
  if (!value) return "N/A";
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 80 ? `${compact.slice(0, 77)}...` : compact;
};

export const inferGoodsType = (description: string | null): "service" | "goods" => {
  const text = normalizeText(description);
  if (!text) return "goods";
  const serviceKeywords = [
    "service",
    "consult",
    "maintenance",
    "support",
    "subscription",
    "dịch vụ"
  ];
  return serviceKeywords.some((k) => text.includes(k)) ? "service" : "goods";
};
