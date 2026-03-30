const API_BASE = process.env.MAIL_SERVICE_URL ?? "http://mail-service:8025";

// ---------------------------------------------------------------------------
// Types (matching Python FastAPI backend responses)
// ---------------------------------------------------------------------------

export interface HourlyStat {
  hour: string;
  total: number;
  spam: number;
  ham: number;
}

export interface DashboardStats {
  total_today: number;
  spam_today: number;
  ham_today: number;
  quarantine_pending: number;
  spam_rate: number;
  total_week: number;
  hourly_stats: HourlyStat[];
}

export interface QuarantineItem {
  id: string;
  mail_from: string | null;
  rcpt_to: string[];
  subject: string | null;
  rspamd_score: number | null;
  final_score: number | null;
  status: string;
  body_preview: string | null;
  parsed_headers: Record<string, string> | null;
  created_at: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface LogEntry {
  id: string;
  message_id: string | null;
  mail_from: string | null;
  rcpt_to: string[];
  subject: string | null;
  direction: "inbound" | "outbound";
  action: "delivered" | "quarantined" | "rejected" | "error";
  rspamd_score: number | null;
  final_score: number | null;
  client_ip: string | null;
  created_at: string;
}

export interface Domain {
  id: string;
  domain: string;
  backend_host: string;
  backend_port: number;
  is_active: boolean;
  description: string | null;
  created_at: string;
}

export interface DomainInput {
  domain: string;
  backend_host: string;
  backend_port?: number;
  is_active?: boolean;
  description?: string | null;
}

export interface Setting {
  key: string;
  value: unknown;
  category: string;
  description: string | null;
}

export interface BulkActionResult {
  success: number;
  failed: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });

  if (!res.ok) {
    throw new Error(`API ${res.status}: ${res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

function buildQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export async function fetchStats(): Promise<DashboardStats> {
  return apiFetch<DashboardStats>("/api/stats");
}

// ---------------------------------------------------------------------------
// Quarantine
// ---------------------------------------------------------------------------

export async function fetchQuarantine(
  page = 1,
  page_size = 20,
  status = "pending",
  search = "",
): Promise<PaginatedResponse<QuarantineItem>> {
  const qs = buildQuery({ page, page_size, status, search });
  return apiFetch(`/api/quarantine${qs}`);
}

export async function fetchQuarantineItem(id: string): Promise<QuarantineItem> {
  return apiFetch(`/api/quarantine/${encodeURIComponent(id)}`);
}

export async function quarantineAction(
  id: string,
  action: "approve" | "reject",
  reviewer_id?: string,
): Promise<void> {
  await apiFetch(`/api/quarantine/${encodeURIComponent(id)}/action`, {
    method: "POST",
    body: JSON.stringify({ action, reviewer_id }),
  });
}

export async function quarantineBulkAction(
  ids: string[],
  action: "approve" | "reject",
): Promise<BulkActionResult> {
  return apiFetch("/api/quarantine/bulk", {
    method: "POST",
    body: JSON.stringify({ ids, action }),
  });
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

export async function fetchLogs(
  page = 1,
  page_size = 50,
  direction = "",
  action = "",
  search = "",
): Promise<PaginatedResponse<LogEntry>> {
  const qs = buildQuery({ page, page_size, direction, action, search });
  return apiFetch(`/api/logs${qs}`);
}

// ---------------------------------------------------------------------------
// Domains
// ---------------------------------------------------------------------------

export async function fetchDomains(): Promise<Domain[]> {
  return apiFetch("/api/domains");
}

export async function createDomain(data: DomainInput): Promise<{ id: string; domain: string }> {
  return apiFetch("/api/domains", { method: "POST", body: JSON.stringify(data) });
}

export async function updateDomain(id: string, data: DomainInput): Promise<void> {
  await apiFetch(`/api/domains/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteDomain(id: string): Promise<void> {
  await apiFetch(`/api/domains/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function fetchSettings(category?: string): Promise<Setting[]> {
  const qs = buildQuery({ category });
  return apiFetch(`/api/settings${qs}`);
}

export async function updateSetting(key: string, value: unknown): Promise<void> {
  await apiFetch(`/api/settings/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: JSON.stringify({ value }),
  });
}
