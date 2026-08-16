// Autonomous jank harness: drives the demo in a real headed Chrome that keeps
// rendering while unfocused/offscreen, performs arrow + drag turns with
// trusted input, and reports repaint gaps, turn pacing, and main-thread
// stalls per turn. Usage:
//   node scripts/perf-harness.mjs [fixture] [turns] [cadenceMs]
// fixture: demo select value ("1" = full Niddah, "2" = 20pp vector,
//          "11" = 20pp flat, "niddah-images", "synthetic")
import { chromium } from "playwright";

const fixture = process.argv[2] ?? "1";
const turnCount = Number(process.argv[3] ?? 6);
const cadenceMs = Number(process.argv[4] ?? 1200);
const url = "http://localhost:5183";

const browser = await chromium.launch({
  channel: "chrome",
  headless: false,
  args: [
    "--window-position=-2600,40",
    "--window-size=1400,900",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling",
    "--no-first-run",
  ],
});

try {
  const page = await browser.newPage({
    viewport: { width: 1536, height: 735 },
    deviceScaleFactor: 1.25,
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });

  // Select the fixture through React's controlled select.
  await page.evaluate((value) => {
    const select = document.querySelector(".source-picker select");
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
    setter.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, fixture);

  // Wait for the engine handle and a loaded book.
  await page.waitForFunction(() => {
    const root = document.querySelector('[aria-label="Flipbook document viewer"]');
    if (!root) return false;
    const key = Object.keys(root).find((k) => k.startsWith("__reactFiber$"));
    let fiber = root[key];
    while (fiber) {
      if (fiber.ref?.current?.goToPage) {
        window.__fb = fiber.ref.current;
        return window.__fb.getSnapshot().pageCount > 1;
      }
      fiber = fiber.return;
    }
    return false;
  }, undefined, { timeout: 120_000 });

  // Instrument: rAF timeline + engine progress + LoAF attribution.
  await page.evaluate(() => {
    window.__m = { raf: [], loaf: [], turnPerf: [], marks: [] };
    const tick = (now) => {
      window.__m.raf.push([now, window.__fb.getSnapshot().progress]);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        window.__m.loaf.push({
          t: Math.round(e.startTime),
          dur: Math.round(e.duration),
          scripts: e.scripts.map((s) => ({
            src: (s.sourceURL || "").split("/").slice(-1)[0],
            fn: s.sourceFunctionName || s.invoker,
            dur: Math.round(s.duration),
          })).filter((s) => s.dur > 5),
        });
      }
    }).observe({ type: "long-animation-frame" });
  });

  await page.waitForTimeout(3500); // settle initial preload

  const mark = (m) => page.evaluate((v) => window.__m.marks.push([v, performance.now()]), m);

  // Phase 1: arrow turns at the requested cadence (trusted clicks).
  const next = page.locator('button[aria-label="Next page"]');
  await mark("arrows");
  for (let i = 0; i < turnCount; i += 1) {
    await next.click();
    await page.waitForTimeout(cadenceMs);
    await page.evaluate(() => {
      const p = window.__fb.getSnapshot().lastTurnPerformance;
      if (p) window.__m.turnPerf.push({
        kind: "arrow",
        first: Math.round(p.clickToFirstFrameMs),
        frames: p.renderedFrames,
        elapsed: Math.round(p.elapsedMs),
        worstGap: Math.round(p.maximumFrameGapMs),
        stalls: p.longAnimationFrameCount,
        worstStall: Math.round(p.maximumLongAnimationFrameMs),
      });
    });
  }

  // Phase 1b: human-style hover roaming over the page corners between turns.
  await mark("hover");
  const canvasForHover = await page.locator("canvas.flipdocs__canvas").boundingBox();
  for (let sweep = 0; sweep < 2; sweep += 1) {
    for (let s = 0; s <= 30; s += 1) {
      await page.mouse.move(
        canvasForHover.x + canvasForHover.width * (0.5 + 0.45 * (s / 30)),
        canvasForHover.y + canvasForHover.height * (0.82 + 0.1 * Math.sin(s / 4)),
      );
      await page.waitForTimeout(20);
    }
    await next.click();
    await page.waitForTimeout(900);
    await page.evaluate(() => {
      const p = window.__fb.getSnapshot().lastTurnPerformance;
      if (p) window.__m.turnPerf.push({
        kind: "hover+arrow",
        first: Math.round(p.clickToFirstFrameMs),
        frames: p.renderedFrames,
        elapsed: Math.round(p.elapsedMs),
        worstGap: Math.round(p.maximumFrameGapMs),
        stalls: p.longAnimationFrameCount,
        worstStall: Math.round(p.maximumLongAnimationFrameMs),
      });
    });
  }

  // Phase 2: trusted pointer drags across the right page.
  await mark("drags");
  const canvas = page.locator("canvas.flipdocs__canvas");
  const box = await canvas.boundingBox();
  for (let d = 0; d < 3; d += 1) {
    const y = box.y + box.height * 0.62;
    // 0.70/0.30 of the canvas width lands on the right/left page at any aspect.
    const beforePage = await page.evaluate(() => window.__fb.getSnapshot().page);
    await page.mouse.move(box.x + box.width * 0.70, y);
    await page.mouse.down();
    for (let s = 1; s <= 24; s += 1) {
      await page.mouse.move(box.x + box.width * (0.70 - 0.4 * (s / 24)), y + Math.sin(s / 5) * 6);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await page.waitForTimeout(1400);
    const afterPage = await page.evaluate(() => window.__fb.getSnapshot().page);
    await page.evaluate(([b, a]) => window.__m.marks.push([`drag ${b}->${a}`, performance.now()]), [beforePage, afterPage]);
  }
  await page.waitForTimeout(800);
  await mark("done");

  const data = await page.evaluate(() => window.__m);
  const page1 = await page.evaluate(() => window.__fb.getSnapshot().page);

  // ---- Analysis ----
  const rafTimes = data.raf.map(([t]) => t);
  const gaps = [];
  for (let i = 1; i < rafTimes.length; i += 1) gaps.push([rafTimes[i], rafTimes[i] - rafTimes[i - 1]]);
  const baseline = [...gaps.map(([, g]) => g)].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];

  // Identify turn windows from engine progress: progress > 0 means mid-turn.
  const busy = data.raf.filter(([, p]) => p > 0 && p < 1);
  const busyTimes = new Set(busy.map(([t]) => Math.round(t)));
  const inTurn = ([t]) => {
    for (let dt = -40; dt <= 40; dt += 8) if (busyTimes.has(Math.round(t + dt))) return true;
    return false;
  };
  const turnGaps = gaps.filter(([t, g]) => g > baseline * 1.9 && inTurn([t]));

  console.log(JSON.stringify({
    fixture,
    endPage: page1,
    rafSamples: rafTimes.length,
    baselineFrameMs: Math.round(baseline * 10) / 10,
    turnPerf: data.turnPerf,
    hitchesDuringTurns: turnGaps.map(([t, g]) => ({ t: Math.round(t), gap: Math.round(g) })),
    allBigGaps: gaps.filter(([, g]) => g >= 80).map(([t, g]) => ({ t: Math.round(t), gap: Math.round(g) })),
    stalls: data.loaf.filter((e) => e.dur >= 50),
    marks: data.marks.map(([m, t]) => `${m}@${Math.round(t)}`),
  }, null, 1));
} finally {
  await browser.close();
}
