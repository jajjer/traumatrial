"use client";

import { useEffect, useState } from "react";

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
}: {
  onSimulate: (id?: string) => void;
  onSimulateCustom: (p: Patient) => void;
  loading: boolean;
  patients: Patient[];
}) {
  const [showForm, setShowForm] = useState(false);
  return (
    <div className="flex flex-col items-center gap-12 mt-16">
      <div className="text-center max-w-xl">
        <p className="font-mono text-xs tracking-[0.2em] text-slate-500 mb-3">
          STANDBY — TRAUMA BAY
        </p>
        <h1 className="text-3xl sm:text-4xl font-semibold text-slate-100 tracking-tight">
          No patient inbound.
        </h1>
        <p className="text-slate-400 mt-3 leading-relaxed">
          When a qualifying trauma patient hits the bay, the on-call research
          coordinator gets paged with their match. Press the button to simulate
          an arrival.
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
        <div className="flex items-center justify-center">
          <button
            onClick={() => setShowForm((s) => !s)}
            className="font-mono text-[10px] tracking-[0.2em] text-slate-400 hover:text-slate-200 underline-offset-4 hover:underline"
          >
            {showForm ? "▾ HIDE CUSTOM PATIENT" : "▸ OR BUILD A CUSTOM PATIENT"}
          </button>
        </div>
        {showForm && (
          <CustomPatientForm onSubmit={onSimulateCustom} loading={loading} />
        )}
      </div>
    </div>
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
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-[11px] tracking-[0.2em] text-slate-400">
            TRIAL MATCHES — RANKED
          </h2>
          <span className="font-mono text-[10px] text-slate-500">
            {eligibleCount} eligible ·{" "}
            {payload.results.length - eligibleCount} excluded
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
        </div>
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
        <span>
          synthetic data · pre-computed match results · live engine in{" "}
          <code className="text-slate-300">engine/</code>
        </span>
        <span>open infrastructure for trauma trial matching · MIT</span>
      </div>
    </footer>
  );
}
