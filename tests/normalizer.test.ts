import { describe, expect, it } from "vitest";
import { normalizeDate, normalizeMoney, normalizeTaxCode } from "@/lib/pipeline/normalizer";

describe("number normalization", () => {
  it("normalizes Vietnamese thousand separator dots", () => {
    expect(normalizeMoney("1.180.000")).toBe(1180000);
  });

  it("normalizes comma separators", () => {
    expect(normalizeMoney("1,180,000")).toBe(1180000);
  });

  it("normalizes spaces", () => {
    expect(normalizeMoney("1 180 000")).toBe(1180000);
  });

  it("supports plain numeric", () => {
    expect(normalizeMoney("1180000")).toBe(1180000);
  });
});

describe("date normalization", () => {
  it("parses dd/mm/yyyy", () => {
    expect(normalizeDate("12/03/2025")).toBe("2025-03-12");
  });

  it("parses dd-mm-yyyy", () => {
    expect(normalizeDate("12-03-2025")).toBe("2025-03-12");
  });

  it("parses yyyy-mm-dd", () => {
    expect(normalizeDate("2025-03-12")).toBe("2025-03-12");
  });

  it("returns null for impossible date", () => {
    expect(normalizeDate("31/02/2025")).toBeNull();
  });
});

describe("tax code normalization", () => {
  it("removes separators", () => {
    expect(normalizeTaxCode("0316 350 473")).toBe("0316350473");
  });

  it("returns null on empty", () => {
    expect(normalizeTaxCode("   ")).toBeNull();
  });
});
