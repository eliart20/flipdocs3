import type {
  NavigationDirection,
  PageFaceSelection,
  PageSide,
  ReadingDirection,
  SpreadPages,
} from "../types";

export function clampPage(page: number, pageCount: number): number {
  if (pageCount < 1) return 0;
  return Math.min(pageCount, Math.max(1, Math.round(page)));
}

export function spreadForPage(
  page: number,
  pageCount: number,
  direction: ReadingDirection,
): SpreadPages {
  const current = clampPage(page, pageCount);
  if (!current) return { left: null, right: null };
  let left: number | null;
  let right: number | null;
  if (current === 1) {
    left = null;
    right = 1;
  } else {
    const first = current % 2 === 0 ? current : current - 1;
    left = first <= pageCount ? first : null;
    right = first + 1 <= pageCount ? first + 1 : null;
  }
  return direction === "rtl" ? { left: right, right: left } : { left, right };
}

export function pagesInSpread(spread: SpreadPages): number[] {
  return [spread.left, spread.right].filter((page): page is number => page !== null);
}

export function forwardSide(direction: ReadingDirection): PageSide {
  return direction === "ltr" ? "right" : "left";
}

export function backwardSide(direction: ReadingDirection): PageSide {
  return direction === "ltr" ? "left" : "right";
}

export function turnSide(direction: ReadingDirection, navigation: NavigationDirection): PageSide {
  return navigation === "forward" ? forwardSide(direction) : backwardSide(direction);
}

export function oppositeSide(side: PageSide): PageSide {
  return side === "left" ? "right" : "left";
}

export function desktopTargetPage(
  page: number,
  pageCount: number,
  navigation: NavigationDirection,
): number {
  const current = clampPage(page, pageCount);
  if (!current) return 0;
  if (navigation === "forward") {
    if (current === 1) return clampPage(2, pageCount);
    const start = current % 2 === 0 ? current : current - 1;
    return clampPage(start + 2, pageCount);
  }
  if (current <= 2) return 1;
  const start = current % 2 === 0 ? current : current - 1;
  return clampPage(start - 2, pageCount);
}

export function mobileTargetPage(
  page: number,
  pageCount: number,
  navigation: NavigationDirection,
): number {
  return clampPage(page + (navigation === "forward" ? 1 : -1), pageCount);
}

export function isSameSpread(
  a: number,
  b: number,
  pageCount: number,
  direction: ReadingDirection,
): boolean {
  const first = spreadForPage(a, pageCount, direction);
  const second = spreadForPage(b, pageCount, direction);
  return first.left === second.left && first.right === second.right;
}

export function selectPageFaces(
  page: number,
  targetPage: number,
  pageCount: number,
  direction: ReadingDirection,
  navigation: NavigationDirection,
): PageFaceSelection | null {
  const source = spreadForPage(page, pageCount, direction);
  const target = spreadForPage(targetPage, pageCount, direction);
  const turningSide = turnSide(direction, navigation);
  const receivingSide = oppositeSide(turningSide);
  const frontPage = source[turningSide];
  if (frontPage === null) return null;

  return {
    source,
    target,
    turningSide,
    receivingSide,
    frontPage,
    backPage: target[receivingSide],
    underlay: {
      left: turningSide === "left" ? target.left : source.left,
      right: turningSide === "right" ? target.right : source.right,
    },
  };
}
