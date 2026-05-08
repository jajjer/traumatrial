// In-memory cache for successful parseTrial results, keyed by NCT ID.
// Survives only as long as the serverless instance — same shape as the rate
// limiter. Trial criteria don't change often (drift monitor catches the rest)
// so a 6-hour TTL is generous and saves a lot of Claude calls on demo replay.

import type { ParsedTrialResult } from "./parseTrial";

const TTL_MS = 6 * 60 * 60 * 1000;

interface Entry {
  result: ParsedTrialResult;
  expiresAt: number;
}

const cache = new Map<string, Entry>();

export function getCachedParse(nctId: string): ParsedTrialResult | null {
  const e = cache.get(nctId);
  if (!e) return null;
  if (Date.now() > e.expiresAt) {
    cache.delete(nctId);
    return null;
  }
  return e.result;
}

export function setCachedParse(nctId: string, result: ParsedTrialResult): void {
  cache.set(nctId, { result, expiresAt: Date.now() + TTL_MS });
}
