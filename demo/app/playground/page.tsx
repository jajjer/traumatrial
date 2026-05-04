"use client";

import { useState } from "react";
import Link from "next/link";

const EXAMPLE_PATIENT = {
  patient_id: "P-CUSTOM",
  age_years: 35,
  sex: "M",
  gcs: 7,
  sbp_mmhg: 95,
  hr_bpm: 118,
  mechanism: "blunt_mvc",
  trauma_activation_level: 1,
  eta_minutes: 8,
  pregnancy_status: "not_applicable",
  anticoagulant_use: false,
  presumed_tbi: true,
  presumed_hemorrhage: false,
  presumed_intracranial_hemorrhage: true,
  spinal_injury_suspected: false,
};

const CURL_MATCH = `curl -sS -X POST https://traumatrial.vercel.app/api/match \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(EXAMPLE_PATIENT)}'`;

const CURL_PARSE = `curl -sS -X POST https://traumatrial.vercel.app/api/parse-trial \\
  -H "Content-Type: application/json" \\
  -d '{"nct_id":"NCT05889650"}'`;

export default function Playground() {
  const [patientJson, setPatientJson] = useState(
    JSON.stringify(EXAMPLE_PATIENT, null, 2),
  );
  const [response, setResponse] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null);
    setResponse(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(patientJson);
    } catch (e) {
      setError(`patient JSON did not parse: ${(e as Error).message}`);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const data = await res.json();
      setResponse(JSON.stringify(data, null, 2));
      if (!res.ok) setError(`HTTP ${res.status}`);
    } catch {
      setError("network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex flex-col flex-1">
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs tracking-[0.2em] text-slate-300">
              TRAUMATRIAL · ENGINE PLAYGROUND
            </span>
          </div>
          <Link
            href="/"
            className="font-mono text-[10px] tracking-wider text-slate-400 hover:text-slate-200"
          >
            ← BACK TO DEMO
          </Link>
        </div>
      </header>

      <div className="max-w-4xl w-full mx-auto px-6 py-10 flex flex-col gap-10">
        <section>
          <h1 className="text-3xl font-semibold text-slate-100 tracking-tight">
            Engine playground
          </h1>
          <p className="text-slate-400 mt-3 leading-relaxed max-w-2xl">
            Two HTTP endpoints back the live demo — both run the same matching
            engine you can install from{" "}
            <a
              href="https://github.com/jajjer/traumatrial"
              target="_blank"
              rel="noreferrer"
              className="text-slate-200 underline-offset-2 hover:underline"
            >
              github.com/jajjer/traumatrial
            </a>
            . Paste your own Patient JSON below, or copy one of the curl
            snippets and try it from your terminal.
          </p>
        </section>

        <section>
          <SectionHead label="POST /api/match" tagline="bundled trials → ranked MatchResult[] · returns latency" />
          <CodeBlock label="curl" content={CURL_MATCH} />

          <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="font-mono text-[10px] tracking-wider text-slate-500 mb-2">
                REQUEST · application/json
              </p>
              <textarea
                value={patientJson}
                onChange={(e) => setPatientJson(e.target.value)}
                spellCheck={false}
                rows={18}
                className="w-full px-3 py-2 rounded border border-slate-800 bg-slate-950 font-mono text-[11px] text-slate-100 focus:outline-none focus:border-slate-500 leading-relaxed"
              />
            </div>
            <div>
              <p className="font-mono text-[10px] tracking-wider text-slate-500 mb-2">
                RESPONSE
              </p>
              <pre className="w-full h-[calc(18*1.5em+16px)] overflow-auto px-3 py-2 rounded border border-slate-800 bg-slate-950 font-mono text-[11px] text-slate-200 leading-relaxed">
                {error ? <span className="text-rose-300">{error}{response ? "\n\n" + response : ""}</span> : (response ?? <span className="text-slate-600">// run a match to see the response</span>)}
              </pre>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={run}
              disabled={loading}
              className="font-mono text-[11px] tracking-wider px-4 py-2 rounded bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-50"
            >
              {loading ? "RUNNING…" : "RUN MATCH"}
            </button>
            <span className="font-mono text-[10px] text-slate-500">
              The TS engine is byte-equivalent to the Python core. Trials evaluated against: 10 bundled.
            </span>
          </div>
        </section>

        <section>
          <SectionHead
            label="POST /api/parse-trial"
            tagline="clinicaltrials.gov NCT → schema-validated Trial · rate limited"
          />
          <CodeBlock label="curl" content={CURL_PARSE} />
          <div className="mt-3 text-[12px] text-slate-400 leading-relaxed">
            The server fetches the trial from clinicaltrials.gov, sends the criteria
            text through Claude with the engine&apos;s rule schema as the contract, validates
            every output, and retries on failure (max 3 attempts). Criteria that don&apos;t fit
            the 8-operator vocabulary are surfaced as <code className="text-slate-200">skipped_criteria</code>{" "}
            rather than silently dropped. 5 calls per IP per 10 minutes.
          </div>
        </section>

        <section>
          <SectionHead label="Or skip the network" tagline="install the Python engine and embed it" />
          <CodeBlock
            label="bash"
            content={`pip install -e 'git+https://github.com/jajjer/traumatrial#egg=traumatrial-match&subdirectory=engine'`}
          />
          <CodeBlock
            label="python"
            content={`from traumatrial_match import Patient, Trial, Rule, match
result = match(patient, trial)
print(result.eligible, result.confidence)
for c in result.trace:
    print("HIT" if c.hit else "MISS", c.clause)`}
          />
        </section>
      </div>
    </main>
  );
}

function SectionHead({ label, tagline }: { label: string; tagline: string }) {
  return (
    <div className="mb-3">
      <p className="font-mono text-xs tracking-wider text-slate-200">{label}</p>
      <p className="font-mono text-[10px] text-slate-500 mt-0.5">{tagline}</p>
    </div>
  );
}

function CodeBlock({ label, content }: { label: string; content: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  }
  return (
    <div className="relative rounded-md border border-slate-800 bg-slate-950 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-800">
        <span className="font-mono text-[10px] tracking-wider text-slate-500">
          {label}
        </span>
        <button
          onClick={copy}
          className="font-mono text-[10px] tracking-wider text-slate-400 hover:text-slate-200"
        >
          {copied ? "COPIED" : "COPY"}
        </button>
      </div>
      <pre className="px-3 py-3 font-mono text-[11px] text-slate-200 overflow-auto leading-relaxed">
        {content}
      </pre>
    </div>
  );
}
