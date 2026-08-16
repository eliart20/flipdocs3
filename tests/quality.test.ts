import { describe, expect, it } from "vitest";
import { curlSegmentsForQuality } from "../src/core/quality";

describe("quality controls", () => {
  it("scales curl tessellation without unbounded geometry", () => {
    expect(curlSegmentsForQuality(0.5)).toEqual({ x: 80, y: 56 });
    expect(curlSegmentsForQuality(1)).toEqual({ x: 160, y: 112 });
    expect(curlSegmentsForQuality(4)).toEqual({ x: 240, y: 168 });
  });
});
