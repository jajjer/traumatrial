// One-line JSON logger for LLM-touching API routes. Vercel captures stdout,
// so console.log is the structured-logging story until there's a reason for
// more. Never log request bodies — keeps PII out by construction.

interface LogFields {
  route: string;
  request_id: string;
  outcome: "ok" | "rate_limited" | "bad_request" | "cache_hit" | "parse_error" | "upstream_error" | "server_error";
  latency_ms: number;
  nct_id?: string;
  nct_count?: number;
  attempts?: number;
  error?: string;
  status?: number;
}

export function newRequestId(): string {
  return crypto.randomUUID();
}

export function logEvent(fields: LogFields): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...fields }));
}
