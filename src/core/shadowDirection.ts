import type { PageSide } from "../types";

export const SHADOW_LIGHT_HORIZONTAL = 0.9;

/**
 * Put the light on the receiving side of the fold so its shadow projects back
 * onto the page directly underneath the moving sheet. Mirroring by physical
 * turn side keeps forward/backward and LTR/RTL behavior symmetric.
 */
export function shadowLightXForTurningSide(side: PageSide): number {
  return side === "right" ? -SHADOW_LIGHT_HORIZONTAL : SHADOW_LIGHT_HORIZONTAL;
}
