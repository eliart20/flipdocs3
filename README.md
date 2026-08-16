# Flipdocs v2

A small React flipbook for PDF documents and page images. React owns lifecycle and controls; one direct Three.js `WebGLRenderer` owns the flat pages and the single deforming page-turn mesh.

The turning sheet uses a lightweight analytic contact band and outer-curl shading, avoiding shadow cameras and depth-map passes. A tunable opposite-corner response keeps the grabbed corner under the pointer while the diagonally opposite corner sags only along the Z axis.

## Install

```bash
npm install github:eliart20/flipdocs3
```

This installs directly from the public GitHub repository; no npm-registry publication is required. The Git dependency runs its `prepare` script and builds `dist/` during installation. To pin an application to an exact release or commit, append a Git tag or SHA:

```bash
npm install github:eliart20/flipdocs3#v0.1.0
```

React and React DOM are peer dependencies (`>=18`). No gesture, animation, UI, state-management, or React Three Fiber package is used.

## Use it

```tsx
import { FlipBook } from "flipdocs3";
import "flipdocs3/style.css";

export function Reader() {
  return (
    <div style={{ width: "100%", height: "min(82svh, 900px)" }}>
      <FlipBook
        source={{ type: "pdf", src: "/books/example.pdf" }}
        direction="ltr"
        startPage={1}
        showControls
        showFullscreen
        showFps={false}
        preloadRadius={2}
        cacheSize={8}
        spine={{ visible: true, widthPx: 3, color: "#202733" }}
        onPageChange={({ page, pageCount }) => console.log(page, pageCount)}
      />
    </div>
  );
}
```

Image books use the same component and never load PDF.js:

```tsx
<FlipBook
  source={{
    type: "images",
    pages: ["/pages/1.webp", "/pages/2.webp", imageBlob, imageBitmap],
  }}
/>
```

Use `direction="rtl"` to mirror reading order, page selection, gestures, geometry, and face assignment without mirroring printed text.

## Props

| Prop | Default | Purpose |
| --- | --- | --- |
| `source` | required | PDF URL/File/Blob or a list of image URL/Blob/ImageBitmap pages. |
| `direction` | `"ltr"` | Explicit LTR or RTL reading order. |
| `startPage` | `1` | Initial one-based page. |
| `showControls` | `true` | Previous/next, page count, zoom, and fullscreen controls. |
| `showFullscreen` | `true` | Include the fullscreen control. |
| `showFps` | `false` | Show completed WebGL renders per second; displays `idle` at zero. |
| `preloadRadius` | `2` | Forward-priority nearby page preloading radius. |
| `cacheSize` | `8` | Bounded page-texture LRU size. Visible and turning textures stay pinned. |
| `maxPixelRatio` | `2` | Device-pixel-ratio ceiling. |
| `maxTextureHeight` | `4096` | PDF/image raster height ceiling. |
| `interactive` | `true` | Enable pointer, wheel, and keyboard input. |
| `spine` | enabled | Sharp center seam options: `visible`, `widthPx`, and `color`. |
| `onReady` | — | Receives page count, aspect, and direction. |
| `onPageChange` | — | Receives the active page and currently visible pages. |
| `onZoomChange` | — | Receives the new zoom value. |
| `onError` | — | Receives loading or rendering failures. |

The forwarded `FlipBookHandle` exposes `next`, `previous`, `goToPage`, zoom methods, fullscreen, deterministic diagnostic poses, a non-destructive GPU benchmark, PNG download, and `setTuning`. For example:

```ts
viewer.current?.setTuning({
  cornerSag: 0.72,    // 0 = no Z sag; 1 = maximum opposite-corner depth sag
  minimumLift: 0.018, // shallow-fold clearance above the receiving page
  qualityScale: 1.08, // PDF/image raster sharpness
  meshQuality: 1,     // live curl tessellation: 0.5..1.5
  minimumTurnFrames: 38, // slow rAF sources extend instead of skipping poses
  shadowOpacity: 0.42 // analytic contact and outer-curl shading
});
```

The corner response fades out at both flat endpoints, pins the complete hinge, and leaves the grabbed material point unchanged in screen space. The geometry regression suite also bounds full-sag local edge stretch to one percent.

## Input behavior

- Desktop outer corners use the same production mesh for hover and dragging. Pointer-down claims the hover pose; releasing settles from the exact held pose.
- Mobile displays one readable page plus an opposite-page sliver. Moving within a spread is a cursor-attached focus slide; crossing a spread boundary performs the physical curl.
- Outer-half mobile drags become direct after directional slop. Inner-half gestures use a canonical turn.
- Arrow keys, Page Up/Down, Space, `+`, `-`, and `0` are supported when the viewer is focused.
- Clicking or dragging the canvas focuses the viewer, so physical Left/Right keys immediately drive the same smooth corner turn as the toolbar arrows.
- Nearby PDF pages preload progressively: turn-sized previews are rastered first, full-quality upgrades run only in browser-idle windows, and any speculative render is cancelled when a gesture or arrow turn begins. The active curl, reverse face, and underlay are pinned and ready before motion starts, so background PDF work cannot interrupt the animation.
- Page textures use trilinear mipmaps and bounded anisotropic filtering. Dense text therefore minifies cleanly while the page tilts instead of shimmering like a full-resolution base texture sampled directly on the curl.
- `runBenchmark(durationMs?, mode?)` physically turns far enough to exceed the normal cache on larger documents, returns to the starting page, synchronizes the GPU once after each completed turn, and restores the reader. It never calls `gl.finish()` inside an animation frame because that changes the cadence being measured. `mode: "cold"` measures real cold PDF preparation; `mode: "preloaded"` first rasterizes and uploads every benchmark page at full display quality and excludes that one-time preload from the animation measurement. A no-work rAF calibration reports the browser's callback ceiling separately from the 60 FPS quality target, so a browser capped near 30 Hz is not misdiagnosed as engine frame loss. The motion trace reports normalized progress, loose-edge travel, and average sampled-sheet travel between every consecutive rendered pose. Results also include exact WebGL calls, per-turn frame range, click-to-first-render latency, CPU WebGL submission cost, p99/worst gaps, Chromium Long Animation Frame stalls, and `cornerSag`. Set `cornerSag: 0` (or choose **Rigid** in the lab) to benchmark without sag.
- Zoomed pointer dragging pans the view. PDF rerasterization is debounced and keeps the previous texture visible.

## PDF delivery

URL PDFs are probed with `Range: bytes=0-0`. A compliant server is then read in explicit 256 KiB ranges without a speculative full download. Servers that ignore ranges fall back to PDF.js streaming. Local `File` and `Blob` inputs are served to PDF.js by `blob.slice(begin, end)` without first copying the complete file into memory.

The package ships `pdf.worker.min.mjs` beside `flipdocs.js` and references it with `new URL(..., import.meta.url)`. Modern bundlers copy that worker asset. If a custom deployment pipeline does not process package-relative URL assets, copy `dist/pdf.worker.min.mjs` to the public location beside the emitted Flipdocs module.

## Development and verification

```bash
npm run dev
npm run typecheck
npm test
npm run build
npm run audit
npm publish --dry-run
```

The development lab includes numbered orientation pages, LTR/RTL switching, all deterministic hover/turn stress poses, Rigid/Paper/Soft corner presets, Fast/Balanced/High quality presets, cold-PDF and preloaded-HQ benchmarks with a six-run comparison history, per-arrow render/latency/stall telemetry, live geometry sliders, PNG capture, render metrics, and ten regression PDF choices. “Rendered frames” are exact engine WebGL render calls; browsers do not expose an exact compositor-presented-frame count to page JavaScript, so Long Animation Frames are shown separately as a main-thread stall signal. A steady 32 ms cadence is now reported as roughly 31 FPS and as missing about half of the 60 FPS target frames—it is no longer treated as zero dropped frames merely because it is consistent. The engine has no permanent animation loop: it renders synchronously for direct pointer input, on demand for state changes, and only schedules frames while an animation or explicit benchmark is active.

## GitHub installation

The package is ESM-only. Direct GitHub installation builds the library and includes its type declarations, stylesheet, lazy source chunks, and PDF worker. The package metadata also retains a public npm configuration for a possible future release, but this repository is not currently published to the npm registry.
