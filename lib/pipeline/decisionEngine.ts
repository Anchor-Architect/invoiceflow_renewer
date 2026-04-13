import type { FinalDecision, ValidationIssue } from "@/types/pipeline";

export const decideInvoiceStatus = (issues: ValidationIssue[]): FinalDecision => {
  const errors = issues.filter((i) => i.severity === "error");

  if (
    errors.some((e) =>
      ["required_missing", "unknown_classification", "date_invalid", "total_non_positive"].includes(e.code)
    )
  ) {
    return {
      status: "reject",
      reason: "Critical validation failures prevent reliable invoice identity"
    };
  }

  if (errors.length > 0) {
    return {
      status: "review_needed",
      reason: "Validation errors or ambiguity require human review"
    };
  }

  return {
    status: "auto_approve",
    reason: "High-confidence extraction passed deterministic checks"
  };
};
