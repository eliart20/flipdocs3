export type ReadingDirection = "ltr" | "rtl";
export type NavigationDirection = "forward" | "backward";
export type PageSide = "left" | "right";
export type BenchmarkMode = "cold" | "preloaded";

export type FlipBookSource =
  | {
      type: "pdf";
      src: string | File | Blob;
    }
  | {
      type: "images";
      pages: Array<string | Blob | ImageBitmap>;
    };

export interface SpineOptions {
  visible?: boolean;
  widthPx?: number;
  color?: string;
}

export interface ReadyEvent {
  pageCount: number;
  pageAspect: number;
  direction: ReadingDirection;
}

export interface PageEvent {
  page: number;
  pageCount: number;
  visiblePages: number[];
}

export interface FlipBookProps {
  source: FlipBookSource;
  direction?: ReadingDirection;
  startPage?: number;
  showControls?: boolean;
  showFullscreen?: boolean;
  showFps?: boolean;
  preloadRadius?: number;
  cacheSize?: number;
  maxPixelRatio?: number;
  maxTextureHeight?: number;
  interactive?: boolean;
  spine?: SpineOptions;
  className?: string;
  onReady?: (event: ReadyEvent) => void;
  onPageChange?: (event: PageEvent) => void;
  onZoomChange?: (zoom: number) => void;
  onError?: (error: Error) => void;
}

export interface FlipBookTuning {
  /** Cylinder radius as a fraction of page width. Lower values fold closer to the spread. */
  curlRadius: number;
  /** Z-depth droop of the outer corner opposite the active material grab point. */
  cornerSag: number;
  /** Minimum visible lift reserved for a shallow moving fold, as a fraction of page width. */
  minimumLift: number;
  /** Vertical pull used by deterministic corner previews (0..0.45 of page height). */
  cornerPull: number;
  /** Opacity of the analytic contact and outer-curl shadow. */
  shadowOpacity: number;
  /** Canonical turn duration in milliseconds. */
  turnDuration: number;
  /** Minimum incremental poses used for a complete automatic turn on a slow callback source. */
  minimumTurnFrames: number;
  /** Pointer movement before a gesture is classified, in CSS pixels. */
  gestureSlop: number;
  /** Progress at which a slow direct drag completes after release. */
  releaseThreshold: number;
  /** Opposite-page fraction retained in mobile focus mode. */
  mobilePeek: number;
  /** Multiplier applied to viewport-aware page raster size. */
  qualityScale: number;
  /** Tessellation multiplier for the live curl mesh. */
  meshQuality: number;
}

export type DiagnosticCase =
  | "forward-top-hover"
  | "forward-bottom-hover"
  | "backward-top-hover"
  | "backward-bottom-hover"
  | "forward-mid-turn"
  | "backward-mid-turn"
  | "near-spine-diagonal"
  | "extreme-low-high";

export interface TurnPerformanceSnapshot {
  /** The visual path used by the completed toolbar or keyboard action. */
  kind: "curl" | "focus";
  /** Exact WebGL render calls made by the animated portion of the turn. */
  renderedFrames: number;
  /** Time from the accepted navigation action until its first WebGL render call returns. */
  clickToFirstFrameMs: number;
  /** Time from the accepted navigation action until its last animated render call returns. */
  elapsedMs: number;
  /** Largest gap between consecutive animated WebGL render-call completions. */
  maximumFrameGapMs: number;
  /** Whether this browser exposes the Long Animation Frames API. */
  longAnimationFrameSupported: boolean;
  /** Browser-reported main-thread animation frames longer than 50 ms during the action. */
  longAnimationFrameCount: number;
  maximumLongAnimationFrameMs: number;
}

export interface DiagnosticSnapshot {
  page: number;
  pageCount: number;
  direction: ReadingDirection;
  activeCase: DiagnosticCase | null;
  progress: number;
  fps: number;
  renderCount: number;
  mode: "desktop" | "mobile";
  zoom: number;
  /** Most recently completed toolbar or keyboard turn. */
  lastTurnPerformance: TurnPerformanceSnapshot | null;
}

export interface BenchmarkResult {
  /** Whether textures were rastered during the measured run or prepared in advance at full quality. */
  mode: BenchmarkMode;
  /** One-time full-quality preparation excluded from a preloaded benchmark's measured run. */
  preloadMs: number;
  /** GPU-completed visible frames rendered by the benchmark. */
  frames: number;
  /** Completed physical page turns. */
  turns: number;
  elapsedMs: number;
  /** Visible animation frames per second, excluding page-preparation gaps. */
  fps: number;
  /** Completed physical turns per wall-clock second, including page preparation. */
  pagesPerSecond: number;
  averageFrameMs: number;
  p95FrameMs: number;
  p99FrameMs: number;
  maximumFrameMs: number;
  /** Long frame gaps relative to the observed refresh cadence. */
  jankFrames: number;
  /** Estimated refresh opportunities skipped during long frame gaps. */
  droppedFrames: number;
  /** Frames required to sustain the benchmark's 60 FPS smoothness target. */
  targetFrames: number;
  /** Target frames that did not receive a WebGL render call. */
  frameDeficit: number;
  targetFps: number;
  /** No-work requestAnimationFrame cadence measured immediately before the run. */
  rafBaselineFps: number;
  rafBaselineFrameMs: number;
  /** Animation callbacks expected at the browser's measured baseline cadence. */
  rafTargetFrames: number;
  rafFrameDeficit: number;
  rafUtilization: number;
  /** Gaps materially slower than the browser's own baseline cadence. */
  rafJankFrames: number;
  /** Number of measured intervals between consecutive rendered curl poses. */
  motionSamples: number;
  /** Mean and worst normalized progress advance between rendered poses. */
  averageProgressStep: number;
  maximumProgressStep: number;
  /** Mean and worst travel of the grabbed loose corner, in page widths. */
  averageEdgeMotion: number;
  maximumEdgeMotion: number;
  /** Mean and worst travel averaged across representative sheet points, in page widths. */
  averageSheetMotion: number;
  maximumSheetMotion: number;
  /** Mean and worst travel of the fastest sampled point on each frame, in page widths. */
  averagePointMotion: number;
  maximumPointMotion: number;
  /** CPU time to update and submit each measured WebGL frame. */
  averageRenderMs: number;
  p95RenderMs: number;
  maximumRenderMs: number;
  averageFramesPerTurn: number;
  minimumFramesPerTurn: number;
  maximumFramesPerTurn: number;
  /** Average accepted-turn-to-first-render latency, including page preparation. */
  averageFirstFrameMs: number;
  maximumFirstFrameMs: number;
  /** Whether this browser exposes the Long Animation Frames API. */
  longAnimationFrameSupported: boolean;
  /** Browser-reported main-thread animation frames longer than 50 ms during the benchmark. */
  longAnimationFrameCount: number;
  maximumLongAnimationFrameMs: number;
  /** Cold-cache source/render preparation time per turn, including the initial spread. */
  averagePrepareMs: number;
  /** Page preparation plus synchronized rendering work, excluding intentional animation waits. */
  workPerTurnMs: number;
  /** The Z-axis corner-sag parameter used for this benchmark. */
  cornerSag: number;
  /** Adaptive full-turn frame floor used for this benchmark. */
  minimumTurnFrames: number;
}

export interface FlipBookHandle {
  next(): void;
  previous(): void;
  goToPage(page: number): void;
  zoomIn(): void;
  zoomOut(): void;
  resetZoom(): void;
  toggleFullscreen(): Promise<void>;
  setTuning(values: Partial<FlipBookTuning>): void;
  setDiagnosticPose(testCase: DiagnosticCase): Promise<void>;
  resetPose(): void;
  runBenchmark(durationMs?: number, mode?: BenchmarkMode): Promise<BenchmarkResult>;
  downloadPng(filename?: string): void;
  getSnapshot(): DiagnosticSnapshot;
}

export interface SpreadPages {
  left: number | null;
  right: number | null;
}

export interface PageFaceSelection {
  source: SpreadPages;
  target: SpreadPages;
  underlay: SpreadPages;
  turningSide: PageSide;
  receivingSide: PageSide;
  frontPage: number;
  backPage: number | null;
}
