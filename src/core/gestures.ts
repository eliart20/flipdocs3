import type { NavigationDirection, PageSide } from "../types";

export type GestureMode = "pending" | "direct" | "canonical";

export interface GestureClassificationInput {
  mobile: boolean;
  materialX: number;
  pageWidth: number;
  deltaX: number;
  deltaY: number;
  slop: number;
  turningSide: PageSide;
}

export function classifyGesture(input: GestureClassificationInput): GestureMode {
  const distance = Math.hypot(input.deltaX, input.deltaY);
  if (distance < input.slop) return "pending";
  if (Math.abs(input.deltaX) < Math.abs(input.deltaY) * 0.55) return "pending";
  const outerHalf = input.materialX >= input.pageWidth * 0.5;
  if (input.mobile && !outerHalf) return "canonical";
  return "direct";
}

export interface ReleaseInput {
  progress: number;
  progressVelocity: number;
  threshold: number;
}

export function shouldCompleteTurn(input: ReleaseInput): boolean {
  if (input.progressVelocity > 0.65) return true;
  if (input.progressVelocity < -0.45) return false;
  return input.progress >= input.threshold;
}

export function navigationForHorizontalIntent(
  side: PageSide,
  forwardSide: PageSide,
): NavigationDirection {
  return side === forwardSide ? "forward" : "backward";
}
