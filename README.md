# Flipdocs v2

A small React flipbook for PDF documents and page images. React owns lifecycle and controls; one direct Three.js `WebGLRenderer` owns the flat pages and the single deforming page-turn mesh.

The turning sheet casts a soft real-time shadow map onto the flat pages. Its custom depth pass uses the same deformation uniforms as the visible curl, so the shadow follows corner and diagonal drags.

## Install

```bash
npm install flipdocs3 three pdfjs-dist
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

The forwarded `FlipBookHandle` exposes `next`, `previous`, `goToPage`, zoom methods, fullscreen, deterministic diagnostic poses, PNG download, and `setTuning`. `setTuning({ minimumLift })` controls the shallow-fold clearance used to keep a low turn above the receiving page.

## Input behavior

- Desktop outer corners use the same production mesh for hover and dragging. Pointer-down claims the hover pose; releasing settles from the exact held pose.
- Mobile displays one readable page plus an opposite-page sliver. Moving within a spread is a cursor-attached focus slide; crossing a spread boundary performs the physical curl.
- Outer-half mobile drags become direct after directional slop. Inner-half gestures use a canonical turn.
- Arrow keys, Page Up/Down, Space, `+`, `-`, and `0` are supported when the viewer is focused.
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
```

The development lab includes numbered orientation pages, LTR/RTL switching, all deterministic hover/turn stress poses, live geometry tuning, PNG capture, render metrics, and ten regression PDF choices. The engine has no permanent animation loop: it renders synchronously for direct pointer input, on demand for state changes, and only schedules frames while an animation is active.
