import { promises as fs } from "node:fs";
import path from "node:path";

import { matchAll } from "@/lib/engine";
import { fromNemsisXml, NemsisParseError } from "@/lib/nemsis";
import type { Trial } from "@/lib/types";

const MAX_BYTES = 200_000;

let trialsPromise: Promise<Trial[]> | null = null;
function loadTrials(): Promise<Trial[]> {
  if (!trialsPromise) {
    const file = path.join(process.cwd(), "public", "trials.json");
    trialsPromise = fs.readFile(file, "utf8").then((s) => JSON.parse(s) as Trial[]);
  }
  return trialsPromise;
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const xml = (body as Record<string, unknown> | null)?.xml;
  if (typeof xml !== "string" || !xml.trim()) {
    return Response.json({ error: "body must include xml: string" }, { status: 400 });
  }
  if (xml.length > MAX_BYTES) {
    return Response.json(
      { error: `xml exceeds ${MAX_BYTES} bytes — strip non-PCR sections or split` },
      { status: 413 },
    );
  }

  try {
    const { patient, trace, coverage } = fromNemsisXml(xml);
    const trials = await loadTrials();
    const t0 = performance.now();
    const results = matchAll(patient, trials);
    const latency_ms = +(performance.now() - t0).toFixed(2);
    return Response.json({ patient, trace, coverage, results, latency_ms });
  } catch (e) {
    const status = e instanceof NemsisParseError ? 400 : 500;
    return Response.json({ error: (e as Error).message }, { status });
  }
}
