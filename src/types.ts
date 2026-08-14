export type ReadingDirection = "ltr" | "rtl";
export type NavigationDirection = "forward" | "backward";
export type PageSide = "left" | "right";

export type FlipBookSource =
  | {
      type: "pdf";
      src: string | File | Blob;
    }
  | {
      type: "images";
      pages: Array<string | Blob | ImageBitmap>;
    };

export interface SpineOptions {
  visible?: boolean;
  widthPx?: number;
  color?: string;
}

export interface ReadyEvent {
  pageCount: number;
  pageAspect: number;
  direction: ReadingDirection;
}

export interface PageEvent {
  page: number;
  pageCount: number;
  visiblePages: number[];
}

export interface FlipBookProps {
  source: FlipBookSource;
  direction?: ReadingDirection;
  startPage?: number;
  showControls?: boolean;
  showFullscreen?: boolean;
  showFps?: boolean;
  preloadRadius?: number;
  cacheSize?: number;
  maxPixelRatio?: number;
  maxTextureHeight?: number;
  interactive?: boolean;
  spine?: SpineOptions;
  className?: string;
  onReady?: (event: ReadyEvent) => void;
  onPageChange?: (event: PageEvent) => void;
  onZoomChange?: (zoom: number) => void;
  onError?: (error: Error) => void;
}

export interface FlipBookTuning {
  /** Cylinder radius as a fraction of page width. Lower values fold closer to the spread. */
  curlRadius: number;
  /** Minimum visible lift reserved for a shallow moving fold, as a fraction of page width. */
  minimumLift: number;
  /** Vertical pull used by deterministic corner previews (0..0.45 of page height). */
  cornerPull: number;
  /** Analytic contact-shadow opacity. */
  shadowOpacity: number;
  /** Canonical turn duration in milliseconds. */
  turnDuration: number;
  /** Pointer movement before a gesture is classified, in CSS pixels. */
  gestureSlop: number;
  /** Progress at which a slow direct drag completes after release. */
  releaseThreshold: number;
  /** Opposite-page fraction retained in mobile focus mode. */
  mobilePeek: number;
  /** Multiplier applied to viewport-aware page raster size. */
  qualityScale: number;
}

export type DiagnosticCase =
  | "forward-top-hover"
  | "forward-bottom-hover"
  | "backward-top-hover"
  | "backward-bottom-hover"
  | "forward-mid-turn"
  | "backward-mid-turn"
  | "near-spine-diagonal"
  | "extreme-low-high";

export interface DiagnosticSnapshot {
  page: number;
  pageCount: number;
  direction: ReadingDirection;
  activeCase: DiagnosticCase | null;
  progress: number;
  fps: number;
  renderCount: number;
  mode: "desktop" | "mobile";
  zoom: number;
}

export interface FlipBookHandle {
  next(): void;
  previous(): void;
  goToPage(page: number): void;
  zoomIn(): void;
  zoomOut(): void;
  resetZoom(): void;
  toggleFullscreen(): Promise<void>;
  setTuning(values: Partial<FlipBookTuning>): void;
  setDiagnosticPose(testCase: DiagnosticCase): Promise<void>;
  resetPose(): void;
  downloadPng(filename?: string): void;
  getSnapshot(): DiagnosticSnapshot;
}

export interface SpreadPages {
  left: number | null;
  right: number | null;
}

export interface PageFaceSelection {
  source: SpreadPages;
  target: SpreadPages;
  underlay: SpreadPages;
  turningSide: PageSide;
  receivingSide: PageSide;
  frontPage: number;
  backPage: number | null;
}
