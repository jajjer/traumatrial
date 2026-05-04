import { promises as fs } from "node:fs";
import path from "node:path";

import { matchAll } from "@/lib/engine";
import type { Trial } from "@/lib/types";
import { validatePatient } from "@/lib/validatePatient";

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

  const v = validatePatient(body);
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });

  const trials = await loadTrials();
  const results = matchAll(v.patient, trials);
  return Response.json({ patient: v.patient, results });
}
