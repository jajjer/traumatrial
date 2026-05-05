"use client";

import { useEffect, useState } from "react";

import { matchAll } from "../lib/engine";
import type {
  ClauseTrace,
  Mechanism,
  MatchResult,
  Patient,
  PatientMatchPayload,
  PregnancyStatus,
  Sex,
  Trial,
} from "../lib/types";

const PATIENT_IDS = [
  "P-001",
  "P-002",
  "P-003",
  "P-004",
  "P-005",
  "P-006",
  "P-007",
  "P-008",
  "P-009",
  "P-010",
  "P-011",
  "P-012",
  "P-013",
];

const MECHANISM_LABEL: Record<string, string> = {
  blunt_mvc: "Blunt — MVC",
  blunt_other: "Blunt",
  fall: "Fall",
  gsw: "GSW",
  stab: "Stab",
  blast: "Blast",
  burn: "Burn",
  cardiac_arrest: "Cardiac arrest",
  head_strike: "Head strike",
  crush: "Crush",
  other: "Other",
};

export default function Home() {
  const [trials, setTrials] = useState<Trial[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [active, setActive] = useState<PatientMatchPayload | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/trials.json").then((r) => r.json() as Promise<Trial[]>),
      fetch("/patients.json").then((r) => r.json() as Promise<Patient[]>),
    ])
      .then(([t, p]) => {
        setTrials(t);
        setPatients(p);
      })
      .catch(() => {
        // public/ fetches are static — never block the UI on a transient failure
      })
      .finally(() => {
        setLoaded(true);
      });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(id);
  }, [toast]);

  async function simulate(patientId?: string) {
    const id =
      patientId ?? PATIENT_IDS[Math.floor(Math.random() * PATIENT_IDS.length)];
    setLoading(true);
    try {
      const res = await fetch(`/matches/${id}.json`);
      const payload = (await res.json()) as PatientMatchPayload;
      setActive(payload);
    } finally {
      setLoading(false);
    }
  }

  async function simulateCustom(patient: Patient) {
    setLoading(true);
    try {
      const res = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patient),
      });
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({ error: "request failed" }))) as { error?: string };
        setToast(`Match failed: ${error ?? res.status}`);
        return;
      }
      const payload = (await res.json()) as PatientMatchPayload;
      setActive(payload);
    } catch {
      setToast("Match failed: network error");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setActive(null);
  }

  function trialFor(trialId: string): Trial | undefined {
    return trials.find((t) => t.trial_id === trialId);
  }

  return (
    <main className="flex flex-col flex-1">
      <StatusBar
        active={!!active}
        patientCount={patients.length}
        trialCount={trials.length}
        loaded={loaded}
      />

      <div className="flex-1 flex flex-col items-center px-6 py-10 max-w-6xl w-full mx-auto">
        {!active ? (
          <IdleScreen
            onSimulate={simulate}
            onSimulateCustom={simulateCustom}
            loading={loading}
            patients={patients}
            trials={trials}
          />
        ) : (
          <ActiveScreen
            payload={active}
            trialFor={trialFor}
            onAcknowledge={(label) => {
              setToast(`Coordinator paged: ${label}`);
              window.setTimeout(reset, 800);
            }}
            onDismiss={reset}
          />
        )}
      </div>

      {toast && <Toast text={toast} />}
      <Footer />
    </main>
  );
}

function StatusBar({
  active,
  patientCount,
  trialCount,
  loaded,
}: {
  active: boolean;
  patientCount: number;
  trialCount: number;
  loaded: boolean;
}) {
  return (
    <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span
            className={`inline-block w-2.5 h-2.5 rounded-full pulse-dot ${
              active ? "bg-rose-500" : "bg-emerald-500"
            }`}
            aria-hidden
          />
          <span className="font-mono text-xs tracking-[0.2em] text-slate-300">
            TRAUMATRIAL
          </span>
          <span className="font-mono text-[10px] tracking-widest text-slate-500 hidden sm:inline">
            v0 · DEMO ONLY · SYNTHETIC DATA
          </span>
        </div>
        <div className="font-mono text-[11px] text-slate-400 hidden sm:block">
          {loaded
            ? `${trialCount} active trials · ${patientCount} simulated arrivals`
            : " "}
        </div>
      </div>
    </header>
  );
}

function IdleScreen({
  onSimulate,
  onSimulateCustom,
  loading,
  patients,
  trials,
}: {
  onSimulate: (id?: string) => void;
  onSimulateCustom: (p: Patient) => void;
  loading: boolean;
  patients: Patient[];
  trials: Trial[];
}) {
  type AdvancedTab = "form" | "nemsis" | "parse" | "portfolio";
  const [tab, setTab] = useState<AdvancedTab | null>(null);
  return (
    <div className="flex flex-col items-center gap-12 mt-12">
      <div className="text-center max-w-2xl">
        <p className="font-mono text-xs tracking-[0.2em] text-slate-500 mb-3">
          REAL-TIME TRAUMA TRIAL ELIGIBILITY MATCHING
        </p>
        <h1 className="text-3xl sm:text-4xl font-semibold text-slate-100 tracking-tight leading-tight">
          Trauma patients die who could have been saved by drugs already in trials.
        </h1>
        <p className="text-slate-400 mt-4 leading-relaxed">
          The consent window for an unconscious patient is minutes, not days. Coordinators
          can&apos;t comb through 20 active protocols in time. This demo matches a trauma
          bay arrival against a portfolio of real{" "}
          <a
            href="https://clinicaltrials.gov"
            target="_blank"
            rel="noreferrer"
            className="text-slate-300 underline-offset-2 hover:underline"
          >
            clinicaltrials.gov
          </a>{" "}
          studies in under 100ms, with a clause-level reasoning trace so the coordinator can
          trust what they&apos;re paged about.
        </p>
        <p className="text-slate-500 mt-3 text-sm leading-relaxed">
          Pick a persona, build a custom patient, paste a NEMSIS v3.5 ePCR, or feed any
          clinicaltrials.gov NCT — everything runs through the same matching engine
          in well under a millisecond.
        </p>
      </div>

      <button
        onClick={() => onSimulate()}
        disabled={loading}
        className="group relative flex flex-col items-center justify-center w-72 h-72 rounded-full bg-gradient-to-br from-rose-600 to-rose-700 text-white shadow-[0_0_60px_-15px_rgba(244,63,94,0.6)] hover:shadow-[0_0_80px_-10px_rgba(244,63,94,0.85)] transition-all hover:scale-[1.02] active:scale-[0.99] disabled:opacity-50 disabled:cursor-wait"
      >
        <span className="font-mono text-[10px] tracking-[0.3em] text-rose-200 mb-2">
          PRESS TO SIMULATE
        </span>
        <span className="text-2xl font-semibold tracking-tight">
          PATIENT ARRIVAL
        </span>
        <span className="text-xs text-rose-200/80 mt-3 max-w-[180px] text-center">
          Random persona from the test cohort
        </span>
      </button>

      {patients.length > 0 && (
        <div className="w-full max-w-3xl">
          <p className="font-mono text-[10px] tracking-[0.2em] text-slate-500 mb-3 text-center">
            OR PICK A SPECIFIC PERSONA
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {patients.map((p) => (
              <button
                key={p.patient_id}
                onClick={() => onSimulate(p.patient_id)}
                disabled={loading}
                className="text-left p-3 rounded-md border border-slate-800 hover:border-slate-600 bg-slate-900/40 hover:bg-slate-900 transition disabled:opacity-50"
              >
                <div className="font-mono text-xs text-slate-300">
                  {p.patient_id}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {p.age_years}
                  {p.sex} · {MECHANISM_LABEL[p.mechanism] ?? p.mechanism} · GCS{" "}
                  {p.gcs}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="w-full max-w-3xl">
        <div className="border-t border-slate-800 pt-6">
          <p className="font-mono text-[10px] tracking-[0.2em] text-slate-500 mb-3 text-center">
            OR DRIVE THE ENGINE YOURSELF
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <TabButton active={tab === "form"} onClick={() => setTab(tab === "form" ? null : "form")}>
              <span className="block font-medium text-slate-200">Custom patient</span>
              <span className="block text-[10px] text-slate-500 mt-0.5">vitals & flags form</span>
            </TabButton>
            <TabButton active={tab === "nemsis"} onClick={() => setTab(tab === "nemsis" ? null : "nemsis")}>
              <span className="block font-medium text-slate-200">NEMSIS XML</span>
              <span className="block text-[10px] text-slate-500 mt-0.5">paste an ePCR</span>
            </TabButton>
            <TabButton active={tab === "parse"} onClick={() => setTab(tab === "parse" ? null : "parse")}>
              <span className="block font-medium text-slate-200">Parse NCT</span>
              <span className="block text-[10px] text-slate-500 mt-0.5">live LLM extraction</span>
            </TabButton>
            <TabButton active={tab === "portfolio"} onClick={() => setTab(tab === "portfolio" ? null : "portfolio")}>
              <span className="block font-medium text-slate-200">Portfolio</span>
              <span className="block text-[10px] text-slate-500 mt-0.5">coverage matrix</span>
            </TabButton>
          </div>
          {tab === "form" && (
            <CustomPatientForm onSubmit={onSimulateCustom} loading={loading} />
          )}
          {tab === "nemsis" && <NemsisPanel trials={trials} />}
          {tab === "parse" && <ParseTrialPanel patients={patients} />}
          {tab === "portfolio" && <PortfolioPanel />}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left p-3 rounded-md border transition ${
        active
          ? "border-rose-700/70 bg-rose-950/30"
          : "border-slate-800 hover:border-slate-600 bg-slate-900/40 hover:bg-slate-900"
      }`}
    >
      {children}
    </button>
  );
}

const DEFAULT_PATIENT: Patient = {
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

function CustomPatientForm({
  onSubmit,
  loading,
}: {
  onSubmit: (p: Patient) => void;
  loading: boolean;
}) {
  const [p, setP] = useState<Patient>(DEFAULT_PATIENT);
  function set<K extends keyof Patient>(k: K, v: Patient[K]) {
    setP((cur) => ({ ...cur, [k]: v }));
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(p);
      }}
      className="mt-4 rounded-lg border border-slate-800 bg-slate-900/40 p-5 fade-in"
    >
      <p className="font-mono text-[10px] tracking-[0.2em] text-slate-500 mb-4">
        VITALS &amp; SCORES
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
        <NumField label="Age (yrs)" value={p.age_years} min={0} max={120} onChange={(v) => set("age_years", v)} />
        <NumField label="GCS" value={p.gcs} min={3} max={15} onChange={(v) => set("gcs", v)} />
        <NumField label="SBP (mmHg)" value={p.sbp_mmhg} min={0} max={300} onChange={(v) => set("sbp_mmhg", v)} />
        <NumField label="HR (bpm)" value={p.hr_bpm} min={0} max={300} onChange={(v) => set("hr_bpm", v)} />
        <NumField label="ETA (min)" value={p.eta_minutes} min={0} max={480} onChange={(v) => set("eta_minutes", v)} />
        <SelectField
          label="Activation"
          value={String(p.trauma_activation_level)}
          options={[["1", "Level 1 (highest)"], ["2", "Level 2"], ["3", "Level 3"]]}
          onChange={(v) => set("trauma_activation_level", Number(v))}
        />
      </div>

      <p className="font-mono text-[10px] tracking-[0.2em] text-slate-500 mb-4">
        DEMOGRAPHICS &amp; MECHANISM
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <SelectField
          label="Sex"
          value={p.sex}
          options={[["M", "Male"], ["F", "Female"], ["U", "Unknown"]]}
          onChange={(v) => set("sex", v as Sex)}
        />
        <SelectField
          label="Mechanism"
          value={p.mechanism}
          options={Object.entries(MECHANISM_LABEL) as [Mechanism, string][]}
          onChange={(v) => set("mechanism", v as Mechanism)}
        />
        <SelectField
          label="Pregnancy"
          value={p.pregnancy_status}
          options={[
            ["not_applicable", "N/A"],
            ["not_pregnant", "Not pregnant"],
            ["pregnant", "Pregnant"],
            ["unknown_could_be_pregnant", "Unknown / possible"],
          ]}
          onChange={(v) => set("pregnancy_status", v as PregnancyStatus)}
        />
      </div>

      <p className="font-mono text-[10px] tracking-[0.2em] text-slate-500 mb-3">
        CONDITIONS
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-5">
        <BoolField label="Anticoagulant use" value={p.anticoagulant_use} onChange={(v) => set("anticoagulant_use", v)} />
        <BoolField label="Presumed TBI" value={p.presumed_tbi} onChange={(v) => set("presumed_tbi", v)} />
        <BoolField label="Presumed hemorrhage" value={p.presumed_hemorrhage} onChange={(v) => set("presumed_hemorrhage", v)} />
        <BoolField label="Presumed ICH" value={p.presumed_intracranial_hemorrhage} onChange={(v) => set("presumed_intracranial_hemorrhage", v)} />
        <BoolField label="Spinal injury suspected" value={p.spinal_injury_suspected} onChange={(v) => set("spinal_injury_suspected", v)} />
      </div>

      <div className="flex items-center justify-between gap-3 pt-3 border-t border-slate-800">
        <p className="font-mono text-[10px] text-slate-500">
          Submits to <code className="text-slate-300">POST /api/match</code> · live engine
        </p>
        <button
          type="submit"
          disabled={loading}
          className="font-mono text-[11px] tracking-wider px-4 py-2 rounded bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-50"
        >
          {loading ? "MATCHING…" : "RUN MATCH"}
        </button>
      </div>
    </form>
  );
}

function NumField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] tracking-wider text-slate-500 uppercase">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full px-2 py-1.5 rounded border border-slate-800 bg-slate-950 font-mono text-sm text-slate-100 focus:outline-none focus:border-slate-500"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="font-mono text-[10px] tracking-wider text-slate-500 uppercase">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full px-2 py-1.5 rounded border border-slate-800 bg-slate-950 font-mono text-sm text-slate-100 focus:outline-none focus:border-slate-500"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function BoolField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 px-2 py-1.5 rounded border border-slate-800 bg-slate-950 cursor-pointer hover:border-slate-700">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-rose-500"
      />
      <span className="text-xs text-slate-200">{label}</span>
    </label>
  );
}

interface ParsedTrialResponse {
  trial: Trial;
  skipped_criteria: string[];
  ctg_status: string;
  attempts: number;
}

function ParseTrialPanel({ patients }: { patients: Patient[] }) {
  const [nctId, setNctId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedTrialResponse | null>(null);
  const [showMatches, setShowMatches] = useState(false);

  async function parse() {
    setError(null);
    setParsed(null);
    setShowMatches(false);
    setLoading(true);
    try {
      const res = await fetch("/api/parse-trial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nct_id: nctId.trim().toUpperCase() }),
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        setError((data.error as string | undefined) ?? `request failed (${res.status})`);
        return;
      }
      setParsed(data as unknown as ParsedTrialResponse);
    } catch {
      setError("network error reaching /api/parse-trial");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900/40 p-5 fade-in">
      <p className="font-mono text-[10px] tracking-[0.2em] text-slate-500 mb-2">
        LIVE PARSE — clinicaltrials.gov ID → engine rules
      </p>
      <p className="text-[12px] text-slate-400 leading-relaxed mb-3">
        The parser fetches the trial from clinicaltrials.gov, sends the eligibility text
        through Claude with the engine&apos;s rule schema as the contract, and validates
        every output. Criteria that don&apos;t fit the schema (lab values, temporal logic, etc.)
        are surfaced as <span className="text-slate-300">skipped</span> rather than silently dropped.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          parse();
        }}
        className="flex flex-col sm:flex-row gap-2"
      >
        <input
          type="text"
          value={nctId}
          onChange={(e) => setNctId(e.target.value)}
          placeholder="NCT05889650"
          spellCheck={false}
          className="flex-1 px-3 py-2 rounded border border-slate-800 bg-slate-950 font-mono text-sm text-slate-100 focus:outline-none focus:border-slate-500"
        />
        <button
          type="submit"
          disabled={loading || !nctId.trim()}
          className="font-mono text-[11px] tracking-wider px-4 py-2 rounded bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-50"
        >
          {loading ? "PARSING…" : "PARSE LIVE"}
        </button>
      </form>
      <p className="font-mono text-[10px] text-slate-500 mt-2">
        Try any recruiting trial not in the demo set, e.g.{" "}
        <button type="button" className="text-slate-300 underline-offset-2 hover:underline" onClick={() => setNctId("NCT04573114")}>NCT04573114</button>.
        Takes 5-20s.
      </p>

      {error && (
        <p className="mt-3 font-mono text-[11px] text-rose-300 bg-rose-950/30 border border-rose-900/60 rounded p-3">
          {error}
        </p>
      )}

      {parsed && (
        <div className="mt-4 fade-in">
          <ParsedTrialDisplay parsed={parsed} />
          <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-2">
            <button
              onClick={() => setShowMatches((s) => !s)}
              className="font-mono text-[11px] tracking-wider px-3 py-2 rounded bg-emerald-700 hover:bg-emerald-600 text-white"
            >
              {showMatches ? "HIDE PERSONA RESULTS" : "MATCH AGAINST ALL 8 PERSONAS"}
            </button>
            <span className="font-mono text-[10px] text-slate-500">
              Runs locally — same engine, no extra API call
            </span>
          </div>
          {showMatches && (
            <ParsedTrialMatches trial={parsed.trial} patients={patients} />
          )}
        </div>
      )}
    </div>
  );
}

function ParsedTrialDisplay({ parsed }: { parsed: ParsedTrialResponse }) {
  const t = parsed.trial;
  const inclusion = t.inclusion as { field: string; op: string; value: unknown; hard: boolean }[];
  const exclusion = t.exclusion as { field: string; op: string; value: unknown; hard: boolean }[];
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950/60 p-4">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="font-mono text-xs text-slate-200">{t.short_name}</span>
        <span className="font-mono text-[10px] text-slate-500">{t.trial_id}</span>
        <span className="font-mono text-[10px] text-slate-500">phase {t.phase}</span>
        <span className="font-mono text-[10px] text-slate-500">CTG status: {parsed.ctg_status}</span>
        {t.requires_efic && (
          <span className="font-mono text-[10px] tracking-wider px-1.5 py-0.5 rounded bg-rose-900/60 text-rose-200 border border-rose-800">
            EFIC
          </span>
        )}
        {parsed.attempts > 1 && (
          <span className="font-mono text-[10px] tracking-wider px-1.5 py-0.5 rounded bg-amber-900/60 text-amber-200 border border-amber-800">
            recovered after {parsed.attempts} attempts
          </span>
        )}
      </div>
      <p className="text-sm text-slate-300 leading-snug mb-4">{t.title}</p>

      <RuleList label="INCLUSION" rules={inclusion} accent="emerald" />
      <RuleList label="EXCLUSION" rules={exclusion} accent="rose" />

      {parsed.skipped_criteria.length > 0 && (
        <div className="mt-4 pt-3 border-t border-slate-800">
          <p className="font-mono text-[10px] tracking-wider text-slate-500 mb-2">
            SKIPPED — couldn&apos;t fit the schema, surfaced for human review
          </p>
          <ul className="space-y-1.5">
            {parsed.skipped_criteria.map((s, i) => (
              <li key={i} className="text-[11px] text-slate-400 leading-snug">
                <span className="text-slate-600">·</span> {s}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function RuleList({
  label,
  rules,
  accent,
}: {
  label: string;
  rules: { field: string; op: string; value: unknown; hard: boolean }[];
  accent: "emerald" | "rose";
}) {
  if (rules.length === 0) return null;
  const dotCls = accent === "emerald" ? "text-emerald-400" : "text-rose-400";
  return (
    <div className="mb-3">
      <p className="font-mono text-[10px] tracking-wider text-slate-500 mb-1.5">{label}</p>
      <ul className="space-y-1">
        {rules.map((r, i) => (
          <li key={i} className="grid grid-cols-[14px_1fr_auto] items-center gap-2 font-mono text-[11px]">
            <span className={dotCls}>{r.hard ? "■" : "□"}</span>
            <span className="text-slate-200 truncate">
              {r.field} {r.op} {formatValue(r.value)}
            </span>
            <span className="text-slate-500 text-[10px]">{r.hard ? "hard" : "soft"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ParsedTrialMatches({ trial, patients }: { trial: Trial; patients: Patient[] }) {
  if (patients.length === 0) {
    return (
      <p className="mt-3 text-[11px] text-slate-500 font-mono">
        No personas loaded yet — refresh once the persona panel appears above.
      </p>
    );
  }
  const rows = patients.map((p) => {
    const [r] = matchAll(p, [trial]);
    return { patient: p, result: r };
  });
  const eligibleCount = rows.filter((r) => r.result.eligible).length;
  return (
    <div className="mt-3 rounded-md border border-slate-800 bg-slate-950/60 p-4 fade-in">
      <p className="font-mono text-[10px] tracking-wider text-slate-500 mb-3">
        {eligibleCount} / {rows.length} personas eligible
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {rows.map((row) => {
          const eligible = row.result.eligible;
          const conf = Math.round(row.result.confidence * 100);
          const reason = !eligible ? firstFailingHardClause(row.result.trace) : null;
          return (
            <div
              key={row.patient.patient_id}
              className={`rounded border p-2.5 ${
                eligible
                  ? "border-emerald-800/60 bg-emerald-950/20"
                  : "border-slate-800 bg-slate-900/40"
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="font-mono text-xs text-slate-200">{row.patient.patient_id}</span>
                <span
                  className={`font-mono text-[9px] tracking-wider px-1.5 py-0.5 rounded ${
                    eligible
                      ? "bg-emerald-900/60 text-emerald-200"
                      : "bg-slate-800 text-slate-400"
                  }`}
                >
                  {eligible ? `ELIGIBLE · ${conf}%` : "EXCLUDED"}
                </span>
              </div>
              <p className="text-[10px] text-slate-500 font-mono">
                {row.patient.age_years}
                {row.patient.sex} · GCS {row.patient.gcs} · SBP {row.patient.sbp_mmhg}
              </p>
              {reason && (
                <p className="mt-1 text-[10px] text-rose-300/80 font-mono truncate">
                  ✗ {reason.clause}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface NemsisFieldExtraction {
  field: string;
  source: "extracted" | "inferred" | "defaulted" | "skipped";
  value: unknown;
  nemsis_path?: string | null;
  raw?: string | null;
  notes?: string | null;
}

interface NemsisResponse {
  patient: Patient;
  trace: { extractions: NemsisFieldExtraction[] };
  results: MatchResult[];
  latency_ms: number;
}

const SAMPLE_NEMSIS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<EMSDataSet xmlns="http://www.nemsis.org">
  <Header><Source>synthetic-sample</Source></Header>
  <PatientCareReport>
    <eRecord>
      <eRecord.01>SYN-DEMO-HEMORRHAGE</eRecord.01>
    </eRecord>
    <ePatient>
      <ePatient.13>9906003</ePatient.13>
      <ePatient.15>34</ePatient.15>
      <ePatient.16>2516001</ePatient.16>
    </ePatient>
    <eHistory>
      <eHistory.06>None</eHistory.06>
      <eHistory.16>3133003</eHistory.16>
    </eHistory>
    <eVitals>
      <eVitalsGroup>
        <eVitals.01>2026-05-04T13:14:11-05:00</eVitals.01>
        <eVitals.06>120</eVitals.06>
        <eVitals.10>104</eVitals.10>
        <eVitals.23>9</eVitals.23>
      </eVitalsGroup>
      <eVitalsGroup>
        <eVitals.01>2026-05-04T13:21:43-05:00</eVitals.01>
        <eVitals.06>82</eVitals.06>
        <eVitals.10>128</eVitals.10>
        <eVitals.23>7</eVitals.23>
      </eVitalsGroup>
    </eVitals>
    <eSituation>
      <eSituation.02>V43.5XXA</eSituation.02>
    </eSituation>
  </PatientCareReport>
</EMSDataSet>
`;

function NemsisPanel({ trials }: { trials: Trial[] }) {
  const [xml, setXml] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<NemsisResponse | null>(null);

  async function run() {
    setError(null);
    setData(null);
    if (!xml.trim()) {
      setError("paste an XML PCR or click 'use sample'");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/from-nemsis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ xml }),
      });
      const body = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        setError((body.error as string | undefined) ?? `request failed (${res.status})`);
        return;
      }
      setData(body as unknown as NemsisResponse);
    } catch {
      setError("network error reaching /api/from-nemsis");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900/40 p-5 fade-in">
      <p className="font-mono text-[10px] tracking-[0.2em] text-slate-500 mb-2">
        NEMSIS v3.5 ePCR → ENGINE PATIENT
      </p>
      <p className="text-[12px] text-slate-400 leading-relaxed mb-3">
        NEMSIS v3.5 is the standard prehospital data format used by US EMS (~3000 ePCR
        vendors). The adapter pulls the high-signal eFields (ePatient.13/15, eVitals.06/10/23,
        eSituation.02, eHistory.06/16) and surfaces every value with a field-level trace —
        extracted, inferred, defaulted, or skipped — so a coordinator can see exactly how the
        Patient was built. <em>v0 mapping; not a clinical-grade extractor.</em>
      </p>

      <textarea
        value={xml}
        onChange={(e) => setXml(e.target.value)}
        rows={8}
        spellCheck={false}
        placeholder="<EMSDataSet xmlns='http://www.nemsis.org'> ... </EMSDataSet>"
        className="w-full px-3 py-2 rounded border border-slate-800 bg-slate-950 font-mono text-[11px] text-slate-100 focus:outline-none focus:border-slate-500 leading-relaxed"
      />
      <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2">
        <button
          type="button"
          onClick={() => setXml(SAMPLE_NEMSIS_XML)}
          className="font-mono text-[10px] tracking-wider px-3 py-2 rounded border border-slate-700 text-slate-300 hover:bg-slate-800/40"
        >
          USE SAMPLE
        </button>
        <button
          onClick={run}
          disabled={loading}
          className="font-mono text-[11px] tracking-wider px-4 py-2 rounded bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-50"
        >
          {loading ? "CONVERTING…" : "CONVERT & MATCH"}
        </button>
        <span className="font-mono text-[10px] text-slate-500">
          Synthetic data only. Never paste real PCR data.
        </span>
      </div>

      {error && (
        <p className="mt-3 font-mono text-[11px] text-rose-300 bg-rose-950/30 border border-rose-900/60 rounded p-3">
          {error}
        </p>
      )}

      {data && <NemsisResults data={data} trials={trials} />}
    </div>
  );
}

function NemsisResults({ data, trials }: { data: NemsisResponse; trials: Trial[] }) {
  const counts = data.trace.extractions.reduce(
    (acc, e) => ({ ...acc, [e.source]: (acc[e.source as keyof typeof acc] || 0) + 1 }),
    { extracted: 0, inferred: 0, defaulted: 0, skipped: 0 } as Record<string, number>,
  );
  const eligibleCount = data.results.filter((r) => r.eligible).length;
  const trialFor = (id: string) => trials.find((t) => t.trial_id === id);

  return (
    <div className="mt-5 fade-in flex flex-col gap-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Extracted" value={`${counts.extracted}`} sub="from XML" accent="emerald" />
        <Stat label="Inferred" value={`${counts.inferred}`} sub="by rule" accent="amber" />
        <Stat label="Defaulted" value={`${counts.defaulted}`} sub="missing in source" />
        <Stat
          label="Eligible trials"
          value={`${eligibleCount} / ${data.results.length}`}
          sub={`matched in ${data.latency_ms.toFixed(2)} ms`}
          accent={eligibleCount > 0 ? "emerald" : "amber"}
        />
      </div>

      <details className="rounded-md border border-slate-800 bg-slate-950/60 p-3" open>
        <summary className="font-mono text-[10px] tracking-wider text-slate-400 cursor-pointer hover:text-slate-200">
          CONVERSION TRACE — {data.trace.extractions.length} fields
        </summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[11px] font-mono">
            <thead>
              <tr className="text-slate-500">
                <th className="text-left pr-3 pb-1.5 font-normal">FIELD</th>
                <th className="text-left pr-3 pb-1.5 font-normal">SOURCE</th>
                <th className="text-left pr-3 pb-1.5 font-normal">PATH</th>
                <th className="text-left pr-3 pb-1.5 font-normal">VALUE</th>
                <th className="text-left pb-1.5 font-normal">NOTES</th>
              </tr>
            </thead>
            <tbody>
              {data.trace.extractions.map((e, i) => (
                <tr key={i} className="border-t border-slate-900 align-top">
                  <td className="pr-3 py-1 text-slate-300">{e.field}</td>
                  <td className="pr-3 py-1">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[9px] tracking-wider ${
                        e.source === "extracted"
                          ? "bg-emerald-900/60 text-emerald-200"
                          : e.source === "inferred"
                            ? "bg-amber-900/60 text-amber-200"
                            : e.source === "defaulted"
                              ? "bg-slate-800 text-slate-400"
                              : "bg-rose-900/60 text-rose-200"
                      }`}
                    >
                      {e.source.toUpperCase()}
                    </span>
                  </td>
                  <td className="pr-3 py-1 text-slate-500">{e.nemsis_path ?? "—"}</td>
                  <td className="pr-3 py-1 text-slate-200">{formatValue(e.value)}</td>
                  <td className="py-1 text-slate-500 leading-snug">{e.notes ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <div>
        <p className="font-mono text-[10px] tracking-wider text-slate-500 mb-2">
          MATCH RESULTS
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {data.results.map((r) => {
            const trial = trialFor(r.trial_id);
            const eligible = r.eligible;
            const conf = Math.round(r.confidence * 100);
            const reason = !eligible ? firstFailingHardClause(r.trace) : null;
            return (
              <div
                key={r.trial_id}
                className={`rounded border p-2.5 ${
                  eligible
                    ? "border-emerald-800/60 bg-emerald-950/20"
                    : "border-slate-800 bg-slate-900/40"
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-mono text-xs text-slate-200">
                    {trial?.short_name ?? r.trial_id}
                  </span>
                  <span
                    className={`font-mono text-[9px] tracking-wider px-1.5 py-0.5 rounded ${
                      eligible
                        ? "bg-emerald-900/60 text-emerald-200"
                        : "bg-slate-800 text-slate-400"
                    }`}
                  >
                    {eligible ? `ELIGIBLE · ${conf}%` : "EXCLUDED"}
                  </span>
                </div>
                <p className="text-[10px] text-slate-500 font-mono truncate">
                  {trial?.title ?? r.trial_id}
                </p>
                {reason && (
                  <p className="mt-1 text-[10px] text-rose-300/80 font-mono truncate">
                    ✗ {reason.clause}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface PortfolioResponse {
  portfolio: {
    trial: Trial;
    source: "bundled" | "parsed";
    skipped_criteria: string[];
    parse_attempts: number;
  }[];
  coverage: {
    patient_id: string;
    eligible_count: number;
    results: MatchResult[];
  }[];
  summary: {
    total_trials: number;
    bundled_count: number;
    parsed_count: number;
    personas_covered: number;
    personas_total: number;
    total_skipped_criteria: number;
  };
  failures: { nct_id: string; error: string }[];
}

const EXAMPLE_PORTFOLIO = [
  "NCT03754114",
  "NCT05889650",
  "NCT06062628",
  "NCT04217551",
  "NCT06495294",
];

function PortfolioPanel() {
  const [text, setText] = useState(EXAMPLE_PORTFOLIO.join("\n"));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PortfolioResponse | null>(null);

  async function run() {
    setError(null);
    setData(null);
    const ids = text
      .split(/[\s,]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (ids.length === 0) {
      setError("paste at least one NCT ID");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/portfolio", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nct_ids: ids }),
      });
      const body = (await res.json()) as Record<string, unknown>;
      if (!res.ok) {
        setError((body.error as string | undefined) ?? `request failed (${res.status})`);
        return;
      }
      setData(body as unknown as PortfolioResponse);
    } catch {
      setError("network error reaching /api/portfolio");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-slate-800 bg-slate-900/40 p-5 fade-in">
      <p className="font-mono text-[10px] tracking-[0.2em] text-slate-500 mb-2">
        PORTFOLIO COVERAGE — which personas does your trial set actually reach?
      </p>
      <p className="text-[12px] text-slate-400 leading-relaxed mb-3">
        Paste a list of NCT IDs (one per line, up to 10). Bundled trials are reused; new
        ones are parsed live through Claude. The matrix below shows which of the bundled
        personas each trial covers — and which patients have <em>no</em> eligible trial
        in your portfolio.
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        spellCheck={false}
        placeholder={"NCT03754114\nNCT05889650\n…"}
        className="w-full px-3 py-2 rounded border border-slate-800 bg-slate-950 font-mono text-[12px] text-slate-100 focus:outline-none focus:border-slate-500 leading-relaxed"
      />
      <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2">
        <button
          onClick={run}
          disabled={loading}
          className="font-mono text-[11px] tracking-wider px-4 py-2 rounded bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-50"
        >
          {loading ? "ANALYZING…" : "ANALYZE PORTFOLIO"}
        </button>
        <span className="font-mono text-[10px] text-slate-500">
          Each unbundled NCT takes 5-15s · 2 portfolios per IP per 10 min
        </span>
      </div>

      {error && (
        <p className="mt-3 font-mono text-[11px] text-rose-300 bg-rose-950/30 border border-rose-900/60 rounded p-3">
          {error}
        </p>
      )}

      {data && <PortfolioResults data={data} />}
    </div>
  );
}

function PortfolioResults({ data }: { data: PortfolioResponse }) {
  const { summary, portfolio, coverage, failures } = data;
  const trials = portfolio.map((p) => p.trial);
  const trialIndex = new Map(trials.map((t, i) => [t.trial_id, i]));

  const uncoveredPersonas = coverage.filter((c) => c.eligible_count === 0);

  return (
    <div className="mt-5 fade-in">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <Stat label="Trials" value={`${summary.total_trials}`} sub={`${summary.bundled_count} bundled · ${summary.parsed_count} parsed`} />
        <Stat
          label="Personas covered"
          value={`${summary.personas_covered} / ${summary.personas_total}`}
          sub={uncoveredPersonas.length === 0 ? "no gaps" : `${uncoveredPersonas.length} unmatched`}
          accent={summary.personas_covered === summary.personas_total ? "emerald" : "amber"}
        />
        <Stat label="Skipped criteria" value={`${summary.total_skipped_criteria}`} sub="don't fit current schema" />
        <Stat label="Failures" value={`${failures.length}`} sub={failures.length === 0 ? "all parsed" : "see below"} accent={failures.length > 0 ? "rose" : "slate"} />
      </div>

      {failures.length > 0 && (
        <div className="mb-4 rounded-md border border-rose-900/60 bg-rose-950/20 p-3">
          <p className="font-mono text-[10px] tracking-wider text-rose-300 mb-1">FAILED TO PARSE</p>
          {failures.map((f, i) => (
            <p key={i} className="text-[11px] text-rose-200/80 font-mono leading-snug">
              {f.nct_id}: {f.error}
            </p>
          ))}
        </div>
      )}

      <div className="rounded-md border border-slate-800 bg-slate-950/60 p-4 overflow-x-auto">
        <table className="w-full text-[11px] font-mono">
          <thead>
            <tr>
              <th className="text-left pr-3 pb-2 text-slate-500 font-normal sticky left-0 bg-slate-950/60">PATIENT</th>
              {trials.map((t) => (
                <th key={t.trial_id} className="px-1 pb-2 text-slate-400 font-normal whitespace-nowrap">
                  <span className="block text-slate-200">{t.short_name}</span>
                  <span className="block text-slate-600 text-[9px]">{t.trial_id.slice(0, 11)}</span>
                </th>
              ))}
              <th className="text-right pl-3 pb-2 text-slate-500 font-normal">COVERAGE</th>
            </tr>
          </thead>
          <tbody>
            {coverage.map((c) => (
              <tr key={c.patient_id} className="border-t border-slate-900">
                <td className="pr-3 py-1.5 text-slate-300 sticky left-0 bg-slate-950/60">{c.patient_id}</td>
                {trials.map((t) => {
                  const idx = trialIndex.get(t.trial_id) ?? -1;
                  const r = c.results.find((res) => res.trial_id === t.trial_id);
                  if (!r) return <td key={idx} className="px-1 py-1.5 text-center text-slate-700">·</td>;
                  if (r.eligible) {
                    return (
                      <td
                        key={idx}
                        className="px-1 py-1.5 text-center text-emerald-400"
                        title={`${Math.round(r.confidence * 100)}% confidence`}
                      >
                        ✓
                      </td>
                    );
                  }
                  return (
                    <td key={idx} className="px-1 py-1.5 text-center text-slate-700" title="excluded">
                      ✗
                    </td>
                  );
                })}
                <td className="pl-3 py-1.5 text-right text-slate-400">
                  {c.eligible_count > 0 ? (
                    <span className="text-emerald-400">{c.eligible_count}</span>
                  ) : (
                    <span className="text-amber-400">0 — gap</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {uncoveredPersonas.length > 0 && (
        <div className="mt-3 rounded-md border border-amber-900/60 bg-amber-950/20 p-3">
          <p className="font-mono text-[10px] tracking-wider text-amber-300 mb-1.5">
            COVERAGE GAPS
          </p>
          <p className="text-[11px] text-amber-200/80 leading-snug">
            {uncoveredPersonas.map((c) => c.patient_id).join(", ")} have no eligible trial in this portfolio.
            Some gaps are correct (e.g. a no-flags control patient should match nothing).
            Others suggest your portfolio doesn&apos;t address a patient profile your bay actually sees.
          </p>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  accent = "slate",
}: {
  label: string;
  value: string;
  sub: string;
  accent?: "slate" | "emerald" | "amber" | "rose";
}) {
  const valueCls = {
    slate: "text-slate-100",
    emerald: "text-emerald-300",
    amber: "text-amber-300",
    rose: "text-rose-300",
  }[accent];
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2">
      <div className="font-mono text-[9px] tracking-[0.2em] text-slate-500 uppercase">
        {label}
      </div>
      <div className={`font-mono text-xl font-semibold ${valueCls} leading-tight mt-0.5`}>
        {value}
      </div>
      <div className="font-mono text-[9px] text-slate-500 mt-0.5">{sub}</div>
    </div>
  );
}

function ActiveScreen({
  payload,
  trialFor,
  onAcknowledge,
  onDismiss,
}: {
  payload: PatientMatchPayload;
  trialFor: (trialId: string) => Trial | undefined;
  onAcknowledge: (label: string) => void;
  onDismiss: () => void;
}) {
  const eligibleCount = payload.results.filter((r) => r.eligible).length;
  return (
    <div className="w-full grid lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)] gap-6 fade-in">
      <PatientPanel
        patient={payload.patient}
        eligibleCount={eligibleCount}
        onDismiss={onDismiss}
      />
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-mono text-[11px] tracking-[0.2em] text-slate-400">
            TRIAL MATCHES — RANKED
          </h2>
          <span className="font-mono text-[10px] text-slate-500">
            {eligibleCount} eligible ·{" "}
            {payload.results.length - eligibleCount} excluded
            {typeof payload.latency_ms === "number" && (
              <>
                {" · "}
                <span className="text-emerald-400">
                  matched in {payload.latency_ms.toFixed(1)} ms
                </span>
              </>
            )}
          </span>
        </div>
        {payload.results.map((r) => (
          <MatchCard
            key={r.trial_id}
            result={r}
            trial={trialFor(r.trial_id)}
            onAcknowledge={onAcknowledge}
          />
        ))}
        {eligibleCount === 0 && (
          <div className="rounded-md border border-slate-800 bg-slate-900/40 p-4 text-sm text-slate-400">
            No eligible trials for this patient. Patient continues standard care.
          </div>
        )}
      </div>
    </div>
  );
}

function PatientPanel({
  patient,
  eligibleCount,
  onDismiss,
}: {
  patient: Patient;
  eligibleCount: number;
  onDismiss: () => void;
}) {
  return (
    <aside className="rounded-lg border border-rose-900/60 bg-rose-950/20 p-5 slide-in">
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="font-mono text-[10px] tracking-[0.2em] text-rose-300">
            INCOMING — TRAUMA BAY
          </p>
          <p className="text-xl font-semibold mt-1">{patient.patient_id}</p>
        </div>
        <button
          onClick={onDismiss}
          className="text-slate-500 hover:text-slate-200 text-sm font-mono"
          aria-label="Dismiss alert"
        >
          ✕
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <Vital
          label="GCS"
          value={patient.gcs}
          accent={patient.gcs <= 8 ? "rose" : "slate"}
        />
        <Vital
          label="SBP"
          value={patient.sbp_mmhg}
          unit="mmHg"
          accent={patient.sbp_mmhg < 90 ? "rose" : "slate"}
        />
        <Vital label="HR" value={patient.hr_bpm} unit="bpm" />
      </div>

      <dl className="text-xs space-y-1.5">
        <Row label="Age / Sex">
          {patient.age_years}y {patient.sex}
        </Row>
        <Row label="Mechanism">
          {MECHANISM_LABEL[patient.mechanism] ?? patient.mechanism}
        </Row>
        <Row label="Activation">Level {patient.trauma_activation_level}</Row>
        <Row label="ETA">{patient.eta_minutes} min</Row>
        <Row label="Pregnancy">
          {patient.pregnancy_status.replaceAll("_", " ")}
        </Row>
        <Row label="Anticoag">
          {patient.anticoagulant_use ? "YES" : "no"}
        </Row>
        <Row label="TBI">{patient.presumed_tbi ? "suspected" : "no"}</Row>
        <Row label="Hemorrhage">
          {patient.presumed_hemorrhage ? "suspected" : "no"}
        </Row>
        <Row label="ICH">
          {patient.presumed_intracranial_hemorrhage ? "suspected" : "no"}
        </Row>
      </dl>

      <p className="mt-4 text-[11px] text-rose-200/70 font-mono">
        {eligibleCount > 0
          ? `${eligibleCount} TRIAL${eligibleCount > 1 ? "S" : ""} ELIGIBLE`
          : "NO TRIAL MATCH"}
      </p>
    </aside>
  );
}

function Vital({
  label,
  value,
  unit,
  accent,
}: {
  label: string;
  value: number | string;
  unit?: string;
  accent?: "slate" | "rose";
}) {
  const cls = accent === "rose" ? "text-rose-300" : "text-slate-100";
  return (
    <div className="rounded-md border border-slate-800 bg-slate-900/40 px-3 py-2">
      <div className="font-mono text-[9px] tracking-[0.2em] text-slate-500 uppercase">
        {label}
      </div>
      <div
        className={`font-mono text-2xl font-semibold ${cls} leading-tight`}
      >
        {value}
      </div>
      {unit && (
        <div className="font-mono text-[9px] text-slate-500">{unit}</div>
      )}
    </div>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-slate-500 uppercase tracking-wider text-[10px] pt-0.5">
        {label}
      </dt>
      <dd className="text-slate-200 font-mono text-right">{children}</dd>
    </div>
  );
}

function MatchCard({
  result,
  trial,
  onAcknowledge,
}: {
  result: MatchResult;
  trial?: Trial;
  onAcknowledge: (label: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const isEligible = result.eligible;
  const conf = Math.round(result.confidence * 100);
  // Hard inclusions all pass but soft inclusions miss → eligible but low confidence.
  // A coordinator should see this as "review needed", not "ready to enroll".
  const needsReview = isEligible && result.confidence < 0.5;
  const status: "review" | "eligible" | "excluded" = needsReview
    ? "review"
    : isEligible
      ? "eligible"
      : "excluded";

  const cardCls = {
    eligible: "border-emerald-700/70 bg-emerald-950/20",
    review: "border-amber-700/70 bg-amber-950/20",
    excluded: "border-slate-800 bg-slate-900/30 opacity-70",
  }[status];

  const chipCls = {
    eligible: "bg-emerald-900/60 text-emerald-200",
    review: "bg-amber-900/60 text-amber-100",
    excluded: "bg-slate-800 text-slate-400",
  }[status];

  const chipLabel = {
    eligible: "ELIGIBLE",
    review: "REVIEW NEEDED",
    excluded: "EXCLUDED",
  }[status];

  return (
    <div className={`rounded-lg border p-4 transition slide-in ${cardCls}`}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`font-mono text-[10px] tracking-[0.15em] px-1.5 py-0.5 rounded ${chipCls}`}
            >
              {chipLabel}
            </span>
            <span className="font-mono text-xs text-slate-300">
              {trial?.short_name ?? "?"}
            </span>
            <span className="font-mono text-[10px] text-slate-500">
              {result.trial_id}
            </span>
            {trial?.requires_efic && (
              <span className="font-mono text-[10px] tracking-wider px-1.5 py-0.5 rounded bg-rose-900/60 text-rose-200 border border-rose-800">
                EFIC
              </span>
            )}
          </div>
          <p className="text-sm text-slate-300 mt-1.5 leading-snug">
            {trial?.title ?? result.trial_id}
          </p>
          {status === "eligible" && (
            <div className="mt-3 flex items-center gap-2">
              <div className="h-1.5 flex-1 max-w-[200px] rounded-full bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-emerald-500"
                  style={{ width: `${conf}%` }}
                />
              </div>
              <span className="font-mono text-[10px] text-emerald-300">
                {conf}% confidence
              </span>
            </div>
          )}
          {status === "review" && (
            <p className="mt-3 font-mono text-[10px] text-amber-200/80">
              Hard criteria pass, but soft inclusions miss. Coordinator review recommended before enrolling.
            </p>
          )}
          {status === "excluded" && (() => {
            const reason = firstFailingHardClause(result.trace);
            if (!reason) return null;
            return (
              <p className="mt-3 font-mono text-[10px] text-rose-300/80">
                ✗ Fails: <span className="text-slate-200">{reason.clause}</span>
                <span className="text-slate-500"> · patient = {formatValue(reason.patient_value)}</span>
              </p>
            );
          })()}
        </div>
        <div className="flex flex-row sm:flex-col items-stretch sm:items-end gap-2 sm:shrink-0">
          {isEligible && (
            <button
              onClick={() => onAcknowledge(trial?.short_name ?? result.trial_id)}
              className={`font-mono text-[11px] tracking-wider px-3 py-2 sm:py-1.5 rounded text-white whitespace-nowrap flex-1 sm:flex-none ${
                status === "review"
                  ? "bg-amber-600 hover:bg-amber-500"
                  : "bg-rose-600 hover:bg-rose-500"
              }`}
            >
              {status === "review" ? "PAGE & FLAG FOR REVIEW" : "ACKNOWLEDGE & EN ROUTE"}
            </button>
          )}
          <button
            onClick={() => setOpen((o) => !o)}
            className="font-mono text-[10px] text-slate-400 hover:text-slate-200 underline-offset-2 hover:underline whitespace-nowrap"
          >
            {open ? "hide reasoning" : "show reasoning"}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-4 pt-4 border-t border-slate-800 fade-in">
          <p className="font-mono text-[10px] tracking-wider text-slate-500 mb-2">
            CLAUSE-LEVEL TRACE
          </p>
          <div className="space-y-1.5">
            {result.trace.map((c, i) => (
              <ClauseRow key={i} clause={c} />
            ))}
          </div>
          {trial?._metadata?.skipped_criteria &&
            trial._metadata.skipped_criteria.length > 0 && (
              <SkippedCriteria items={trial._metadata.skipped_criteria} />
            )}
        </div>
      )}
    </div>
  );
}

function SkippedCriteria({ items }: { items: string[] }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mt-4 pt-4 border-t border-slate-800/60">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="font-mono text-[10px] tracking-wider text-amber-300/80 hover:text-amber-200"
      >
        {expanded ? "▼" : "▶"} {items.length} CRITERIA THE ENGINE COULDN&apos;T ENCODE
      </button>
      {expanded && (
        <ul className="mt-2 space-y-1.5 pl-3 fade-in">
          {items.map((c, i) => (
            <li
              key={i}
              className="font-mono text-[11px] text-slate-400 leading-snug"
            >
              <span className="text-amber-400/70">·</span> {c}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ClauseRow({ clause }: { clause: ClauseTrace }) {
  const hardLabel = clause.hard ? "hard" : "soft";
  const ok = clause.kind === "inclusion" ? clause.hit : !clause.hit;
  return (
    <div className="grid grid-cols-[16px_70px_1fr_auto] items-center gap-2 font-mono text-[11px]">
      <span className={ok ? "text-emerald-400" : "text-rose-400"}>
        {ok ? "✓" : "✗"}
      </span>
      <span className="text-slate-500">
        {clause.kind} · {hardLabel}
      </span>
      <span className="text-slate-200 truncate">{clause.clause}</span>
      <span className="text-slate-500">
        patient = {formatValue(clause.patient_value)}
      </span>
    </div>
  );
}

function firstFailingHardClause(trace: ClauseTrace[]): ClauseTrace | undefined {
  return trace.find((c) =>
    c.hard && (c.kind === "inclusion" ? !c.hit : c.hit),
  );
}

function formatValue(v: unknown): string {
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v === null || v === undefined) return "—";
  return String(v);
}

function Toast({ text }: { text: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 bottom-8 -translate-x-1/2 toast-in z-20"
    >
      <div className="rounded-md bg-emerald-900/90 border border-emerald-700 text-emerald-100 px-5 py-3 font-mono text-xs tracking-wider shadow-lg">
        ▸ {text}
      </div>
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-slate-900 mt-16 py-6">
      <div className="max-w-6xl mx-auto px-6 flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-500 font-mono">
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>synthetic data · MIT</span>
          <a
            href="/playground"
            className="text-slate-400 hover:text-slate-200 underline-offset-2 hover:underline"
          >
            engine playground →
          </a>
          <a
            href="https://github.com/jajjer/traumatrial"
            target="_blank"
            rel="noreferrer"
            className="text-slate-400 hover:text-slate-200 underline-offset-2 hover:underline"
          >
            github →
          </a>
        </span>
        <span>open infrastructure for trauma trial matching</span>
      </div>
    </footer>
  );
}
