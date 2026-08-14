import { describe, expect, it } from "vitest";
import {
  SHADOW_LIGHT_HORIZONTAL,
  shadowLightXForTurningSide,
} from "../src/core/shadowDirection";

describe("real page shadow direction", () => {
  it("projects each turning sheet back onto the page beneath it", () => {
    expect(shadowLightXForTurningSide("right")).toBe(-SHADOW_LIGHT_HORIZONTAL);
    expect(shadowLightXForTurningSide("left")).toBe(SHADOW_LIGHT_HORIZONTAL);
  });

  it("is an exact horizontal mirror for forward, backward, LTR, and RTL turns", () => {
    expect(shadowLightXForTurningSide("left"))
      .toBe(-shadowLightXForTurningSide("right"));
  });
});
