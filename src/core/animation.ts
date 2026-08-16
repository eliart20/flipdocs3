import type { BenchmarkMode, BenchmarkResult, TurnPerformanceSnapshot } from "../types";

export interface CanonicalArrowInteraction {
  corner: "top" | "bottom";
  grabX: number;
  grabY: number;
  targetY: number;
  verticalInfluence: number;
}

/**
 * Nearly linear motion with short C1-continuous ramps at both ends. This keeps
 * low-refresh devices from spending most of their visible frames barely moving
 * and then jumping through the center of the turn.
 */
export function smoothTurnProgress(value: number): number {
  const time = Math.min(1, Math.max(0, value));
  const edge = 0.12;
  const speed = 1 / (1 - edge);
  if (time < edge) return speed * time * time / (2 * edge);
  if (time > 1 - edge) {
    const remaining = 1 - time;
    return 1 - speed * remaining * remaining / (2 * edge);
  }
  return speed * (time - edge / 2);
}

/**
 * Advance animation time without skipping large portions of a physical turn.
 * Slow callback sources extend the animation instead of jumping the sheet.
 */
export function advanceAnimationTime(
  current: number,
  elapsedMs: number,
  durationMs: number,
  minimumFullTurnFrames: number,
  travel = 1,
): number {
  const boundedCurrent = Math.min(1, Math.max(0, current));
  const boundedTravel = Math.min(1, Math.max(0.01, travel));
  const frameFloor = Math.max(2, Math.ceil(minimumFullTurnFrames * boundedTravel));
  const elapsedStep = Math.max(0, elapsedMs) / Math.max(1, durationMs);
  // A steady low-refresh display (30Hz) must keep real-time pacing — clamping
  // it to the pose floor stretches every turn and makes the tail crawl. Only
  // genuine hitches beyond ~90ms of lost time get smoothed instead of jumped.
  const hitchStep = 90 / Math.max(1, durationMs);
  const stepCap = Math.max(1 / frameFloor, hitchStep);
  return Math.min(1, boundedCurrent + Math.min(elapsedStep, stepCap));
}

export interface EqualMotionPath {
  progresses: number[];
  distances: number[];
}

function maximumPointMotion(previous: readonly number[], current: readonly number[]): number {
  let maximum = 0;
  for (let index = 0; index + 2 < Math.min(previous.length, current.length); index += 3) {
    maximum = Math.max(maximum, Math.hypot(
      current[index]! - previous[index]!,
      current[index + 1]! - previous[index + 1]!,
      current[index + 2]! - previous[index + 2]!,
    ));
  }
  return maximum;
}

/** Build a normalized path weighted by the fastest sampled physical point. */
export function buildEqualMotionPath(
  sample: (progress: number) => readonly number[],
  sampleCount = 160,
): EqualMotionPath {
  const count = Math.max(8, Math.round(sampleCount));
  const progresses: number[] = [];
  const distances: number[] = [];
  let previous: readonly number[] | null = null;
  let cumulative = 0;
  for (let index = 0; index <= count; index += 1) {
    const progress = index / count;
    const current = sample(progress);
    if (previous) cumulative += maximumPointMotion(previous, current);
    progresses.push(progress);
    distances.push(cumulative);
    previous = current;
  }
  if (cumulative > 0) {
    for (let index = 0; index < distances.length; index += 1) distances[index] = distances[index]! / cumulative;
  }
  return { progresses, distances };
}

function interpolatePath(x: readonly number[], y: readonly number[], at: number): number {
  const target = Math.min(1, Math.max(0, at));
  let low = 0;
  let high = x.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((x[middle] ?? 0) < target) low = middle + 1;
    else high = middle;
  }
  const upper = Math.max(1, low);
  const lower = upper - 1;
  const x0 = x[lower] ?? 0;
  const x1 = x[upper] ?? 1;
  const ratio = x1 > x0 ? (target - x0) / (x1 - x0) : 0;
  return (y[lower] ?? 0) + ((y[upper] ?? 1) - (y[lower] ?? 0)) * ratio;
}

export function progressAlongEqualMotionPath(
  path: EqualMotionPath,
  start: number,
  target: number,
  eased: number,
): number {
  const startDistance = interpolatePath(path.progresses, path.distances, start);
  const targetDistance = interpolatePath(path.progresses, path.distances, target);
  const desiredDistance = startDistance + (targetDistance - startDistance) * eased;
  return interpolatePath(path.distances, path.progresses, desiredDistance);
}

/**
 * Toolbar and keyboard turns start at an outer corner with a small, bounded
 * vertical destination. The engine applies that lift through a symmetric bell
 * curve so the corner rises gradually and returns level at the far edge.
 */
export function canonicalArrowInteraction(
  corner: "top" | "bottom" = "bottom",
): CanonicalArrowInteraction {
  const grabY = corner === "top" ? 0.965 : 0.035;
  const lift = corner === "top" ? -0.1 : 0.1;
  return {
    corner,
    grabX: 1,
    grabY,
    targetY: grabY + lift,
    verticalInfluence: 0,
  };
}

/** Bell-shaped lift: flat at both pages and highest halfway through the turn. */
export function automaticVerticalInfluence(progress: number): number {
  const value = Math.sin(Math.PI * Math.min(1, Math.max(0, progress)));
  return value * value;
}

export interface BenchmarkSamples {
  mode: BenchmarkMode;
  preloadMs: number;
  targetFrameMs: number;
  rafBaselineFrameMs: number;
  progressSteps: readonly number[];
  edgeMotion: readonly number[];
  sheetMotion: readonly number[];
  pointMotion: readonly number[];
  frameIntervals: readonly number[];
  renderCosts: readonly number[];
  framesPerTurn: readonly number[];
  firstFrameDelays: readonly number[];
  longAnimationFrameSupported: boolean;
  longAnimationFrames: readonly number[];
  visibleElapsedMs: number;
  totalElapsedMs: number;
  preparationMs: number;
  cornerSag: number;
  minimumTurnFrames: number;
}

export interface TurnPerformanceSamples {
  kind: TurnPerformanceSnapshot["kind"];
  requestedAt: number;
  renderedAt: readonly number[];
  longAnimationFrameSupported: boolean;
  longAnimationFrames: readonly number[];
}

function summarizeSeries(values: readonly number[]): {
  average: number;
  median: number;
  p95: number;
  p99: number;
  maximum: number;
} {
  const valid = values.filter((value) => Number.isFinite(value) && value >= 0);
  const average = valid.length > 0
    ? valid.reduce((total, value) => total + value, 0) / valid.length
    : 0;
  const ordered = [...valid].sort((a, b) => a - b);
  const medianIndex = Math.max(0, Math.ceil(ordered.length * 0.5) - 1);
  const p95Index = Math.max(0, Math.ceil(ordered.length * 0.95) - 1);
  const p99Index = Math.max(0, Math.ceil(ordered.length * 0.99) - 1);
  return {
    average,
    median: ordered[medianIndex] ?? 0,
    p95: ordered[p95Index] ?? 0,
    p99: ordered[p99Index] ?? 0,
    maximum: ordered.at(-1) ?? 0,
  };
}

export function summarizeTurnPerformance(
  samples: TurnPerformanceSamples,
): TurnPerformanceSnapshot {
  const requestedAt = Number.isFinite(samples.requestedAt) ? samples.requestedAt : 0;
  const renderedAt = samples.renderedAt.filter((value) => Number.isFinite(value) && value >= requestedAt);
  const frameGaps = renderedAt.slice(1).map((value, index) => value - renderedAt[index]!);
  const longFrames = summarizeSeries(samples.longAnimationFrames);
  return {
    kind: samples.kind,
    renderedFrames: renderedAt.length,
    clickToFirstFrameMs: Math.max(0, (renderedAt[0] ?? requestedAt) - requestedAt),
    elapsedMs: Math.max(0, (renderedAt.at(-1) ?? requestedAt) - requestedAt),
    maximumFrameGapMs: summarizeSeries(frameGaps).maximum,
    longAnimationFrameSupported: samples.longAnimationFrameSupported,
    longAnimationFrameCount: samples.longAnimationFrames.filter(
      (value) => Number.isFinite(value) && value >= 0,
    ).length,
    maximumLongAnimationFrameMs: longFrames.maximum,
  };
}

export function summarizeBenchmark(samples: BenchmarkSamples): BenchmarkResult {
  const frameTiming = summarizeSeries(samples.frameIntervals);
  const renderTiming = summarizeSeries(samples.renderCosts);
  const firstFrameTiming = summarizeSeries(samples.firstFrameDelays);
  const longFrameTiming = summarizeSeries(samples.longAnimationFrames);
  const progressTiming = summarizeSeries(samples.progressSteps);
  const edgeMotionTiming = summarizeSeries(samples.edgeMotion);
  const sheetMotionTiming = summarizeSeries(samples.sheetMotion);
  const pointMotionTiming = summarizeSeries(samples.pointMotion);
  const framesPerTurn = samples.framesPerTurn.filter((value) => Number.isFinite(value) && value >= 0);
  const frames = framesPerTurn.reduce((total, value) => total + value, 0);
  const turns = framesPerTurn.length;
  const visibleElapsedMs = Math.max(0, samples.visibleElapsedMs);
  const elapsedMs = Math.max(0, samples.totalElapsedMs);
  const targetFrameMs = Math.max(1, samples.targetFrameMs);
  const targetFrames = Math.max(0, Math.round(visibleElapsedMs / targetFrameMs));
  const frameDeficit = Math.max(0, targetFrames - frames);
  const rafBaselineFrameMs = Math.max(1, samples.rafBaselineFrameMs);
  const rafTargetFrames = Math.max(0, Math.round(visibleElapsedMs / rafBaselineFrameMs));
  const rafFrameDeficit = Math.max(0, rafTargetFrames - frames);
  const rafUtilization = rafTargetFrames > 0
    ? Math.min(1, frames / rafTargetFrames)
    : 0;
  const jankThreshold = targetFrameMs * 1.5;
  const jankFrames = samples.frameIntervals.filter((value) => value > jankThreshold).length;
  const rafJankFrames = samples.frameIntervals.filter(
    (value) => value > rafBaselineFrameMs * 1.5,
  ).length;
  const droppedFrames = frameDeficit;
  const averageFramesPerTurn = turns > 0 ? frames / turns : 0;
  const averagePrepareMs = turns > 0 ? Math.max(0, samples.preparationMs) / turns : 0;
  const workPerTurnMs = averagePrepareMs + renderTiming.average * averageFramesPerTurn;
  return {
    mode: samples.mode,
    preloadMs: Math.max(0, samples.preloadMs),
    frames,
    turns,
    elapsedMs,
    fps: visibleElapsedMs > 0 ? frames * 1000 / visibleElapsedMs : 0,
    pagesPerSecond: elapsedMs > 0 ? turns * 1000 / elapsedMs : 0,
    averageFrameMs: frameTiming.average,
    p95FrameMs: frameTiming.p95,
    p99FrameMs: frameTiming.p99,
    maximumFrameMs: frameTiming.maximum,
    jankFrames,
    droppedFrames,
    targetFrames,
    frameDeficit,
    targetFps: 1000 / targetFrameMs,
    rafBaselineFps: 1000 / rafBaselineFrameMs,
    rafBaselineFrameMs,
    rafTargetFrames,
    rafFrameDeficit,
    rafUtilization,
    rafJankFrames,
    motionSamples: samples.sheetMotion.filter((value) => Number.isFinite(value) && value >= 0).length,
    averageProgressStep: progressTiming.average,
    maximumProgressStep: progressTiming.maximum,
    averageEdgeMotion: edgeMotionTiming.average,
    maximumEdgeMotion: edgeMotionTiming.maximum,
    averageSheetMotion: sheetMotionTiming.average,
    maximumSheetMotion: sheetMotionTiming.maximum,
    averagePointMotion: pointMotionTiming.average,
    maximumPointMotion: pointMotionTiming.maximum,
    averageRenderMs: renderTiming.average,
    p95RenderMs: renderTiming.p95,
    maximumRenderMs: renderTiming.maximum,
    averageFramesPerTurn,
    minimumFramesPerTurn: turns > 0 ? Math.min(...framesPerTurn) : 0,
    maximumFramesPerTurn: turns > 0 ? Math.max(...framesPerTurn) : 0,
    averageFirstFrameMs: firstFrameTiming.average,
    maximumFirstFrameMs: firstFrameTiming.maximum,
    longAnimationFrameSupported: samples.longAnimationFrameSupported,
    longAnimationFrameCount: samples.longAnimationFrames.filter(
      (value) => Number.isFinite(value) && value >= 0,
    ).length,
    maximumLongAnimationFrameMs: longFrameTiming.maximum,
    averagePrepareMs,
    workPerTurnMs,
    cornerSag: Math.min(1, Math.max(0, samples.cornerSag)),
    minimumTurnFrames: Math.max(2, Math.round(samples.minimumTurnFrames)),
  };
}
