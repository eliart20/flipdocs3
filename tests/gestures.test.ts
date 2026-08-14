import { describe, expect, it } from "vitest";
import {
  classifyGesture,
  navigationForHorizontalIntent,
  shouldCompleteTurn,
} from "../src/core/gestures";

describe("gesture classification", () => {
  it("waits through slop and mostly vertical motion", () => {
    expect(classifyGesture({ mobile: false, materialX: 1, pageWidth: 1, deltaX: 3, deltaY: 2, slop: 6, turningSide: "right" })).toBe("pending");
    expect(classifyGesture({ mobile: false, materialX: 1, pageWidth: 1, deltaX: 8, deltaY: 30, slop: 6, turningSide: "right" })).toBe("pending");
  });

  it("allows direct corner drags and keeps interior mobile swipes canonical", () => {
    expect(classifyGesture({ mobile: true, materialX: 0.86, pageWidth: 1, deltaX: -20, deltaY: 4, slop: 6, turningSide: "right" })).toBe("direct");
    expect(classifyGesture({ mobile: true, materialX: 0.31, pageWidth: 1, deltaX: -20, deltaY: 4, slop: 6, turningSide: "right" })).toBe("canonical");
    expect(classifyGesture({ mobile: false, materialX: 0.2, pageWidth: 1, deltaX: 20, deltaY: 2, slop: 6, turningSide: "left" })).toBe("direct");
  });

  it("uses progress and release velocity without reversing a deliberate flick", () => {
    expect(shouldCompleteTurn({ progress: 0.2, progressVelocity: 0.8, threshold: 0.34 })).toBe(true);
    expect(shouldCompleteTurn({ progress: 0.8, progressVelocity: -0.8, threshold: 0.34 })).toBe(false);
    expect(shouldCompleteTurn({ progress: 0.35, progressVelocity: 0, threshold: 0.34 })).toBe(true);
    expect(shouldCompleteTurn({ progress: 0.33, progressVelocity: 0, threshold: 0.34 })).toBe(false);
  });

  it("maps physical sides to logical navigation", () => {
    expect(navigationForHorizontalIntent("right", "right")).toBe("forward");
    expect(navigationForHorizontalIntent("left", "right")).toBe("backward");
    expect(navigationForHorizontalIntent("left", "left")).toBe("forward");
  });
});
