// Human-readable labels for detector categories shown in notifications.
//
// The label table covers the engine's full category set; the SDK's `Category`
// type is intentionally narrower today, so lookups are keyed by string with a
// readable fallback for any category this build has not seen yet.

const CATEGORY_LABELS: Record<string, string> = {
  secret: 'Secrets & credentials',
  pii: 'Personal data (PII)',
  source_code: 'Source code',
  company_confidential: 'Company confidential',
  financial: 'Financial data',
  intellectual_property: 'Intellectual property',
  usage_policy: 'Usage policy',
  prompt_injection: 'Prompt injection',
  sensitive_document: 'Sensitive document',
  customer_data: 'Customer data',
  compliance: 'Compliance',
  keyword: 'Watched keyword',
  file_policy: 'File policy',
  image_policy: 'Image policy',
  ai_classification: 'AI classification',
  destructive_command: 'Destructive command',
  legal: 'Legal content',
  medical: 'Medical / health data',
  hr: 'HR content',
  security: 'Security material',
  research_development: 'Research & development',
  communication: 'Internal communication',
  procurement: 'Procurement & vendor data',
  government: 'Government / export-controlled',
  classification: 'Data classification',
};

/** Returns the display label for a detector category. */
export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category.replace(/_/g, ' ');
}

/** Unique, order-preserving category labels across a decision's findings. */
export function findingCategories(findings: readonly { category: string }[]): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const finding of findings) {
    if (seen.has(finding.category)) continue;
    seen.add(finding.category);
    labels.push(categoryLabel(finding.category));
  }
  return labels;
}
