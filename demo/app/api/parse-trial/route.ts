import { ParseError, parseTrial } from "@/lib/parseTrial";

const NCT_RE = /^NCT\d{8}$/;

// In-memory IP throttle. Survives only as long as the serverless instance,
// which is the right shape for "stop a single visitor from looping" — not for
// a real abuse defense. If this gets cold-emailed widely, swap for Upstash.
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const buckets = new Map<string, number[]>();

function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (buckets.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_LIMIT) {
    buckets.set(ip, arr);
    return true;
  }
  arr.push(now);
  buckets.set(ip, arr);
  return false;
}

export const maxDuration = 30;

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ error: "server is missing ANTHROPIC_API_KEY" }, { status: 500 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const nctId = (body as Record<string, unknown> | null)?.nct_id;
  if (typeof nctId !== "string" || !NCT_RE.test(nctId)) {
    return Response.json(
      { error: "nct_id must match NCT followed by 8 digits (e.g. NCT05889650)" },
      { status: 400 },
    );
  }

  if (rateLimited(clientIp(request))) {
    return Response.json(
      { error: `rate limit hit (${RATE_LIMIT} parses per 10 min). Try one of the pre-loaded trials in the persona panel.` },
      { status: 429 },
    );
  }

  try {
    const result = await parseTrial(nctId, apiKey);
    return Response.json({
      trial: result.trial,
      skipped_criteria: result.skipped_criteria,
      ctg_status: result.status,
      attempts: result.attempts,
    });
  } catch (e) {
    const message = e instanceof ParseError ? e.message : (e as Error).message;
    return Response.json({ error: message }, { status: 502 });
  }
}
