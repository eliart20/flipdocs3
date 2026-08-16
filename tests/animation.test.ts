import { describe, expect, it } from "vitest";
import {
  advanceAnimationTime,
  automaticVerticalInfluence,
  buildEqualMotionPath,
  canonicalArrowInteraction,
  progressAlongEqualMotionPath,
  smoothTurnProgress,
  summarizeBenchmark,
  summarizeTurnPerformance,
} from "../src/core/animation";

describe("automatic page-turn animation", () => {
  it("uses a monotonic soft-linear curve with short endpoint ramps", () => {
    const samples = Array.from({ length: 21 }, (_, index) => smoothTurnProgress(index / 20));
    expect(samples[0]).toBe(0);
    expect(samples.at(-1)).toBe(1);
    expect(samples[10]).toBeCloseTo(0.5, 8);
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index]).toBeGreaterThan(samples[index - 1]!);
    }
    expect(smoothTurnProgress(0.001)).toBeLessThan(0.00001);
    expect(1 - smoothTurnProgress(0.999)).toBeLessThan(0.00001);
    expect(smoothTurnProgress(0.1)).toBeGreaterThan(0.04);
    expect(smoothTurnProgress(0.9)).toBeLessThan(0.96);
    expect(smoothTurnProgress(0.6) - smoothTurnProgress(0.5)).toBeLessThan(0.12);
  });

  it("extends a low-cadence turn instead of skipping large motion steps", () => {
    expect(advanceAnimationTime(0, 32, 620, 30)).toBeCloseTo(1 / 30, 8);
    expect(advanceAnimationTime(0, 16, 620, 30)).toBeCloseTo(16 / 620, 8);
    expect(advanceAnimationTime(0.98, 100, 620, 30)).toBe(1);
    expect(advanceAnimationTime(0, 100, 310, 30, 0.5)).toBeCloseTo(1 / 15, 8);
  });

  it("remaps nonlinear geometry to equal physical-motion intervals", () => {
    const path = buildEqualMotionPath((progress) => [progress * progress, 0, 0], 200);
    const samples = [0, 0.25, 0.5, 0.75, 1].map(
      (distance) => progressAlongEqualMotionPath(path, 0, 1, distance),
    );
    expect(samples[1]).toBeCloseTo(0.5, 2);
    expect(samples[2]).toBeCloseTo(Math.sqrt(0.5), 2);
    const physical = samples.map((progress) => progress * progress);
    for (let index = 1; index < physical.length; index += 1) {
      expect(physical[index]! - physical[index - 1]!).toBeCloseTo(0.25, 2);
    }
  });

  it("gives toolbar turns a bounded vertical destination from one corner", () => {
    const bottom = canonicalArrowInteraction();
    const top = canonicalArrowInteraction("top");
    expect(bottom.corner).toBe("bottom");
    expect(bottom.grabX).toBe(1);
    expect(bottom.targetY).toBeGreaterThan(bottom.grabY);
    expect(bottom.targetY - bottom.grabY).toBeCloseTo(0.1, 8);
    expect(bottom.verticalInfluence).toBe(0);
    expect(top.targetY).toBeLessThan(top.grabY);
    expect(top.grabY).toBeGreaterThan(0.95);
  });

  it("raises and settles the automatic corner along a smooth symmetric arc", () => {
    expect(automaticVerticalInfluence(0)).toBe(0);
    expect(automaticVerticalInfluence(0.25)).toBeCloseTo(0.5, 8);
    expect(automaticVerticalInfluence(0.5)).toBe(1);
    expect(automaticVerticalInfluence(0.75)).toBeCloseTo(0.5, 8);
    expect(automaticVerticalInfluence(1)).toBeCloseTo(0, 8);
    expect(automaticVerticalInfluence(0.001)).toBeLessThan(0.00001);
    expect(automaticVerticalInfluence(0.999)).toBeLessThan(0.00001);
  });

  it("summarizes multi-page throughput without hiding sparse or slow turns", () => {
    const result = summarizeBenchmark({
      mode: "cold",
      preloadMs: 0,
      targetFrameMs: 1000 / 60,
      rafBaselineFrameMs: 16,
      progressSteps: [0.02, 0.04, 0.03],
      edgeMotion: [0.04, 0.08, 0.06],
      sheetMotion: [0.01, 0.03, 0.02],
      pointMotion: [0.02, 0.05, 0.03],
      frameIntervals: [16, 17, 16, 51],
      renderCosts: [2, 3, 4, 12],
      framesPerTurn: [3, 1],
      firstFrameDelays: [30, 150],
      longAnimationFrameSupported: true,
      longAnimationFrames: [72, 120],
      visibleElapsedMs: 100,
      totalElapsedMs: 500,
      preparationMs: 180,
      cornerSag: 0.72,
      minimumTurnFrames: 30,
    });
    expect(result.frames).toBe(4);
    expect(result.mode).toBe("cold");
    expect(result.preloadMs).toBe(0);
    expect(result.turns).toBe(2);
    expect(result.fps).toBe(40);
    expect(result.pagesPerSecond).toBe(4);
    expect(result.averageFrameMs).toBe(25);
    expect(result.p95FrameMs).toBe(51);
    expect(result.p99FrameMs).toBe(51);
    expect(result.maximumFrameMs).toBe(51);
    expect(result.jankFrames).toBe(1);
    expect(result.droppedFrames).toBe(2);
    expect(result.targetFrames).toBe(6);
    expect(result.frameDeficit).toBe(2);
    expect(result.targetFps).toBeCloseTo(60, 8);
    expect(result.rafBaselineFps).toBe(62.5);
    expect(result.rafTargetFrames).toBe(6);
    expect(result.rafFrameDeficit).toBe(2);
    expect(result.rafUtilization).toBeCloseTo(2 / 3, 8);
    expect(result.rafJankFrames).toBe(1);
    expect(result.motionSamples).toBe(3);
    expect(result.averageProgressStep).toBeCloseTo(0.03, 8);
    expect(result.maximumProgressStep).toBe(0.04);
    expect(result.averageEdgeMotion).toBeCloseTo(0.06, 8);
    expect(result.maximumEdgeMotion).toBe(0.08);
    expect(result.averageSheetMotion).toBeCloseTo(0.02, 8);
    expect(result.maximumSheetMotion).toBe(0.03);
    expect(result.averagePointMotion).toBeCloseTo(0.1 / 3, 8);
    expect(result.maximumPointMotion).toBe(0.05);
    expect(result.averageRenderMs).toBe(5.25);
    expect(result.p95RenderMs).toBe(12);
    expect(result.maximumRenderMs).toBe(12);
    expect(result.averageFramesPerTurn).toBe(2);
    expect(result.minimumFramesPerTurn).toBe(1);
    expect(result.maximumFramesPerTurn).toBe(3);
    expect(result.averageFirstFrameMs).toBe(90);
    expect(result.maximumFirstFrameMs).toBe(150);
    expect(result.longAnimationFrameSupported).toBe(true);
    expect(result.longAnimationFrameCount).toBe(2);
    expect(result.maximumLongAnimationFrameMs).toBe(120);
    expect(result.averagePrepareMs).toBe(90);
    expect(result.workPerTurnMs).toBe(100.5);
    expect(result.cornerSag).toBe(0.72);
    expect(result.minimumTurnFrames).toBe(30);
  });

  it("reports exact animation render calls separately from browser stalls", () => {
    const result = summarizeTurnPerformance({
      kind: "curl",
      requestedAt: 100,
      renderedAt: [118, 134, 170],
      longAnimationFrameSupported: true,
      longAnimationFrames: [63, 91],
    });
    expect(result.kind).toBe("curl");
    expect(result.renderedFrames).toBe(3);
    expect(result.clickToFirstFrameMs).toBe(18);
    expect(result.elapsedMs).toBe(70);
    expect(result.maximumFrameGapMs).toBe(36);
    expect(result.longAnimationFrameCount).toBe(2);
    expect(result.maximumLongAnimationFrameMs).toBe(91);
  });
});
