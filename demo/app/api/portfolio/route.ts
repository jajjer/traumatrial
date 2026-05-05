import { promises as fs } from "node:fs";
import path from "node:path";

import { matchAll } from "@/lib/engine";
import { parseTrial } from "@/lib/parseTrial";
import type { MatchResult, Patient, Trial } from "@/lib/types";

const NCT_RE = /^NCT\d{8}$/;
const MAX_NCTS = 10;
const RATE_LIMIT = 2;
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

let bundlePromise: Promise<{ trials: Trial[]; patients: Patient[] }> | null = null;
function loadBundle() {
  if (!bundlePromise) {
    const trialsFile = path.join(process.cwd(), "public", "trials.json");
    const patientsFile = path.join(process.cwd(), "public", "patients.json");
    bundlePromise = Promise.all([
      fs.readFile(trialsFile, "utf8").then((s) => JSON.parse(s) as Trial[]),
      fs.readFile(patientsFile, "utf8").then((s) => JSON.parse(s) as Patient[]),
    ]).then(([trials, patients]) => ({ trials, patients }));
  }
  return bundlePromise;
}

interface PortfolioTrial {
  trial: Trial;
  source: "bundled" | "parsed";
  skipped_criteria: string[];
  parse_attempts: number;
}

interface PortfolioCoverage {
  patient_id: string;
  eligible_count: number;
  results: MatchResult[];
}

export const maxDuration = 60;

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const raw = (body as Record<string, unknown> | null)?.nct_ids;
  if (!Array.isArray(raw)) {
    return Response.json({ error: "nct_ids must be an array" }, { status: 400 });
  }
  const nctIds = Array.from(
    new Set(
      raw
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim().toUpperCase())
        .filter(Boolean),
    ),
  );
  if (nctIds.length === 0) {
    return Response.json({ error: "no NCT IDs provided" }, { status: 400 });
  }
  if (nctIds.length > MAX_NCTS) {
    return Response.json({ error: `at most ${MAX_NCTS} NCT IDs per request` }, { status: 400 });
  }
  for (const id of nctIds) {
    if (!NCT_RE.test(id)) {
      return Response.json({ error: `${id} doesn't match NCT followed by 8 digits` }, { status: 400 });
    }
  }
  if (rateLimited(clientIp(request))) {
    return Response.json(
      { error: `rate limit hit (${RATE_LIMIT} portfolios per 10 min). Heavy users should self-host the engine — see github.com/jajjer/traumatrial.` },
      { status: 429 },
    );
  }

  const { trials: bundled, patients } = await loadBundle();
  const bundledById = new Map(bundled.map((t) => [t.trial_id, t]));

  const portfolio: PortfolioTrial[] = [];
  const failures: { nct_id: string; error: string }[] = [];

  // Parse unknown trials sequentially. Each parse is a paid Claude call;
  // running them in parallel just makes a Vercel Pro account angrier.
  for (const id of nctIds) {
    const cached = bundledById.get(id);
    if (cached) {
      portfolio.push({ trial: cached, source: "bundled", skipped_criteria: [], parse_attempts: 0 });
      continue;
    }
    if (!apiKey) {
      failures.push({
        nct_id: id,
        error: "server is missing ANTHROPIC_API_KEY — only bundled trials work without a key",
      });
      continue;
    }
    try {
      const r = await parseTrial(id, apiKey);
      portfolio.push({
        trial: r.trial,
        source: "parsed",
        skipped_criteria: r.skipped_criteria,
        parse_attempts: r.attempts,
      });
    } catch (e) {
      failures.push({ nct_id: id, error: (e as Error).message });
    }
  }

  const coverage: PortfolioCoverage[] = patients.map((p) => {
    const results = matchAll(
      p,
      portfolio.map((pt) => pt.trial),
    );
    return {
      patient_id: p.patient_id,
      eligible_count: results.filter((r) => r.eligible).length,
      results,
    };
  });

  const personasCovered = coverage.filter((c) => c.eligible_count > 0).length;
  const totalSkipped = portfolio.reduce((acc, p) => acc + p.skipped_criteria.length, 0);

  return Response.json({
    portfolio,
    coverage,
    summary: {
      total_trials: portfolio.length,
      bundled_count: portfolio.filter((p) => p.source === "bundled").length,
      parsed_count: portfolio.filter((p) => p.source === "parsed").length,
      personas_covered: personasCovered,
      personas_total: patients.length,
      total_skipped_criteria: totalSkipped,
    },
    failures,
  });
}
