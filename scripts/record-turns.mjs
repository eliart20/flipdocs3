// Records the flipbook canvas during scripted turns and saves the webm.
// Usage: node scripts/record-turns.mjs [fixture] [outPath]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const fixture = process.argv[2] ?? "1";
const outPath = resolve(process.argv[3] ?? "cap-harness.webm");
mkdirSync(dirname(outPath), { recursive: true });

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
  const page = await browser.newPage({ viewport: { width: 1536, height: 735 }, deviceScaleFactor: 1.25 });
  await page.goto("http://localhost:5183", { waitUntil: "domcontentloaded" });
  await page.evaluate((value) => {
    const select = document.querySelector(".source-picker select");
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
    setter.call(select, value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }, fixture);
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
  await page.waitForTimeout(3000);

  await page.evaluate(() => {
    const canvas = document.querySelector("canvas.flipdocs__canvas");
    const stream = canvas.captureStream(30);
    window.__rec = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8", videoBitsPerSecond: 12_000_000 });
    window.__chunks = [];
    window.__rec.ondataavailable = (e) => e.data.size && window.__chunks.push(e.data);
    window.__rec.start(200);
  });

  const next = page.locator('button[aria-label="Next page"]');
  const previous = page.locator('button[aria-label="Previous page"]');
  const box = await page.locator("canvas.flipdocs__canvas").boundingBox();
  const drag = async (forward = true) => {
    const y = box.y + box.height * 0.62;
    const from = forward ? 0.70 : 0.30;
    const to = forward ? 0.30 : 0.70;
    await page.mouse.move(box.x + box.width * from, y);
    await page.mouse.down();
    for (let s = 1; s <= 24; s += 1) {
      await page.mouse.move(box.x + box.width * (from + (to - from) * (s / 24)), y);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await page.waitForTimeout(1300);
  };

  // Reading-pace arrow turns.
  for (let i = 0; i < 5; i += 1) {
    await next.click();
    await page.waitForTimeout(1300);
  }
  // Rapid flipping.
  for (let i = 0; i < 6; i += 1) {
    await next.click();
    await page.waitForTimeout(450);
  }
  await page.waitForTimeout(1200);
  // Drag turns, forward then backward.
  await drag(true);
  await drag(true);
  await drag(false);
  // Backward arrows.
  for (let i = 0; i < 3; i += 1) {
    await previous.click();
    await page.waitForTimeout(1100);
  }
  // Cold jump deep into the book, then immediate turns.
  await page.evaluate(() => window.__fb.goToPage(1200));
  await page.waitForTimeout(1000);
  for (let i = 0; i < 4; i += 1) {
    await next.click();
    await page.waitForTimeout(1300);
  }
  await drag(true);
  await page.waitForTimeout(1000);

  const downloadPromise = page.waitForEvent("download");
  await page.evaluate(async () => {
    window.__rec.stop();
    await new Promise((r) => { window.__rec.onstop = r; });
    const blob = new Blob(window.__chunks, { type: "video/webm" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "harness-capture.webm";
    a.click();
  });
  const download = await downloadPromise;
  await download.saveAs(outPath);
  console.log("saved", outPath);
} finally {
  await browser.close();
}
