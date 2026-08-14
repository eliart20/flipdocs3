import { describe, expect, it } from "vitest";
import {
  backwardSide,
  desktopTargetPage,
  forwardSide,
  isSameSpread,
  mobileTargetPage,
  selectPageFaces,
  spreadForPage,
} from "../src/core/pageSelection";

describe("page selection", () => {
  it("lays out cover and spreads in both reading directions", () => {
    expect(spreadForPage(1, 12, "ltr")).toEqual({ left: null, right: 1 });
    expect(spreadForPage(4, 12, "ltr")).toEqual({ left: 4, right: 5 });
    expect(spreadForPage(5, 12, "ltr")).toEqual({ left: 4, right: 5 });
    expect(spreadForPage(12, 12, "ltr")).toEqual({ left: 12, right: null });
    expect(spreadForPage(11, 11, "ltr")).toEqual({ left: 10, right: 11 });
    expect(spreadForPage(1, 12, "rtl")).toEqual({ left: 1, right: null });
    expect(spreadForPage(4, 12, "rtl")).toEqual({ left: 5, right: 4 });
  });

  it("selects desktop and mobile destinations at all boundaries", () => {
    expect(desktopTargetPage(1, 12, "backward")).toBe(1);
    expect(desktopTargetPage(1, 12, "forward")).toBe(2);
    expect(desktopTargetPage(4, 12, "backward")).toBe(2);
    expect(desktopTargetPage(4, 12, "forward")).toBe(6);
    expect(desktopTargetPage(12, 12, "forward")).toBe(12);
    expect(mobileTargetPage(1, 12, "backward")).toBe(1);
    expect(mobileTargetPage(5, 12, "forward")).toBe(6);
    expect(mobileTargetPage(12, 12, "forward")).toBe(12);
  });

  it("distinguishes an in-spread mobile focus slide from a sheet turn", () => {
    expect(isSameSpread(4, 5, 12, "ltr")).toBe(true);
    expect(isSameSpread(5, 6, 12, "ltr")).toBe(false);
    expect(isSameSpread(4, 5, 12, "rtl")).toBe(true);
  });

  it("chooses correct front, back, receiving side, and underlay", () => {
    expect(selectPageFaces(4, 6, 12, "ltr", "forward")).toEqual({
      source: { left: 4, right: 5 },
      target: { left: 6, right: 7 },
      turningSide: "right",
      receivingSide: "left",
      frontPage: 5,
      backPage: 6,
      underlay: { left: 4, right: 7 },
    });
    expect(selectPageFaces(4, 2, 12, "ltr", "backward")).toEqual({
      source: { left: 4, right: 5 },
      target: { left: 2, right: 3 },
      turningSide: "left",
      receivingSide: "right",
      frontPage: 4,
      backPage: 3,
      underlay: { left: 2, right: 5 },
    });
    expect(selectPageFaces(4, 6, 12, "rtl", "forward")).toEqual({
      source: { left: 5, right: 4 },
      target: { left: 7, right: 6 },
      turningSide: "left",
      receivingSide: "right",
      frontPage: 5,
      backPage: 6,
      underlay: { left: 7, right: 4 },
    });
  });

  it("mirrors the physical forward and backward sides", () => {
    expect(forwardSide("ltr")).toBe("right");
    expect(backwardSide("ltr")).toBe("left");
    expect(forwardSide("rtl")).toBe("left");
    expect(backwardSide("rtl")).toBe("right");
  });
});
