import { describe, expect, it } from "vitest";
import {
  deformPoint,
  edgeLengthRatios,
  curlVertexShader,
  mappedGrabPoint,
  sampleGeometry,
  solveCurlState,
  solveProgressForPointer,
  type CurlPose,
} from "../src/core/curlGeometry";

const width = 1;
const height = 4 / 3;

const poses: CurlPose[] = [
  { progress: 0.08, radius: 0.085, minimumLift: 0.018, side: "right", grabX: 1, grabY: 1, targetY: 0.78, verticalInfluence: 1 },
  { progress: 0.36, radius: 0.085, minimumLift: 0.018, side: "right", grabX: 1, grabY: 0.06, targetY: 0.94, verticalInfluence: 1 },
  { progress: 0.53, radius: 0.12, minimumLift: 0.024, side: "left", grabX: 0.23, grabY: 0.18, targetY: 0.82, verticalInfluence: 1 },
  { progress: 0.82, radius: 0.05, minimumLift: 0.012, side: "left", grabX: 0.76, grabY: 0.78, targetY: 0.32, verticalInfluence: 0.65 },
];

describe("developable curl geometry", () => {
  it("pins every point of the full hinge for diagonal turns", () => {
    for (const pose of poses) {
      for (let row = 0; row <= 24; row += 1) {
        const y = -height / 2 + (row / 24) * height;
        const point = deformPoint(0, y, width, height, pose);
        expect(point.x).toBeCloseTo(0, 8);
        expect(point.y).toBeCloseTo(y, 8);
        expect(point.z).toBeCloseTo(0, 8);
      }
    }
  });

  it("maps the grabbed material point to the constrained pointer target", () => {
    for (const pose of poses) {
      const state = solveCurlState(width, height, pose);
      const mapped = mappedGrabPoint(width, height, pose);
      const sideSign = pose.side === "right" ? 1 : -1;
      expect(mapped.x).toBeCloseTo(sideSign * state.constrainedTarget.x, 7);
      expect(mapped.y).toBeCloseTo(state.constrainedTarget.y, 7);
      expect(mapped.z).toBeGreaterThanOrEqual(0);
    }
  });

  it("never stretches sampled material edges", () => {
    for (const pose of poses) {
      const ratios = edgeLengthRatios(sampleGeometry(width, height, pose), width, height);
      expect(Math.max(...ratios)).toBeLessThanOrEqual(1.00001);
      expect(Math.min(...ratios)).toBeGreaterThan(0.84);
    }
  });

  it("retains a visible rounded band on an extreme shallow diagonal", () => {
    const state = solveCurlState(width, height, {
      progress: 0.34,
      radius: 0.085,
      minimumLift: 0.018,
      side: "right",
      grabX: 1,
      grabY: 0.03,
      targetY: 0.97,
      verticalInfluence: 1,
    });
    expect(state.constraintRatio).toBeLessThan(1);
    expect(state.radius * 2).toBeGreaterThanOrEqual(0.01);
  });

  it("never places any sampled paper below the resting-page plane", () => {
    for (const pose of poses) {
      const grid = sampleGeometry(width, height, pose);
      for (const row of grid) for (const point of row) expect(point.z).toBeGreaterThanOrEqual(0);
    }
  });

  it("mirrors forward and backward geometry exactly", () => {
    const base: Omit<CurlPose, "side"> = {
      progress: 0.47,
      radius: 0.085,
      minimumLift: 0.018,
      grabX: 0.91,
      grabY: 0.86,
      targetY: 0.37,
      verticalInfluence: 1,
    };
    for (let row = 0; row <= 20; row += 1) {
      for (let column = 0; column <= 20; column += 1) {
        const x = column / 20;
        const y = -height / 2 + (row / 20) * height;
        const right = deformPoint(x, y, width, height, { ...base, side: "right" });
        const left = deformPoint(x, y, width, height, { ...base, side: "left" });
        expect(left.x).toBeCloseTo(-right.x, 9);
        expect(left.y).toBeCloseTo(right.y, 9);
        expect(left.z).toBeCloseTo(right.z, 9);
      }
    }
  });

  it("retraces identical material positions when pointer progress reverses", () => {
    const progress = [0.08, 0.21, 0.44, 0.68, 0.91];
    const sample = (at: number) => deformPoint(0.83, 0.29, width, height, {
      progress: at,
      radius: 0.085,
      minimumLift: 0.018,
      side: "right",
      grabX: 1,
      grabY: 0.88,
      targetY: 0.32,
      verticalInfluence: 1,
    });
    const forward = progress.map(sample);
    const reverse = [...progress].reverse().map(sample).reverse();
    expect(reverse).toEqual(forward);
  });

  it("constrains impossible vertical targets continuously", () => {
    const constrained = Array.from({ length: 51 }, (_, index) => solveCurlState(width, height, {
      progress: 0.42,
      radius: 0.085,
      minimumLift: 0.018,
      side: "right",
      grabX: 1,
      grabY: 0.08,
      targetY: index / 50,
      verticalInfluence: 1,
    }).constrainedTarget.y);
    for (let index = 1; index < constrained.length; index += 1) {
      expect(Math.abs(constrained[index]! - constrained[index - 1]!)).toBeLessThan(0.08);
    }
  });

  it("passes the original UV through the vertex shader unchanged", () => {
    expect(curlVertexShader).toContain("vPageUv = uv;");
  });

  it("is exactly flat at both stable endpoints", () => {
    for (const side of ["left", "right"] as const) {
      for (const progress of [0, 1]) {
        const pose: CurlPose = {
          progress,
          radius: 0.085,
          minimumLift: 0.018,
          side,
          grabX: 1,
          grabY: 1,
          targetY: 0.2,
          verticalInfluence: 1,
        };
        const point = deformPoint(0.73, 0.31, width, height, pose);
        expect(point.x).toBeCloseTo((side === "right" ? 1 : -1) * 0.73 * (progress === 0 ? 1 : -1), 8);
        expect(point.y).toBeCloseTo(0.31, 8);
        expect(point.z).toBe(0);
      }
    }
  });
});

describe("pointer-attached progress", () => {
  it("solves a stationary desktop camera", () => {
    expect(solveProgressForPointer(1, 1, 0.4)).toBeCloseTo(0.3, 8);
    expect(solveProgressForPointer(1, 1, 1)).toBe(0);
    expect(solveProgressForPointer(1, 1, -1)).toBe(1);
  });

  it("solves the page edge and mobile focus translation together", () => {
    const expected = 0.4;
    const signedFocusTravel = -0.92;
    const targetAtSourceFocus = 1 - expected * (2 + signedFocusTravel);
    expect(solveProgressForPointer(1, 1, targetAtSourceFocus, 0.085, signedFocusTravel))
      .toBeCloseTo(expected, 8);
  });

  it("is monotonic across the complete mobile pointer path", () => {
    const focusTravel = -0.94;
    const samples = Array.from({ length: 21 }, (_, index) => {
      const expected = index / 20;
      const pointerAtSource = 1 - expected * (2 + focusTravel);
      return solveProgressForPointer(1, 1, pointerAtSource, 0.085, focusTravel);
    });
    expect(samples).toEqual([...samples].sort((a, b) => a - b));
    samples.forEach((sample, index) => expect(sample).toBeCloseTo(index / 20, 8));
  });
});
