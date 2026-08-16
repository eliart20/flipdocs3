import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_TUNING,
  FlipBook,
  type BenchmarkMode,
  type BenchmarkResult,
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
  "025 Niddah (20pp full).pdf",
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

interface BenchmarkRun {
  id: number;
  source: string;
  tuning: Pick<FlipBookTuning, "cornerSag" | "meshQuality" | "qualityScale" | "turnDuration" | "minimumTurnFrames">;
  result: BenchmarkResult;
}

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
  const [benchmarking, setBenchmarking] = useState(false);
  const [benchmarkMode, setBenchmarkMode] = useState<BenchmarkMode>("cold");
  const [benchmarkResult, setBenchmarkResult] = useState<BenchmarkResult | null>(null);
  const [benchmarkError, setBenchmarkError] = useState<string | null>(null);
  const [benchmarkHistory, setBenchmarkHistory] = useState<BenchmarkRun[]>([]);
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
    lastTurnPerformance: null,
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
    setBenchmarkResult(null);
    setBenchmarkError(null);
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
    setBenchmarkResult(null);
    setBenchmarkError(null);
    setSource({ type: "pdf", src: file });
  };

  const updateTuning = <Key extends keyof FlipBookTuning>(key: Key, value: FlipBookTuning[Key]) => {
    setBenchmarkResult(null);
    setBenchmarkError(null);
    setTuning((current) => ({ ...current, [key]: value }));
  };

  const applyTuning = (values: Partial<FlipBookTuning>) => {
    setBenchmarkResult(null);
    setBenchmarkError(null);
    setTuning((current) => ({ ...current, ...values }));
  };

  const chooseBenchmarkMode = (mode: BenchmarkMode) => {
    setBenchmarkMode(mode);
    setBenchmarkResult(null);
    setBenchmarkError(null);
  };

  const runBenchmark = async () => {
    if (!viewer.current || benchmarking) return;
    setBenchmarking(true);
    setBenchmarkResult(null);
    setBenchmarkError(null);
    try {
      const testedTuning = {
        cornerSag: tuning.cornerSag,
        meshQuality: tuning.meshQuality,
        qualityScale: tuning.qualityScale,
        turnDuration: tuning.turnDuration,
        minimumTurnFrames: tuning.minimumTurnFrames,
      };
      const testedSource = sourceChoice === "synthetic"
        ? "Synthetic"
        : sourceChoice === "local"
          ? "Local PDF"
          : `PDF ${Number(sourceChoice) + 1} · ${pdfFixtures[Number(sourceChoice)] ?? "Unknown"}`;
      const result = await viewer.current.runBenchmark(undefined, benchmarkMode);
      setBenchmarkResult(result);
      setBenchmarkHistory((current) => [{
        id: Date.now(),
        source: testedSource,
        tuning: testedTuning,
        result,
      }, ...current].slice(0, 6));
    } catch (error) {
      setBenchmarkError(error instanceof Error ? error.message : String(error));
    } finally {
      setBenchmarking(false);
    }
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
              cacheSize={24}
              preloadRadius={9}
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
            <p className="section-note">Corner sag lowers only the diagonally opposite corner along Z while the grabbed corner stays attached. Set it to zero for a directly comparable no-sag benchmark.</p>
            <RangeControl label="Fold height / radius" value={Number(tuning.curlRadius.toFixed(3))} min={0.025} max={0.2} step={0.005} onChange={(value) => updateTuning("curlRadius", value)} />
            <RangeControl label="Z-axis corner sag" value={Number(tuning.cornerSag.toFixed(2))} min={0} max={1} step={0.02} onChange={(value) => updateTuning("cornerSag", value)} />
            <div className="preset-row" aria-label="Corner response preset">
              <button type="button" className={tuning.cornerSag === 0 ? "is-active" : ""} onClick={() => updateTuning("cornerSag", 0)}>Rigid</button>
              <button type="button" className={tuning.cornerSag === 0.72 ? "is-active" : ""} onClick={() => updateTuning("cornerSag", 0.72)}>Paper</button>
              <button type="button" className={tuning.cornerSag === 1 ? "is-active" : ""} onClick={() => updateTuning("cornerSag", 1)}>Soft</button>
            </div>
            <RangeControl label="Minimum fold lift" value={Number(tuning.minimumLift.toFixed(3))} min={0} max={0.06} step={0.002} onChange={(value) => updateTuning("minimumLift", value)} />
            <RangeControl label="Corner preview pull" value={Number(tuning.cornerPull.toFixed(2))} min={0.02} max={0.45} step={0.01} onChange={(value) => updateTuning("cornerPull", value)} />
            <RangeControl label="Fake curl shadow" value={Number(tuning.shadowOpacity.toFixed(2))} min={0} max={0.8} step={0.01} onChange={(value) => updateTuning("shadowOpacity", value)} />
            <RangeControl label="Turn time" value={tuning.turnDuration} min={220} max={1400} step={20} suffix="ms" onChange={(value) => updateTuning("turnDuration", value)} />
            <RangeControl label="Minimum turn poses" value={tuning.minimumTurnFrames} min={12} max={60} step={1} onChange={(value) => updateTuning("minimumTurnFrames", value)} />
            <div className="preset-row" aria-label="Motion cadence preset">
              <button type="button" className={tuning.minimumTurnFrames === 24 ? "is-active" : ""} onClick={() => updateTuning("minimumTurnFrames", 24)}>Quick</button>
              <button type="button" className={tuning.minimumTurnFrames === 38 ? "is-active" : ""} onClick={() => updateTuning("minimumTurnFrames", 38)}>Balanced</button>
              <button type="button" className={tuning.minimumTurnFrames === 52 ? "is-active" : ""} onClick={() => updateTuning("minimumTurnFrames", 52)}>Smooth</button>
            </div>
          </section>

          <section className="panel-section">
            <div className="section-heading"><span>02</span><div><p>Reader behavior</p><h2>View tuning</h2></div></div>
            <RangeControl label="Mobile page peek" value={Number(tuning.mobilePeek.toFixed(3))} min={0.02} max={0.18} step={0.005} onChange={(value) => updateTuning("mobilePeek", value)} />
            <RangeControl label="Raster sharpness" value={Number(tuning.qualityScale.toFixed(2))} min={0.7} max={1.8} step={0.05} suffix="×" onChange={(value) => updateTuning("qualityScale", value)} />
            <RangeControl label="Curl mesh detail" value={Number(tuning.meshQuality.toFixed(2))} min={0.5} max={1.5} step={0.25} suffix="×" onChange={(value) => updateTuning("meshQuality", value)} />
            <div className="preset-row" aria-label="Quality preset">
              <button type="button" onClick={() => applyTuning({ qualityScale: 0.85, meshQuality: 0.5 })}>Fast</button>
              <button type="button" className={tuning.qualityScale === 1.08 && tuning.meshQuality === 1 ? "is-active" : ""} onClick={() => applyTuning({ qualityScale: 1.08, meshQuality: 1 })}>Balanced</button>
              <button type="button" onClick={() => applyTuning({ qualityScale: 1.5, meshQuality: 1.5 })}>High</button>
            </div>
            <div className="turn-performance" aria-live="polite">
              {snapshot.lastTurnPerformance ? (
                <>
                  <span>Last arrow {snapshot.lastTurnPerformance.kind === "curl" ? "curl" : "mobile slide"}</span>
                  <strong>{snapshot.lastTurnPerformance.renderedFrames} rendered frames</strong>
                  <small>
                    {snapshot.lastTurnPerformance.clickToFirstFrameMs.toFixed(1)}ms click→first · {snapshot.lastTurnPerformance.elapsedMs.toFixed(0)}ms total · {snapshot.lastTurnPerformance.maximumFrameGapMs.toFixed(1)}ms worst gap
                  </small>
                  <small>
                    {snapshot.lastTurnPerformance.longAnimationFrameSupported
                      ? `${snapshot.lastTurnPerformance.longAnimationFrameCount} main-thread stalls over 50ms · ${snapshot.lastTurnPerformance.maximumLongAnimationFrameMs.toFixed(1)}ms longest`
                      : "Browser long-animation-frame timing unavailable"}
                  </small>
                </>
              ) : (
                <small>Use a toolbar arrow or keyboard navigation to capture one real turn.</small>
              )}
            </div>
            <div className="benchmark-card" aria-live="polite">
              <div className="preset-row" aria-label="Benchmark texture mode">
                <button type="button" className={benchmarkMode === "cold" ? "is-active" : ""} disabled={benchmarking} onClick={() => chooseBenchmarkMode("cold")}>Cold PDF</button>
                <button type="button" className={benchmarkMode === "preloaded" ? "is-active" : ""} disabled={benchmarking} onClick={() => chooseBenchmarkMode("preloaded")}>Preloaded HQ</button>
              </div>
              <button
                className="button button--accent"
                type="button"
                disabled={benchmarking || snapshot.pageCount < 2}
                onClick={() => void runBenchmark()}
              >
                {benchmarking
                  ? benchmarkMode === "preloaded" ? "Preloading HQ…" : "Turning pages…"
                  : benchmarkMode === "preloaded" ? "Benchmark preloaded HQ" : "Benchmark cold PDF"}
              </button>
              {benchmarkResult ? (
                <output className="benchmark-result">
                  <strong>{benchmarkResult.workPerTurnMs.toFixed(1)}ms work/turn</strong>
                  <span>{benchmarkResult.mode === "preloaded" ? `Preloaded HQ in ${(benchmarkResult.preloadMs / 1000).toFixed(1)}s before measurement` : "Cold PDF raster measured during turns"}</span>
                  <span>{benchmarkResult.frames} rendered frames total · {benchmarkResult.turns} turns · {benchmarkResult.averageFramesPerTurn.toFixed(1)} avg · {benchmarkResult.minimumFramesPerTurn}–{benchmarkResult.maximumFramesPerTurn} range</span>
                  <span>{benchmarkResult.fps.toFixed(1)} animation FPS · {benchmarkResult.frameDeficit} of {benchmarkResult.targetFrames} target frames missing at {benchmarkResult.targetFps.toFixed(0)} FPS</span>
                  <span>Browser baseline {benchmarkResult.rafBaselineFps.toFixed(1)} rAF/s · {(benchmarkResult.rafUtilization * 100).toFixed(0)}% callbacks delivered · {benchmarkResult.rafFrameDeficit} callback deficit</span>
                  <span>Motion/frame · {(benchmarkResult.averageSheetMotion * 100).toFixed(1)}% sheet avg / {(benchmarkResult.maximumSheetMotion * 100).toFixed(1)}% max · {(benchmarkResult.averageEdgeMotion * 100).toFixed(1)}% loose edge avg / {(benchmarkResult.maximumEdgeMotion * 100).toFixed(1)}% max</span>
                  <span>Fastest sampled point · {(benchmarkResult.averagePointMotion * 100).toFixed(1)}% page/frame avg · {(benchmarkResult.maximumPointMotion * 100).toFixed(1)}% worst</span>
                  <span>Progress/frame · {(benchmarkResult.averageProgressStep * 100).toFixed(1)}% avg / {(benchmarkResult.maximumProgressStep * 100).toFixed(1)}% max · {benchmarkResult.motionSamples} measured intervals · floor {benchmarkResult.minimumTurnFrames}</span>
                  <span>{benchmarkResult.averageFirstFrameMs.toFixed(1)}ms avg click→first · {benchmarkResult.maximumFirstFrameMs.toFixed(1)}ms worst · {benchmarkResult.pagesPerSecond.toFixed(2)} turns/s</span>
                  <span>{benchmarkResult.averagePrepareMs.toFixed(0)}ms prep/turn · {benchmarkResult.averageRenderMs.toFixed(1)}ms WebGL submit · {benchmarkResult.p99FrameMs.toFixed(1)}ms p99 · {benchmarkResult.maximumFrameMs.toFixed(1)}ms worst gap</span>
                  <span>{benchmarkResult.rafJankFrames} gaps slower than browser baseline · {benchmarkResult.jankFrames} gaps over 25ms vs 60 FPS · sag {benchmarkResult.cornerSag.toFixed(2)}</span>
                  <span>
                    {benchmarkResult.longAnimationFrameSupported
                      ? `${benchmarkResult.longAnimationFrameCount} main-thread stalls over 50ms · ${benchmarkResult.maximumLongAnimationFrameMs.toFixed(1)}ms longest`
                      : "Browser long-animation-frame timing unavailable"}
                  </span>
                </output>
              ) : (
                <p className={benchmarkError ? "is-error" : ""}>
                  {benchmarkError ?? (benchmarkMode === "preloaded"
                    ? "Raster every benchmark page at full display quality first, then measure only texture upload and page animation."
                    : "Clear the cache, then include real PDF preparation while turning several pages out and back.")}
                </p>
              )}
            </div>
            {benchmarkHistory.length > 0 && (
              <div className="benchmark-history">
                <div className="benchmark-history__heading">
                  <b>Recent comparisons</b>
                  <button type="button" onClick={() => setBenchmarkHistory([])}>Clear</button>
                </div>
                {benchmarkHistory.map((run) => (
                  <div className="benchmark-history__row" key={run.id}>
                    <span title={run.source}>{run.source}</span>
                    <b>{run.result.workPerTurnMs.toFixed(1)}ms</b>
                    <small>
                      {run.result.mode === "preloaded" ? "HQ" : "Cold"} · Q{run.tuning.qualityScale.toFixed(2)}/{run.tuning.meshQuality.toFixed(2)} · F{run.tuning.minimumTurnFrames} · {run.result.fps.toFixed(0)}/{run.result.rafBaselineFps.toFixed(0)} FPS · edge max {(run.result.maximumEdgeMotion * 100).toFixed(1)}%
                    </small>
                  </div>
                ))}
              </div>
            )}
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
