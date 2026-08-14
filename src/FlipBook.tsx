import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { FlipBookEngine, DEFAULT_TUNING } from "./core/FlipBookEngine";
import type {
  DiagnosticSnapshot,
  FlipBookHandle,
  FlipBookProps,
  PageEvent,
  ReadyEvent,
} from "./types";
import "./flipbook.css";

function Icon({ name }: { name: "previous" | "next" | "minus" | "plus" | "fullscreen" }) {
  const paths = {
    previous: <path d="m14.5 6-6 6 6 6" />,
    next: <path d="m9.5 6 6 6-6 6" />,
    minus: <path d="M5 12h14" />,
    plus: <path d="M5 12h14M12 5v14" />,
    fullscreen: <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />,
  };
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

const emptySnapshot: DiagnosticSnapshot = {
  page: 1,
  pageCount: 0,
  direction: "ltr",
  activeCase: null,
  progress: 0,
  fps: 0,
  renderCount: 0,
  mode: "desktop",
  zoom: 1,
};

export const FlipBook = forwardRef<FlipBookHandle, FlipBookProps>(function FlipBook({
  source,
  direction = "ltr",
  startPage = 1,
  showControls = true,
  showFullscreen = true,
  showFps = false,
  preloadRadius = 2,
  cacheSize = 8,
  maxPixelRatio = 2,
  maxTextureHeight = 4096,
  interactive = true,
  spine = {},
  className = "",
  onReady,
  onPageChange,
  onZoomChange,
  onError,
}, forwardedRef) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<FlipBookEngine | undefined>(undefined);
  const callbackRef = useRef({ onReady, onPageChange, onZoomChange, onError });
  const [snapshot, setSnapshot] = useState<DiagnosticSnapshot>({ ...emptySnapshot, direction });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  callbackRef.current = { onReady, onPageChange, onZoomChange, onError };

  useLayoutEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    const engine = new FlipBookEngine({
      root,
      canvas,
      direction,
      startPage,
      preloadRadius,
      cacheSize,
      maxPixelRatio,
      maxTextureHeight,
      interactive,
      spine,
      callbacks: {
        onReady: (event: ReadyEvent) => {
          setError(null);
          callbackRef.current.onReady?.(event);
        },
        onPageChange: (event: PageEvent) => {
          setSnapshot(engine.getSnapshot());
          callbackRef.current.onPageChange?.(event);
        },
        onZoomChange: (zoom: number) => {
          setSnapshot(engine.getSnapshot());
          callbackRef.current.onZoomChange?.(zoom);
        },
        onError: (caught: Error) => {
          setError(caught.message);
          callbackRef.current.onError?.(caught);
        },
        onLoadingChange: setLoading,
        onStats: setSnapshot,
      },
    });
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = undefined;
    };
    // Engine lifetime intentionally matches the mounted canvas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    void engineRef.current?.setSource(source);
  }, [source]);

  useEffect(() => engineRef.current?.setDirection(direction), [direction]);

  useEffect(() => {
    engineRef.current?.setRuntimeOptions({
      interactive,
      preloadRadius,
      cacheSize,
      maxPixelRatio,
      maxTextureHeight,
      spine,
    });
  }, [interactive, preloadRadius, cacheSize, maxPixelRatio, maxTextureHeight, spine.visible, spine.widthPx, spine.color]);

  useImperativeHandle(forwardedRef, () => ({
    next: () => engineRef.current?.next(),
    previous: () => engineRef.current?.previous(),
    goToPage: (page) => engineRef.current?.goToPage(page),
    zoomIn: () => engineRef.current?.zoomIn(),
    zoomOut: () => engineRef.current?.zoomOut(),
    resetZoom: () => engineRef.current?.resetZoom(),
    toggleFullscreen: () => engineRef.current?.toggleFullscreen() ?? Promise.resolve(),
    setTuning: (values) => engineRef.current?.setTuning(values),
    setDiagnosticPose: (testCase) => engineRef.current?.setDiagnosticPose(testCase) ?? Promise.resolve(),
    resetPose: () => engineRef.current?.resetPose(),
    downloadPng: (filename) => engineRef.current?.downloadPng(filename),
    getSnapshot: () => engineRef.current?.getSnapshot() ?? { ...emptySnapshot, direction },
  }), [direction]);

  const handleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!interactive) return;
    const engine = engineRef.current;
    if (!engine) return;
    if (event.key === "ArrowRight") direction === "ltr" ? engine.next() : engine.previous();
    else if (event.key === "ArrowLeft") direction === "ltr" ? engine.previous() : engine.next();
    else if (event.key === "PageDown" || event.key === " ") engine.next();
    else if (event.key === "PageUp") engine.previous();
    else if (event.key === "+" || event.key === "=") engine.zoomIn();
    else if (event.key === "-") engine.zoomOut();
    else if (event.key === "0") engine.resetZoom();
    else return;
    event.preventDefault();
  };

  const atStart = snapshot.page <= 1;
  const atEnd = snapshot.page >= snapshot.pageCount;

  return (
    <div
      ref={rootRef}
      className={`flipdocs ${className}`.trim()}
      data-direction={direction}
      data-mode={snapshot.mode}
      data-active-case={snapshot.activeCase ?? "none"}
      tabIndex={0}
      onKeyDown={handleKey}
      aria-label="Flipbook document viewer"
    >
      <canvas ref={canvasRef} className="flipdocs__canvas" aria-label="Rendered document pages" />

      {loading && (
        <div className="flipdocs__loading" role="status">
          <span className="flipdocs__spinner" />
          <span>Preparing pages…</span>
        </div>
      )}

      {error && <div className="flipdocs__error" role="alert">{error}</div>}

      {showFps && (
        <output className="flipdocs__fps" aria-label="Completed WebGL renders per second">
          <span className={snapshot.fps > 0 ? "is-live" : ""} />
          {snapshot.fps > 0 ? `${snapshot.fps} renders/s` : "idle"}
        </output>
      )}

      {showControls && (
        <nav className="flipdocs__controls" aria-label="Document controls">
          <button type="button" onClick={() => engineRef.current?.previous()} disabled={atStart} aria-label="Previous page">
            <Icon name="previous" />
          </button>
          <div className="flipdocs__page-count" aria-live="polite">
            <span>{snapshot.page || 1}</span><i>/</i><span>{snapshot.pageCount || "—"}</span>
          </div>
          <button type="button" onClick={() => engineRef.current?.next()} disabled={atEnd} aria-label="Next page">
            <Icon name="next" />
          </button>
          <span className="flipdocs__divider" />
          <button type="button" onClick={() => engineRef.current?.zoomOut()} aria-label="Zoom out">
            <Icon name="minus" />
          </button>
          <button type="button" className="flipdocs__zoom" onClick={() => engineRef.current?.resetZoom()} aria-label="Reset zoom">
            {Math.round(snapshot.zoom * 100)}%
          </button>
          <button type="button" onClick={() => engineRef.current?.zoomIn()} aria-label="Zoom in">
            <Icon name="plus" />
          </button>
          {showFullscreen && (
            <>
              <span className="flipdocs__divider" />
              <button type="button" onClick={() => void engineRef.current?.toggleFullscreen()} aria-label="Toggle fullscreen">
                <Icon name="fullscreen" />
              </button>
            </>
          )}
        </nav>
      )}
    </div>
  );
});

FlipBook.displayName = "FlipBook";

export { DEFAULT_TUNING };
