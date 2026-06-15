export * from "./auth";

export type Decision = "allow" | "warn" | "block";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type Severity = "low" | "medium" | "high" | "critical";
export type DeviceStatus = "active" | "inactive" | "deactivated";
export type Source = "browser" | "ide" | "cli" | "api";
export type PolicyStatus = "draft" | "active" | "superseded" | "rollback";
export type ExceptionStatus = "pending" | "approved" | "rejected" | "expired" | "revoked";
export type ChainStatus = "verified" | "broken" | "incomplete" | "unknown";

/**
 * Policy categories — snake_case wire names as emitted by the policy engine
 * (pe-core `Category`), with their display labels.
 */
export const CATEGORIES = [
  { value: "secret", label: "Secret" },
  { value: "pii", label: "PII" },
  { value: "source_code", label: "Source Code" },
  { value: "classification", label: "Classification" },
  { value: "company_confidential", label: "Company Confidential" },
  { value: "financial", label: "Financial" },
  { value: "intellectual_property", label: "Intellectual Property" },
  { value: "usage_policy", label: "Usage Policy" },
  { value: "prompt_injection", label: "Prompt Injection" },
  { value: "sensitive_document", label: "Sensitive Document" },
  { value: "customer_data", label: "Customer Data" },
  { value: "compliance", label: "Compliance" },
  { value: "keyword", label: "Keyword" },
  { value: "file_policy", label: "File Policy" },
  { value: "image_policy", label: "Image Policy" },
  { value: "ai_classification", label: "AI Classification" },
  { value: "destructive_command", label: "Destructive Command" },
  { value: "legal", label: "Legal" },
  { value: "medical", label: "Medical" },
  { value: "hr", label: "HR" },
  { value: "security", label: "Security" },
  { value: "research_development", label: "Research & Development" },
  { value: "communication", label: "Communication" },
  { value: "procurement", label: "Procurement" },
  { value: "government", label: "Government" },
] as const;

export type Category = (typeof CATEGORIES)[number]["value"];

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.value, c.label])
);

/** Display label for a category wire name (falls back to the raw value). */
export function categoryLabel(category: string | null | undefined): string {
  if (!category) return "—";
  return CATEGORY_LABELS[category] ?? category;
}

export interface Device {
  device_id: string;
  hostname: string;
  platform: string;
  agent_version: string;
  /** Hardware model, e.g. "MacBookPro18,3" (absent when the connector can't read it). */
  model?: string | null;
  /** OS version string, e.g. "macOS 15.5 (24F74)". */
  os_version?: string | null;
  /** OS user observed at registration. */
  last_user?: string | null;
  /** Client IP observed by the server at registration. */
  ip_address?: string | null;
  connector_versions: {
    browser: string | null;
    ide: string | null;
    cli: string | null;
  };
  status: DeviceStatus;
  registered_at_ms: number;
  last_seen_ms: number | null;
  last_event_ms: number | null;
  event_count_24h: number;
  violation_count_24h: number;
  chain_status: ChainStatus;
}

/** One running process/app from the device agent's inventory snapshot. */
export interface DeviceProcess {
  pid: number;
  name: string;
  user?: string | null;
  /** Process start timestamp (ms since epoch). */
  started_at_ms?: number | null;
  /** True when this is a GUI application rather than a background process. */
  is_app?: boolean;
  /** Full command line (capped by the agent; absent when unreadable). */
  command?: string | null;
  /** AI classification (ai_ide / ai_cli / ai_desktop / browser). */
  ai_category?: string | null;
  /** "running" | "installed" (absent = running, for old snapshots). */
  status?: string | null;
}

/** One installed browser extension from the device agent's inventory snapshot. */
export interface BrowserExtension {
  browser: string;
  extension_id?: string | null;
  name: string;
  version?: string | null;
}

/** Latest process/extension snapshot reported by a device agent. */
export interface DeviceInventory {
  device_id: string;
  collected_at_ms: number;
  processes: DeviceProcess[];
  extensions: BrowserExtension[];
}

/** One row of a device's audit-event timeline (same shape as audit search rows). */
export interface DeviceEvent {
  event_id: string;
  device_id: string;
  timestamp_ms: number;
  decision: string;
  risk_level: string;
  event_type: string;
  category: string | null;
  reason: string | null;
}

export interface PolicySummary {
  policy_id: string;
  version: number;
  name: string;
  status: PolicyStatus;
  default_action: Decision;
  org_id: string;
  created_at: string;
  published_at: string | null;
  rule_count: number;
}

export interface Violation {
  event_id: string;
  timestamp_ms: number;
  user_id: string;
  device_id: string;
  source: string | null;
  provider: string | null;
  model: string | null;
  decision: Decision;
  risk_level: RiskLevel;
  classification: string;
  policy_version: number;
  matched_rule_id: string | null;
  category: string | null;
  reason: string | null;
}

export interface ViolationFinding {
  detector_id: string;
  category: string;
  kind: string;
  severity: Severity;
  redacted_preview: string;
}

export interface Exception {
  exception_id: string;
  org_id: string;
  rule_id: string;
  policy_version: number;
  reason: string;
  requested_by: string;
  status: ExceptionStatus;
  approved_by: string | null;
  expires_at_ms: number | null;
}

export interface AuditEvent {
  event_id: string;
  timestamp_ms: number;
  type: string;
  user_id: string;
  device_id: string;
  source: string | null;
  provider: string | null;
  decision: Decision;
  risk_level: RiskLevel;
  category: string | null;
  reason: string | null;
  event_hash: string;
  previous_event_hash: string | null;
}

/** Warn/block counts for one policy category. */
export interface CategoryCount {
  category: string;
  warn: number;
  block: number;
}

export interface DashboardStats {
  total_devices: number;
  active_devices: number;
  total_violations_24h: number;
  violations_by_severity: Record<Severity, number>;
  violations_by_category: CategoryCount[];
  events_24h: number;
  events_by_decision: Record<Decision, number>;
  policies_active: number;
  pending_exceptions: number;
  recent_violations: Violation[];
}

export interface Pagination {
  page: number;
  per_page: number;
  total: number;
  next_token: string | null;
}