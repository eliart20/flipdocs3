import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_TUNING,
  FlipBook,
  type DiagnosticCase,
  type DiagnosticSnapshot,
  type FlipBookHandle,
  type FlipBookSource,
  type FlipBookTuning,
  type ReadingDirection,
} from "../src";
import { makeSyntheticPages } from "./syntheticPages";

const pdfFixtures = [
  "002 MS Stone Shemos (F-32) SMS2HI.pdf",
  "025 Niddah.pdf",
  "11b - Five Megilos (b).pdf",
  "257 HT Chullin (10) -257- 7x10-2up.pdf",
  "Bais Yaakov Pomona - Final Yearbook combined.pdf",
  "Bnos_Chaya_Yearbook_2026_Print_2-Runger2.pdf",
  "FST Bava Basra (02)-177- (11a-20b).pdf",
  "FST Menachos (01) -236- (02a-11a).pdf",
  "FST Niddah (01)-284- (02a-11a).pdf",
  "Shir Hashirim HT.pdf",
];

const diagnosticCases: Array<{ value: DiagnosticCase; label: string }> = [
  { value: "forward-top-hover", label: "Forward · top corner" },
  { value: "forward-bottom-hover", label: "Forward · bottom corner" },
  { value: "backward-top-hover", label: "Backward · top corner" },
  { value: "backward-bottom-hover", label: "Backward · bottom corner" },
  { value: "forward-mid-turn", label: "Forward · mid-turn" },
  { value: "backward-mid-turn", label: "Backward · mid-turn" },
  { value: "near-spine-diagonal", label: "Near-spine diagonal" },
  { value: "extreme-low-high", label: "Extreme low → high" },
];

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

function RangeControl({
  label,
  value,
  min,
  max,
  step,
  suffix = "",
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="range-control">
      <span><b>{label}</b><output>{value}{suffix}</output></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

export function App() {
  const syntheticPages = useMemo(() => makeSyntheticPages(12), []);
  const viewer = useRef<FlipBookHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<FlipBookSource>({ type: "images", pages: syntheticPages });
  const [sourceChoice, setSourceChoice] = useState("synthetic");
  const [direction, setDirection] = useState<ReadingDirection>("ltr");
  const [showFps, setShowFps] = useState(true);
  const [showSpine, setShowSpine] = useState(true);
  const [tuning, setTuning] = useState<FlipBookTuning>({ ...DEFAULT_TUNING });
  const [snapshot, setSnapshot] = useState<DiagnosticSnapshot>({
    page: 1,
    pageCount: 0,
    direction: "ltr",
    activeCase: null,
    progress: 0,
    fps: 0,
    renderCount: 0,
    mode: "desktop",
    zoom: 1,
  });

  useEffect(() => viewer.current?.setTuning(tuning), [tuning]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (viewer.current) setSnapshot(viewer.current.getSnapshot());
    }, 350);
    return () => window.clearInterval(timer);
  }, []);

  const chooseSource = (choice: string) => {
    setSourceChoice(choice);
    viewer.current?.resetPose();
    if (choice === "synthetic") {
      setSource({ type: "images", pages: syntheticPages });
      return;
    }
    const index = Number(choice);
    if (Number.isInteger(index)) setSource({ type: "pdf", src: `/test-pdfs/${index}` });
  };

  const loadFile = (file: File | undefined) => {
    if (!file) return;
    setSourceChoice("local");
    setSource({ type: "pdf", src: file });
  };

  const updateTuning = <Key extends keyof FlipBookTuning>(key: Key, value: FlipBookTuning[Key]) => {
    setTuning((current) => ({ ...current, [key]: value }));
  };

  return (
    <main className="lab-shell">
      <header className="lab-header">
        <div className="brand-mark">FD</div>
        <div className="brand-copy">
          <p>Greenfield WebGL reader</p>
          <h1>Flipdocs <span>v2 lab</span></h1>
        </div>
        <div className="header-actions">
          <label className="source-picker">
            <span>Test document</span>
            <select value={sourceChoice} onChange={(event) => chooseSource(event.target.value)}>
              <option value="synthetic">Synthetic orientation book</option>
              {pdfFixtures.map((name, index) => <option key={name} value={index}>PDF {index + 1} · {name}</option>)}
              {sourceChoice === "local" && <option value="local">Local PDF</option>}
            </select>
          </label>
          <input ref={fileInput} type="file" accept="application/pdf" hidden onChange={(event) => loadFile(event.target.files?.[0])} />
          <button className="button button--quiet" type="button" onClick={() => fileInput.current?.click()}>Open local PDF</button>
          <div className="segmented" aria-label="Reading direction">
            <button type="button" className={direction === "ltr" ? "is-active" : ""} onClick={() => setDirection("ltr")}>LTR</button>
            <button type="button" className={direction === "rtl" ? "is-active" : ""} onClick={() => setDirection("rtl")}>RTL</button>
          </div>
        </div>
      </header>

      <section className="lab-grid">
        <div className="viewer-card">
          <div className="viewer-status">
            <span className="live-dot" />
            <span>Live engine</span>
            <i />
            <span>{snapshot.mode}</span>
            <i />
            <span>{direction.toUpperCase()}</span>
          </div>
          <div className="viewer-stage">
            <FlipBook
              ref={viewer}
              source={source}
              direction={direction}
              startPage={4}
              showFps={showFps}
              spine={{ visible: showSpine, widthPx: 3, color: "#202733" }}
              cacheSize={10}
              preloadRadius={2}
              onPageChange={() => setSnapshot(viewer.current?.getSnapshot() ?? snapshot)}
            />
          </div>
          <div className="metrics-row">
            <Metric label="Page" value={`${snapshot.page} / ${snapshot.pageCount || "—"}`} />
            <Metric label="Pose" value={snapshot.activeCase ?? "live input"} />
            <Metric label="FPS" value={snapshot.fps || "idle"} />
            <Metric label="Renders" value={snapshot.renderCount.toLocaleString()} />
          </div>
        </div>

        <aside className="lab-panel">
          <section className="panel-section">
            <div className="section-heading"><span>01</span><div><p>Fold profile</p><h2>Keep it close</h2></div></div>
            <p className="section-note">Radius controls both fold height and bend width without stretching the sheet. The default is intentionally tight.</p>
            <RangeControl label="Fold height / radius" value={Number(tuning.curlRadius.toFixed(3))} min={0.025} max={0.2} step={0.005} onChange={(value) => updateTuning("curlRadius", value)} />
            <RangeControl label="Minimum fold lift" value={Number(tuning.minimumLift.toFixed(3))} min={0} max={0.06} step={0.002} onChange={(value) => updateTuning("minimumLift", value)} />
            <RangeControl label="Corner preview pull" value={Number(tuning.cornerPull.toFixed(2))} min={0.02} max={0.45} step={0.01} onChange={(value) => updateTuning("cornerPull", value)} />
            <RangeControl label="Real page shadow" value={Number(tuning.shadowOpacity.toFixed(2))} min={0} max={0.8} step={0.01} onChange={(value) => updateTuning("shadowOpacity", value)} />
            <RangeControl label="Turn time" value={tuning.turnDuration} min={220} max={1400} step={20} suffix="ms" onChange={(value) => updateTuning("turnDuration", value)} />
          </section>

          <section className="panel-section">
            <div className="section-heading"><span>02</span><div><p>Reader behavior</p><h2>View tuning</h2></div></div>
            <RangeControl label="Mobile page peek" value={Number(tuning.mobilePeek.toFixed(3))} min={0.02} max={0.18} step={0.005} onChange={(value) => updateTuning("mobilePeek", value)} />
            <RangeControl label="Raster quality" value={Number(tuning.qualityScale.toFixed(2))} min={0.7} max={1.8} step={0.05} onChange={(value) => updateTuning("qualityScale", value)} />
            <RangeControl label="Release threshold" value={Number(tuning.releaseThreshold.toFixed(2))} min={0.15} max={0.75} step={0.01} onChange={(value) => updateTuning("releaseThreshold", value)} />
            <div className="toggle-row">
              <label><input type="checkbox" checked={showSpine} onChange={(event) => setShowSpine(event.target.checked)} /><span />Sharp fake spine</label>
              <label><input type="checkbox" checked={showFps} onChange={(event) => setShowFps(event.target.checked)} /><span />FPS meter</label>
            </div>
          </section>

          <section className="panel-section panel-section--poses">
            <div className="section-heading"><span>03</span><div><p>Deterministic diagnostics</p><h2>Production poses</h2></div></div>
            <div className="pose-grid">
              {diagnosticCases.map((test) => (
                <button
                  type="button"
                  key={test.value}
                  className={snapshot.activeCase === test.value ? "is-active" : ""}
                  onClick={() => void viewer.current?.setDiagnosticPose(test.value)}
                >{test.label}</button>
              ))}
            </div>
            <div className="panel-actions">
              <button className="button button--accent" type="button" onClick={() => viewer.current?.resetPose()}>Reset pose</button>
              <button className="button button--quiet" type="button" onClick={() => viewer.current?.downloadPng()}>Download PNG</button>
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}
