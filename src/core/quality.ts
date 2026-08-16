export interface SegmentPair {
  x: number;
  y: number;
}

function boundedQuality(value: number): number {
  return Math.min(2, Math.max(0.5, value));
}

export function curlSegmentsForQuality(quality: number): SegmentPair {
  const scale = Math.min(1.5, boundedQuality(quality));
  return {
    x: Math.round(160 * scale),
    y: Math.round(112 * scale),
  };
}
