import {
  Color,
  DirectionalLight,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  PCFSoftShadowMap,
  PlaneGeometry,
  Scene,
  ShadowMaterial,
  Texture,
  WebGLRenderer,
} from "three";
import type {
  DiagnosticCase,
  DiagnosticSnapshot,
  FlipBookSource,
  FlipBookTuning,
  NavigationDirection,
  PageEvent,
  PageFaceSelection,
  PageSide,
  ReadingDirection,
  ReadyEvent,
  SpineOptions,
  SpreadPages,
} from "../types";
import { createPageSource, type PageSource } from "../source/PageSource";
import { PageTextureCache, type TextureEntry } from "./PageTextureCache";
import {
  DEFAULT_SEGMENTS_X,
  DEFAULT_SEGMENTS_Y,
  clamp01,
  solveCurlState,
  solveProgressForPointer,
} from "./curlGeometry";
import {
  classifyGesture,
  navigationForHorizontalIntent,
  shouldCompleteTurn,
  type GestureMode,
} from "./gestures";
import {
  backwardSide,
  clampPage,
  desktopTargetPage,
  forwardSide,
  isSameSpread,
  mobileTargetPage,
  pagesInSpread,
  selectPageFaces,
  spreadForPage,
} from "./pageSelection";
import {
  createCurlDepthMaterial,
  createCurlMaterial,
  pageMaterial,
  type CurlDepthMaterial,
  type CurlMaterial,
} from "./materials";
import { shadowLightXForTurningSide } from "./shadowDirection";

const PAGE_WIDTH = 1;
const Z_SPINE = -0.01;
const Z_RESTING = 0;
const Z_SHADOW = 0.004;
const Z_TURNING = 0.014;
const SHADOW_SEGMENTS_X = 64;
const SHADOW_SEGMENTS_Y = 48;

export const DEFAULT_TUNING: FlipBookTuning = {
  curlRadius: 0.085,
  minimumLift: 0.018,
  cornerPull: 0.2,
  shadowOpacity: 0.42,
  turnDuration: 620,
  gestureSlop: 6,
  releaseThreshold: 0.34,
  mobilePeek: 0.075,
  qualityScale: 1.08,
};

export interface EngineCallbacks {
  onReady?: (event: ReadyEvent) => void;
  onPageChange?: (event: PageEvent) => void;
  onZoomChange?: (zoom: number) => void;
  onError?: (error: Error) => void;
  onLoadingChange?: (loading: boolean) => void;
  onStats?: (snapshot: DiagnosticSnapshot) => void;
}

export interface FlipBookEngineOptions {
  root: HTMLElement;
  canvas: HTMLCanvasElement;
  direction: ReadingDirection;
  startPage: number;
  preloadRadius: number;
  cacheSize: number;
  maxPixelRatio: number;
  maxTextureHeight: number;
  interactive: boolean;
  spine: SpineOptions;
  mobileBreakpoint?: number;
  callbacks?: EngineCallbacks;
}

interface ActiveTurn {
  navigation: NavigationDirection;
  targetPage: number;
  faces: PageFaceSelection;
  progress: number;
  corner: "top" | "bottom" | null;
  committed: boolean;
  hover: boolean;
  sourceFocus: number;
  targetFocus: number;
  sourceWidth: number;
  targetWidth: number;
  grabX: number;
  grabY: number;
  targetY: number;
  verticalInfluence: number;
}

interface PointerState {
  id: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  lastTime: number;
  velocityX: number;
  progressVelocity: number;
  mode: GestureMode | "focus" | "pan";
  navigation: NavigationDirection | null;
  materialX: number;
  grabY: number;
  targetY: number;
  corner: "top" | "bottom" | null;
  startProgress: number;
  focusProgress: number;
}

interface FocusSlide {
  fromPage: number;
  toPage: number;
  progress: number;
}

function makePaperTexture(): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 8;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "#fffefa";
    context.fillRect(0, 0, 8, 8);
  }
  const texture = new Texture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function pageCenter(side: PageSide, gap: number): number {
  return side === "left" ? -(PAGE_WIDTH + gap) / 2 : (PAGE_WIDTH + gap) / 2;
}

function sideOfPage(spread: SpreadPages, page: number): PageSide | null {
  if (spread.left === page) return "left";
  if (spread.right === page) return "right";
  return null;
}

function easeInOutCubic(value: number): number {
  return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export class FlipBookEngine {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 20);
  private readonly paperTexture = makePaperTexture();
  private readonly leftMaterial = pageMaterial(this.paperTexture);
  private readonly rightMaterial = pageMaterial(this.paperTexture);
  private readonly leftMesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly rightMesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly curlMaterial: CurlMaterial;
  private readonly curlDepthMaterial: CurlDepthMaterial;
  private readonly curlMesh: Mesh<PlaneGeometry, CurlMaterial>;
  private readonly shadowCasterMaterial: MeshBasicMaterial;
  private readonly shadowCasterMesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly leftShadowMaterial: ShadowMaterial;
  private readonly rightShadowMaterial: ShadowMaterial;
  private readonly leftShadowMesh: Mesh<PlaneGeometry, ShadowMaterial>;
  private readonly rightShadowMesh: Mesh<PlaneGeometry, ShadowMaterial>;
  private readonly shadowLight: DirectionalLight;
  private readonly spineMaterial: MeshBasicMaterial;
  private readonly spineMesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly resizeObserver: ResizeObserver;

  private callbacks: EngineCallbacks;
  private direction: ReadingDirection;
  private startPage: number;
  private preloadRadius: number;
  private cacheSize: number;
  private maxPixelRatio: number;
  private maxTextureHeight: number;
  private interactive: boolean;
  private spine: Required<SpineOptions>;
  private readonly mobileBreakpoint: number;
  private tuning: FlipBookTuning = { ...DEFAULT_TUNING };

  private source?: PageSource;
  private cache?: PageTextureCache;
  private sourceGeneration = 0;
  private pageCount = 0;
  private pageAspect = 0.72;
  private pageHeight = 1 / this.pageAspect;
  private page = 1;
  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private mobile = false;
  private gapWorld = 0.008;
  private displayedSpread: SpreadPages = { left: null, right: null };
  private viewToken = 0;
  private activeTurn: ActiveTurn | null = null;
  private focusSlide: FocusSlide | null = null;
  private pointer: PointerState | null = null;
  private activeCase: DiagnosticCase | null = null;
  private hoverRequest = 0;
  private animationFrame: number | null = null;
  private renderFrame: number | null = null;
  private zoomRasterTimer: number | null = null;
  private destroyed = false;

  private renderCount = 0;
  private fps = 0;
  private readonly renderTimes: number[] = [];
  private readonly statsTimer: number;

  constructor(options: FlipBookEngineOptions) {
    this.root = options.root;
    this.canvas = options.canvas;
    this.direction = options.direction;
    this.startPage = options.startPage;
    this.preloadRadius = Math.max(0, Math.floor(options.preloadRadius));
    this.cacheSize = Math.max(4, Math.floor(options.cacheSize));
    this.maxPixelRatio = Math.max(1, options.maxPixelRatio);
    this.maxTextureHeight = Math.max(512, options.maxTextureHeight);
    this.interactive = options.interactive;
    this.spine = {
      visible: options.spine.visible ?? true,
      widthPx: options.spine.widthPx ?? 3,
      color: options.spine.color ?? "#222a35",
    };
    this.mobileBreakpoint = options.mobileBreakpoint ?? 760;
    this.callbacks = options.callbacks ?? {};

    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    });
    this.renderer.setClearColor(new Color("#000000"), 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.maxPixelRatio));
    this.renderer.outputColorSpace = "srgb";
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.camera.position.set(0, 0, 5);
    this.camera.lookAt(0, 0, 0);

    const pageGeometry = new PlaneGeometry(PAGE_WIDTH, this.pageHeight);
    this.leftMesh = new Mesh(pageGeometry.clone(), this.leftMaterial);
    this.rightMesh = new Mesh(pageGeometry.clone(), this.rightMaterial);
    this.leftMesh.position.z = Z_RESTING;
    this.rightMesh.position.z = Z_RESTING;
    this.scene.add(this.leftMesh, this.rightMesh);

    this.leftShadowMaterial = new ShadowMaterial({
      color: new Color("#07101b"),
      opacity: this.tuning.shadowOpacity,
      depthWrite: false,
      toneMapped: false,
    });
    this.rightShadowMaterial = this.leftShadowMaterial.clone();
    this.leftShadowMesh = new Mesh(pageGeometry.clone(), this.leftShadowMaterial);
    this.rightShadowMesh = new Mesh(pageGeometry.clone(), this.rightShadowMaterial);
    this.leftShadowMesh.position.z = Z_SHADOW;
    this.rightShadowMesh.position.z = Z_SHADOW;
    this.leftShadowMesh.receiveShadow = true;
    this.rightShadowMesh.receiveShadow = true;
    this.leftShadowMesh.visible = false;
    this.rightShadowMesh.visible = false;
    this.scene.add(this.leftShadowMesh, this.rightShadowMesh);

    const curlGeometry = this.createCurlGeometry();
    this.curlMaterial = createCurlMaterial(
      this.paperTexture,
      this.paperTexture,
      this.pageHeight,
    );
    this.curlDepthMaterial = createCurlDepthMaterial();
    this.curlMesh = new Mesh(curlGeometry, this.curlMaterial);
    this.curlMesh.frustumCulled = false;
    this.curlMesh.visible = false;
    this.curlMesh.position.z = Z_TURNING;
    this.scene.add(this.curlMesh);

    this.shadowCasterMaterial = new MeshBasicMaterial({
      colorWrite: false,
      depthWrite: false,
      depthTest: false,
      toneMapped: false,
    });
    this.shadowCasterMesh = new Mesh(
      this.createCurlGeometry(SHADOW_SEGMENTS_X, SHADOW_SEGMENTS_Y),
      this.shadowCasterMaterial,
    );
    this.shadowCasterMesh.customDepthMaterial = this.curlDepthMaterial;
    this.shadowCasterMesh.castShadow = true;
    this.shadowCasterMesh.frustumCulled = false;
    this.curlMesh.add(this.shadowCasterMesh);

    this.shadowLight = new DirectionalLight(0xffffff, 1);
    this.shadowLight.position.set(0, 1.1, 3.2);
    this.shadowLight.target.position.set(0, 0, 0);
    this.shadowLight.castShadow = true;
    this.shadowLight.shadow.mapSize.set(512, 512);
    this.shadowLight.shadow.camera.left = -1.35;
    this.shadowLight.shadow.camera.right = 1.35;
    this.shadowLight.shadow.camera.top = 1.15;
    this.shadowLight.shadow.camera.bottom = -1.15;
    this.shadowLight.shadow.camera.near = 0.2;
    this.shadowLight.shadow.camera.far = 7;
    this.shadowLight.shadow.bias = -0.00035;
    this.shadowLight.shadow.normalBias = 0.002;
    this.scene.add(this.shadowLight, this.shadowLight.target);

    this.spineMaterial = new MeshBasicMaterial({ color: this.spine.color, toneMapped: false });
    this.spineMesh = new Mesh(new PlaneGeometry(this.gapWorld, this.pageHeight), this.spineMaterial);
    this.spineMesh.position.z = Z_SPINE;
    this.scene.add(this.spineMesh);

    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerCancel);
    this.canvas.addEventListener("pointerleave", this.onPointerLeave);
    this.canvas.addEventListener("wheel", this.onWheel, { passive: false });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.root);
    this.statsTimer = window.setInterval(() => this.sampleStats(), 350);
    this.resize();
  }

  setCallbacks(callbacks: EngineCallbacks): void {
    this.callbacks = callbacks;
  }

  setRuntimeOptions(options: {
    interactive?: boolean;
    preloadRadius?: number;
    cacheSize?: number;
    maxPixelRatio?: number;
    maxTextureHeight?: number;
    spine?: SpineOptions;
  }): void {
    if (options.interactive !== undefined) this.interactive = options.interactive;
    if (options.preloadRadius !== undefined) this.preloadRadius = Math.max(0, Math.floor(options.preloadRadius));
    if (options.cacheSize !== undefined) this.cacheSize = Math.max(4, Math.floor(options.cacheSize));
    if (options.maxTextureHeight !== undefined) this.maxTextureHeight = Math.max(512, options.maxTextureHeight);
    if (options.maxPixelRatio !== undefined) {
      this.maxPixelRatio = Math.max(1, options.maxPixelRatio);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.maxPixelRatio));
    }
    if (options.spine) {
      this.spine = {
        visible: options.spine.visible ?? this.spine.visible,
        widthPx: options.spine.widthPx ?? this.spine.widthPx,
        color: options.spine.color ?? this.spine.color,
      };
      this.spineMaterial.color.set(this.spine.color);
    }
    this.resize();
  }

  setDirection(direction: ReadingDirection): void {
    if (direction === this.direction) return;
    this.resetPose();
    this.direction = direction;
    void this.showStableSpread(false);
    this.updateCamera();
    this.emitPageChange();
  }

  async setSource(sourceDefinition: FlipBookSource): Promise<void> {
    const generation = ++this.sourceGeneration;
    this.hoverRequest += 1;
    this.viewToken += 1;
    this.callbacks.onLoadingChange?.(true);
    this.stopAnimation();
    this.activeTurn = null;
    this.focusSlide = null;
    this.curlMesh.visible = false;
    this.setShadowReceiversVisible(false);

    try {
      const nextSource = await createPageSource(sourceDefinition);
      if (generation !== this.sourceGeneration || this.destroyed) {
        nextSource.dispose();
        return;
      }

      this.cache?.dispose();
      this.source?.dispose();
      this.source = nextSource;
      this.cache = new PageTextureCache(nextSource, this.cacheSize);
      this.pageCount = nextSource.pageCount;
      this.pageAspect = nextSource.pageAspect;
      this.pageHeight = 1 / this.pageAspect;
      this.page = clampPage(this.startPage, this.pageCount);
      this.zoom = 1;
      this.panX = 0;
      this.panY = 0;
      this.rebuildPageGeometry();
      this.resize();
      await this.showStableSpread(true);
      if (generation !== this.sourceGeneration || this.destroyed) return;
      this.callbacks.onLoadingChange?.(false);
      this.callbacks.onReady?.({
        pageCount: this.pageCount,
        pageAspect: this.pageAspect,
        direction: this.direction,
      });
      this.emitPageChange();
      this.preloadNearby();
    } catch (error) {
      if (generation !== this.sourceGeneration || this.destroyed || isAbort(error)) return;
      this.callbacks.onLoadingChange?.(false);
      this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private createCurlGeometry(
    segmentsX = DEFAULT_SEGMENTS_X,
    segmentsY = DEFAULT_SEGMENTS_Y,
  ): PlaneGeometry {
    const geometry = new PlaneGeometry(
      PAGE_WIDTH,
      this.pageHeight,
      segmentsX,
      segmentsY,
    );
    geometry.translate(PAGE_WIDTH / 2, 0, 0);
    return geometry;
  }

  private rebuildPageGeometry(): void {
    const replace = (mesh: { geometry: PlaneGeometry }, geometry: PlaneGeometry) => {
      mesh.geometry.dispose();
      mesh.geometry = geometry;
    };
    replace(this.leftMesh, new PlaneGeometry(PAGE_WIDTH, this.pageHeight));
    replace(this.rightMesh, new PlaneGeometry(PAGE_WIDTH, this.pageHeight));
    replace(this.leftShadowMesh, new PlaneGeometry(PAGE_WIDTH, this.pageHeight));
    replace(this.rightShadowMesh, new PlaneGeometry(PAGE_WIDTH, this.pageHeight));
    replace(this.curlMesh, this.createCurlGeometry());
    replace(this.shadowCasterMesh, this.createCurlGeometry(SHADOW_SEGMENTS_X, SHADOW_SEGMENTS_Y));
    replace(this.spineMesh, new PlaneGeometry(this.gapWorld, this.pageHeight));
    this.curlMaterial.uniforms.uPageHeight.value = this.pageHeight;
  }

  private resize(): void {
    if (this.destroyed) return;
    const rect = this.root.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const wasMobile = this.mobile;
    this.mobile = width <= this.mobileBreakpoint;
    this.renderer.setSize(width, height, false);
    const approximateViewWidth = this.mobile ? 1 + this.tuning.mobilePeek : 2.12;
    this.gapWorld = Math.max(0.002, (this.spine.widthPx / width) * approximateViewWidth);
    this.positionRestingPages();
    this.spineMesh.geometry.dispose();
    this.spineMesh.geometry = new PlaneGeometry(this.gapWorld, this.pageHeight);
    if (wasMobile !== this.mobile) {
      this.resetPose();
      void this.showStableSpread(false);
    }
    this.updateCamera();
    this.requestRender();
    this.scheduleSharpRefresh();
  }

  private stableFocus(page = this.page, spread = spreadForPage(page, this.pageCount, this.direction)): number {
    const left = spread.left !== null;
    const right = spread.right !== null;
    if (this.mobile) {
      const side = sideOfPage(spread, page) ?? (right ? "right" : "left");
      const center = pageCenter(side, this.gapWorld);
      const towardHinge = side === "right" ? -1 : 1;
      return center + towardHinge * this.tuning.mobilePeek * PAGE_WIDTH * 0.42;
    }
    if (left && !right) return pageCenter("left", this.gapWorld);
    if (right && !left) return pageCenter("right", this.gapWorld);
    return 0;
  }

  private stableBookWidth(spread = spreadForPage(this.page, this.pageCount, this.direction)): number {
    if (this.mobile) return PAGE_WIDTH * (1 + this.tuning.mobilePeek);
    return spread.left !== null && spread.right !== null ? PAGE_WIDTH * 2 + this.gapWorld : PAGE_WIDTH;
  }

  private updateCamera(): void {
    const rect = this.root.getBoundingClientRect();
    const aspect = Math.max(0.1, rect.width / Math.max(1, rect.height));
    let focus = this.stableFocus();
    let contentWidth = this.stableBookWidth();

    if (this.activeTurn?.committed) {
      const progress = this.activeTurn.progress;
      focus = this.activeTurn.sourceFocus + (this.activeTurn.targetFocus - this.activeTurn.sourceFocus) * progress;
      contentWidth = this.activeTurn.sourceWidth + (this.activeTurn.targetWidth - this.activeTurn.sourceWidth) * progress;
    } else if (this.focusSlide) {
      const from = this.stableFocus(
        this.focusSlide.fromPage,
        spreadForPage(this.focusSlide.fromPage, this.pageCount, this.direction),
      );
      const to = this.stableFocus(
        this.focusSlide.toPage,
        spreadForPage(this.focusSlide.toPage, this.pageCount, this.direction),
      );
      focus = from + (to - from) * this.focusSlide.progress;
    }

    const padding = this.mobile ? 0.94 : 0.9;
    let viewWidth: number;
    let viewHeight: number;
    if (aspect >= contentWidth / this.pageHeight) {
      viewHeight = this.pageHeight / padding;
      viewWidth = viewHeight * aspect;
    } else {
      viewWidth = contentWidth / padding;
      viewHeight = viewWidth / aspect;
    }
    viewWidth /= this.zoom;
    viewHeight /= this.zoom;
    this.camera.left = -viewWidth / 2;
    this.camera.right = viewWidth / 2;
    this.camera.top = viewHeight / 2;
    this.camera.bottom = -viewHeight / 2;
    this.camera.position.x = focus + this.panX;
    this.camera.position.y = this.panY;
    this.camera.updateProjectionMatrix();

    const hasBoth = this.displayedSpread.left !== null && this.displayedSpread.right !== null;
    this.spineMesh.visible = this.spine.visible && hasBoth;
    this.requestRender();
  }

  private targetTextureHeight(baseResolution = false): number {
    const rect = this.root.getBoundingClientRect();
    const viewHeight = Math.max(0.001, this.camera.top - this.camera.bottom);
    const cssHeight = (this.pageHeight / viewHeight) * Math.max(1, rect.height);
    const ratio = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio);
    const zoomAdjustment = baseResolution ? Math.min(1, 1 / this.zoom) : 1;
    return Math.min(
      this.maxTextureHeight,
      Math.max(256, Math.ceil(cssHeight * ratio * this.tuning.qualityScale * zoomAdjustment)),
    );
  }

  private async showStableSpread(awaitVisible: boolean): Promise<void> {
    if (!this.cache || !this.pageCount) return;
    const spread = spreadForPage(this.page, this.pageCount, this.direction);
    await this.showSpread(spread, awaitVisible);
  }

  private async showSpread(spread: SpreadPages, awaitVisible: boolean): Promise<void> {
    const cache = this.cache;
    if (!cache) return;
    const token = ++this.viewToken;
    this.displayedSpread = spread;
    this.positionRestingPages();
    this.updatePins();
    const targetHeight = this.targetTextureHeight();
    const jobs = [
      this.assignPage(this.leftMesh, "left", spread.left, targetHeight, token),
      this.assignPage(this.rightMesh, "right", spread.right, targetHeight, token),
    ];
    this.updateCamera();
    if (awaitVisible) await Promise.all(jobs);
  }

  private positionRestingPages(): void {
    this.leftMesh.position.x = pageCenter("left", this.gapWorld);
    this.rightMesh.position.x = pageCenter("right", this.gapWorld);
    this.leftShadowMesh.position.x = this.leftMesh.position.x;
    this.rightShadowMesh.position.x = this.rightMesh.position.x;
  }

  private setShadowReceiversVisible(visible: boolean): void {
    if (!visible || !this.activeTurn || this.tuning.shadowOpacity <= 0.001) {
      this.leftShadowMesh.visible = false;
      this.rightShadowMesh.visible = false;
      this.shadowCasterMesh.visible = false;
      return;
    }
    this.shadowCasterMesh.visible = true;
    this.leftShadowMaterial.opacity = this.tuning.shadowOpacity;
    this.rightShadowMaterial.opacity = this.tuning.shadowOpacity;
    // Never choose a receiver in application code. A real shadow can cross the
    // gutter at any drag angle, so every visible page beneath the sheet must
    // receive it and the light's depth map alone decides where it lands.
    this.leftShadowMesh.visible = this.leftMesh.visible;
    this.rightShadowMesh.visible = this.rightMesh.visible;
  }

  private async assignPage(
    mesh: Mesh<PlaneGeometry, MeshBasicMaterial>,
    side: PageSide,
    pageNumber: number | null,
    targetHeight: number,
    token: number,
  ): Promise<void> {
    if (!this.cache || pageNumber === null) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    const pageIndex = pageNumber - 1;
    const ready = this.cache.peek(pageIndex);
    if (ready) this.installTexture(mesh, ready);
    else this.installTexture(mesh, { texture: this.paperTexture } as TextureEntry);
    this.requestRender();

    try {
      const entry = await this.cache.request(pageIndex, targetHeight);
      const expected = side === "left" ? this.displayedSpread.left : this.displayedSpread.right;
      if (token !== this.viewToken || expected !== pageNumber || this.destroyed) return;
      this.installTexture(mesh, entry);
      this.requestRender();
    } catch (error) {
      if (!isAbort(error)) this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private installTexture(mesh: Mesh<PlaneGeometry, MeshBasicMaterial>, entry: TextureEntry): void {
    if (mesh.material.map === entry.texture) return;
    mesh.material.map = entry.texture;
    mesh.material.needsUpdate = true;
  }

  private updatePins(): void {
    if (!this.cache) return;
    const pinned = pagesInSpread(this.displayedSpread).map((page) => page - 1);
    if (this.activeTurn) {
      pinned.push(this.activeTurn.faces.frontPage - 1);
      if (this.activeTurn.faces.backPage !== null) pinned.push(this.activeTurn.faces.backPage - 1);
    }
    this.cache.setPinned(pinned);
  }

  private preloadNearby(): void {
    if (!this.cache || !this.pageCount) return;
    const height = this.targetTextureHeight(true);
    const ordered: number[] = [];
    for (let offset = 1; offset <= Math.max(2, this.preloadRadius); offset += 1) {
      if (this.page + offset <= this.pageCount) ordered.push(this.page + offset);
    }
    for (let offset = 1; offset <= Math.max(1, this.preloadRadius); offset += 1) {
      if (this.page - offset >= 1) ordered.push(this.page - offset);
    }
    for (const page of ordered) {
      void this.cache.request(page - 1, height).then(() => this.requestRender()).catch((error) => {
        if (!isAbort(error)) this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
      });
    }
  }

  private scheduleSharpRefresh(): void {
    if (this.zoomRasterTimer !== null) window.clearTimeout(this.zoomRasterTimer);
    this.zoomRasterTimer = window.setTimeout(() => {
      this.zoomRasterTimer = null;
      void this.refreshVisibleTextures();
    }, 190);
  }

  private async refreshVisibleTextures(): Promise<void> {
    if (!this.cache) return;
    const token = this.viewToken;
    const height = this.targetTextureHeight();
    const jobs: Promise<void>[] = [];
    const refresh = (mesh: Mesh<PlaneGeometry, MeshBasicMaterial>, pageNumber: number | null) => {
      if (pageNumber === null) return;
      jobs.push(this.cache!.request(pageNumber - 1, height).then((entry) => {
        if (token !== this.viewToken || this.destroyed) return;
        this.installTexture(mesh, entry);
        this.requestRender();
      }).catch((error) => {
        if (!isAbort(error)) this.callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
      }));
    };
    refresh(this.leftMesh, this.displayedSpread.left);
    refresh(this.rightMesh, this.displayedSpread.right);
    await Promise.all(jobs);
  }

  private navigationTarget(navigation: NavigationDirection): number {
    return this.mobile
      ? mobileTargetPage(this.page, this.pageCount, navigation)
      : desktopTargetPage(this.page, this.pageCount, navigation);
  }

  private canNavigate(navigation: NavigationDirection): boolean {
    return this.navigationTarget(navigation) !== this.page;
  }

  private async textureForPage(pageNumber: number | null): Promise<Texture> {
    if (pageNumber === null || !this.cache) return this.paperTexture;
    const pageIndex = pageNumber - 1;
    const ready = this.cache.peek(pageIndex);
    if (ready) return ready.texture;
    return (await this.cache.request(pageIndex, this.targetTextureHeight())).texture;
  }

  private async prepareTurn(
    navigation: NavigationDirection,
    hover: boolean,
    corner: "top" | "bottom" | null,
    interaction?: Pick<ActiveTurn, "grabX" | "grabY" | "targetY" | "verticalInfluence">,
    initialProgress = hover ? 0.075 : 0,
  ): Promise<ActiveTurn | null> {
    if (!this.cache || !this.pageCount) return null;
    const targetPage = this.navigationTarget(navigation);
    if (targetPage === this.page) return null;
    const faces = selectPageFaces(this.page, targetPage, this.pageCount, this.direction, navigation);
    if (!faces) return null;
    const request = ++this.hoverRequest;
    const sourcePages = pagesInSpread(faces.source).map((page) => page - 1);
    sourcePages.push(faces.frontPage - 1);
    if (faces.backPage !== null) sourcePages.push(faces.backPage - 1);
    this.cache.setPinned(sourcePages);

    const [front, back] = await Promise.all([
      this.textureForPage(faces.frontPage),
      this.textureForPage(faces.backPage),
    ]);
    if (request !== this.hoverRequest || this.destroyed) return null;

    const sourceFocus = this.stableFocus(this.page, faces.source);
    const targetFocus = this.stableFocus(targetPage, faces.target);
    const sourceWidth = this.stableBookWidth(faces.source);
    const targetWidth = this.stableBookWidth(faces.target);
    const defaultGrabY = corner === "top" ? 1 : corner === "bottom" ? 0 : 0.12;
    const defaultTargetY = corner === "top"
      ? 1 - this.tuning.cornerPull
      : corner === "bottom"
        ? this.tuning.cornerPull
        : 0.32;
    const turn: ActiveTurn = {
      navigation,
      targetPage,
      faces,
      progress: 0,
      corner,
      committed: !hover,
      hover,
      sourceFocus,
      targetFocus,
      sourceWidth,
      targetWidth,
      grabX: interaction?.grabX ?? 1,
      grabY: interaction?.grabY ?? defaultGrabY,
      targetY: interaction?.targetY ?? defaultTargetY,
      verticalInfluence: interaction?.verticalInfluence ?? 1,
    };
    this.activeTurn = turn;
    this.curlMaterial.uniforms.uFrontMap.value = front;
    this.curlMaterial.uniforms.uBackMap.value = back;
    const sideSign = faces.turningSide === "right" ? 1 : -1;
    this.curlMaterial.uniforms.uSideSign.value = sideSign;
    this.curlDepthMaterial.curlUniforms.uSideSign.value = sideSign;
    this.shadowLight.position.x = shadowLightXForTurningSide(faces.turningSide);
    this.curlMaterial.uniforms.uMirrored.value = faces.turningSide === "left" ? 1 : 0;
    this.curlMesh.position.x = faces.turningSide === "right" ? this.gapWorld / 2 : -this.gapWorld / 2;
    this.curlMesh.visible = true;

    if (!hover) void this.showSpread(faces.underlay, false);
    this.setShadowReceiversVisible(true);
    this.updatePins();
    this.setTurnProgress(initialProgress, true);
    return turn;
  }

  private commitTurn(): void {
    const turn = this.activeTurn;
    if (!turn || turn.committed) return;
    turn.committed = true;
    turn.hover = false;
    void this.showSpread(turn.faces.underlay, false);
    this.setShadowReceiversVisible(true);
    this.updatePins();
    this.updateCamera();
    this.renderNow();
  }

  private setTurnProgress(value: number, immediate = false): void {
    if (!this.activeTurn) return;
    const progress = Math.min(1, Math.max(0, value));
    this.activeTurn.progress = progress;
    this.curlMaterial.uniforms.uProgress.value = progress;
    const curlState = solveCurlState(PAGE_WIDTH, this.pageHeight, {
      progress,
      radius: this.tuning.curlRadius,
      minimumLift: this.tuning.minimumLift,
      side: this.activeTurn.faces.turningSide,
      grabX: this.activeTurn.grabX,
      grabY: this.activeTurn.grabY,
      targetY: this.activeTurn.targetY,
      verticalInfluence: this.activeTurn.verticalInfluence,
    });
    this.curlMaterial.uniforms.uAxis.value.set(curlState.axis.x, curlState.axis.y);
    this.curlMaterial.uniforms.uNormal.value.set(curlState.normal.x, curlState.normal.y);
    this.curlMaterial.uniforms.uActualRadius.value = curlState.radius;
    this.curlMaterial.uniforms.uArcLength.value = curlState.arcLength;
    this.curlDepthMaterial.curlUniforms.uProgress.value = progress;
    this.curlDepthMaterial.curlUniforms.uAxis.value.set(curlState.axis.x, curlState.axis.y);
    this.curlDepthMaterial.curlUniforms.uNormal.value.set(curlState.normal.x, curlState.normal.y);
    this.curlDepthMaterial.curlUniforms.uActualRadius.value = curlState.radius;
    this.curlDepthMaterial.curlUniforms.uArcLength.value = curlState.arcLength;
    this.setShadowReceiversVisible(true);
    this.updateCamera();
    if (immediate) this.renderNow();
    else this.requestRender();
  }

  private async startCanonicalTurn(
    navigation: NavigationDirection,
    corner: "top" | "bottom" | null = null,
    interaction?: Pick<ActiveTurn, "grabX" | "grabY" | "targetY" | "verticalInfluence">,
  ): Promise<void> {
    if (this.activeTurn && this.activeTurn.navigation !== navigation) this.resetPose();
    const turn = this.activeTurn ?? await this.prepareTurn(navigation, false, corner, interaction);
    if (!turn) return;
    this.commitTurn();
    this.animateTurnTo(1);
  }

  private animateTurnTo(target: 0 | 1): void {
    const turn = this.activeTurn;
    if (!turn) return;
    this.stopAnimation();
    const start = turn.progress;
    const distance = Math.abs(target - start);
    const duration = Math.max(150, this.tuning.turnDuration * Math.max(0.3, distance));
    const startedAt = performance.now();
    const startVerticalInfluence = turn.verticalInfluence;

    const frame = (now: number) => {
      if (!this.activeTurn || this.destroyed) return;
      const time = Math.min(1, (now - startedAt) / duration);
      const eased = easeInOutCubic(time);
      const progress = start + (target - start) * eased;
      this.activeTurn.verticalInfluence = startVerticalInfluence * (1 - eased);
      this.setTurnProgress(progress, true);
      if (time < 1) {
        this.animationFrame = requestAnimationFrame(frame);
      } else {
        this.animationFrame = null;
        this.finishTurn(target === 1);
      }
    };
    this.animationFrame = requestAnimationFrame(frame);
  }

  private finishTurn(completed: boolean): void {
    const turn = this.activeTurn;
    if (!turn) return;
    this.activeTurn = null;
    this.curlMesh.visible = false;
    this.setShadowReceiversVisible(false);
    if (completed) this.page = turn.targetPage;
    this.activeCase = null;
    void this.showStableSpread(false);
    this.updateCamera();
    this.emitPageChange();
    this.preloadNearby();
    this.requestRender();
  }

  private stopAnimation(): void {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  next(): void {
    this.navigate("forward");
  }

  previous(): void {
    this.navigate("backward");
  }

  private navigate(navigation: NavigationDirection): void {
    if (!this.canNavigate(navigation) || this.destroyed) return;
    const target = this.navigationTarget(navigation);
    if (this.mobile && isSameSpread(this.page, target, this.pageCount, this.direction)) {
      this.animateFocusSlide(target);
      return;
    }
    void this.startCanonicalTurn(navigation);
  }

  goToPage(page: number): void {
    const target = clampPage(page, this.pageCount);
    if (!target || target === this.page) return;
    this.resetPose();
    this.page = target;
    void this.showStableSpread(false);
    this.updateCamera();
    this.emitPageChange();
    this.preloadNearby();
  }

  private animateFocusSlide(targetPage: number, finishAt: 0 | 1 = 1): void {
    this.stopAnimation();
    const slide = this.focusSlide ?? { fromPage: this.page, toPage: targetPage, progress: 0 };
    this.focusSlide = slide;
    const start = slide.progress;
    const startedAt = performance.now();
    const duration = Math.max(140, 280 * Math.abs(finishAt - start));
    const frame = (now: number) => {
      if (!this.focusSlide || this.destroyed) return;
      const time = Math.min(1, (now - startedAt) / duration);
      this.focusSlide.progress = start + (finishAt - start) * easeInOutCubic(time);
      this.updateCamera();
      this.renderNow();
      if (time < 1) this.animationFrame = requestAnimationFrame(frame);
      else {
        this.animationFrame = null;
        if (finishAt === 1) this.page = targetPage;
        this.focusSlide = null;
        this.updateCamera();
        this.emitPageChange();
        this.requestRender();
      }
    };
    this.animationFrame = requestAnimationFrame(frame);
  }

  zoomIn(): void {
    this.setZoom(this.zoom + 0.25);
  }

  zoomOut(): void {
    this.setZoom(this.zoom - 0.25);
  }

  resetZoom(): void {
    this.panX = 0;
    this.panY = 0;
    this.setZoom(1);
  }

  private setZoom(value: number): void {
    const zoom = Math.min(4, Math.max(0.75, Math.round(value * 100) / 100));
    if (zoom === this.zoom) return;
    this.zoom = zoom;
    if (zoom <= 1) {
      this.panX = 0;
      this.panY = 0;
    }
    this.updateCamera();
    this.callbacks.onZoomChange?.(zoom);
    this.scheduleSharpRefresh();
  }

  setTuning(values: Partial<FlipBookTuning>): void {
    this.tuning = {
      curlRadius: Math.min(0.22, Math.max(0.025, values.curlRadius ?? this.tuning.curlRadius)),
      minimumLift: Math.min(0.08, Math.max(0, values.minimumLift ?? this.tuning.minimumLift)),
      cornerPull: Math.min(0.45, Math.max(0.02, values.cornerPull ?? this.tuning.cornerPull)),
      shadowOpacity: Math.min(0.8, Math.max(0, values.shadowOpacity ?? this.tuning.shadowOpacity)),
      turnDuration: Math.min(1600, Math.max(180, values.turnDuration ?? this.tuning.turnDuration)),
      gestureSlop: Math.min(24, Math.max(2, values.gestureSlop ?? this.tuning.gestureSlop)),
      releaseThreshold: Math.min(0.8, Math.max(0.15, values.releaseThreshold ?? this.tuning.releaseThreshold)),
      mobilePeek: Math.min(0.2, Math.max(0.02, values.mobilePeek ?? this.tuning.mobilePeek)),
      qualityScale: Math.min(2, Math.max(0.6, values.qualityScale ?? this.tuning.qualityScale)),
    };
    this.setShadowReceiversVisible(Boolean(this.activeTurn));
    if (this.activeTurn) this.setTurnProgress(this.activeTurn.progress, true);
    this.resize();
    this.scheduleSharpRefresh();
  }

  private screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const normalizedX = (clientX - rect.left) / Math.max(1, rect.width);
    const normalizedY = (clientY - rect.top) / Math.max(1, rect.height);
    return {
      x: this.camera.position.x + this.camera.left + normalizedX * (this.camera.right - this.camera.left),
      y: this.camera.position.y + this.camera.top - normalizedY * (this.camera.top - this.camera.bottom),
    };
  }

  private pageHit(worldX: number, worldY: number): { side: PageSide; materialX: number } | null {
    if (Math.abs(worldY) > this.pageHeight / 2) return null;
    const leftDistance = Math.abs(worldX - pageCenter("left", this.gapWorld));
    const rightDistance = Math.abs(worldX - pageCenter("right", this.gapWorld));
    let side: PageSide;
    if (this.leftMesh.visible && leftDistance <= PAGE_WIDTH / 2 && (!this.rightMesh.visible || leftDistance <= rightDistance)) {
      side = "left";
    } else if (this.rightMesh.visible && rightDistance <= PAGE_WIDTH / 2) {
      side = "right";
    } else {
      return null;
    }
    const hingeX = side === "right" ? this.gapWorld / 2 : -this.gapWorld / 2;
    const materialX = side === "right" ? worldX - hingeX : hingeX - worldX;
    return { side, materialX: Math.min(PAGE_WIDTH, Math.max(0, materialX)) };
  }

  private cornerAt(worldY: number): "top" | "bottom" | null {
    if (worldY > this.pageHeight * 0.22) return "top";
    if (worldY < -this.pageHeight * 0.22) return "bottom";
    return null;
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.interactive || event.button > 1 || !this.pageCount) return;
    const world = this.screenToWorld(event.clientX, event.clientY);
    const hit = this.pageHit(world.x, world.y);
    const wantsPan = this.zoom > 1 && (event.button === 1 || event.shiftKey || !hit);
    if (!hit && !wantsPan) return;
    event.preventDefault();
    this.canvas.setPointerCapture(event.pointerId);

    if (wantsPan) {
      this.pointer = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        lastTime: event.timeStamp,
        velocityX: 0,
        progressVelocity: 0,
        mode: "pan",
        navigation: null,
        materialX: 0,
        grabY: 0.5,
        targetY: 0.5,
        corner: null,
        startProgress: 0,
        focusProgress: 0,
      };
      return;
    }

    const physicalSide = hit!.side;
    const pointerGrabY = clamp01((world.y + this.pageHeight / 2) / this.pageHeight);
    const pointerCorner = this.cornerAt(world.y);
    let navigation = this.mobile
      ? null
      : navigationForHorizontalIntent(physicalSide, forwardSide(this.direction));

    if (this.activeTurn) {
      const sameSide = this.activeTurn.faces.turningSide === physicalSide;
      if (sameSide) {
        navigation = this.activeTurn.navigation;
        this.stopAnimation();
        this.commitTurn();
      } else if (!this.activeTurn.hover) {
        return;
      } else {
        this.resetPose();
      }
    }

    const attachedTurn = this.activeTurn?.committed ? this.activeTurn : null;
    this.canvas.style.cursor = "grabbing";
    this.pointer = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      lastTime: event.timeStamp,
      velocityX: 0,
      progressVelocity: 0,
      mode: this.activeTurn?.committed ? "direct" : "pending",
      navigation,
      materialX: attachedTurn ? attachedTurn.grabX * PAGE_WIDTH : hit!.materialX,
      grabY: attachedTurn?.grabY ?? pointerGrabY,
      targetY: attachedTurn?.targetY ?? pointerGrabY,
      corner: attachedTurn?.corner ?? pointerCorner,
      startProgress: this.activeTurn?.progress ?? 0,
      focusProgress: 0,
    };
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.pointer || this.pointer.id !== event.pointerId) {
      if (!this.mobile && !this.pointer) this.handleHover(event);
      return;
    }
    event.preventDefault();
    const pointer = this.pointer;
    const elapsed = Math.max(1, event.timeStamp - pointer.lastTime);
    pointer.velocityX = (event.clientX - pointer.lastX) / elapsed;
    pointer.lastX = event.clientX;
    pointer.lastY = event.clientY;
    pointer.lastTime = event.timeStamp;
    const deltaX = event.clientX - pointer.startX;
    const deltaY = event.clientY - pointer.startY;

    if (pointer.mode === "pan") {
      const rect = this.canvas.getBoundingClientRect();
      this.panX -= (event.movementX / Math.max(1, rect.width)) * (this.camera.right - this.camera.left);
      this.panY += (event.movementY / Math.max(1, rect.height)) * (this.camera.top - this.camera.bottom);
      this.updateCamera();
      this.renderNow();
      return;
    }

    if (pointer.mode === "pending") {
      if (this.mobile && pointer.navigation === null && Math.hypot(deltaX, deltaY) >= this.tuning.gestureSlop) {
        const forward = this.direction === "ltr" ? deltaX < 0 : deltaX > 0;
        pointer.navigation = forward ? "forward" : "backward";
      }
      const navigation = pointer.navigation;
      if (!navigation || !this.canNavigate(navigation)) return;
      const target = this.mobile ? mobileTargetPage(this.page, this.pageCount, navigation) : this.navigationTarget(navigation);
      if (this.mobile && isSameSpread(this.page, target, this.pageCount, this.direction)) {
        if (Math.hypot(deltaX, deltaY) < this.tuning.gestureSlop) return;
        pointer.mode = "focus";
        this.focusSlide = { fromPage: this.page, toPage: target, progress: 0 };
      } else {
        const mode = classifyGesture({
          mobile: this.mobile,
          materialX: pointer.materialX,
          pageWidth: PAGE_WIDTH,
          deltaX,
          deltaY,
          slop: this.tuning.gestureSlop,
          turningSide: navigation === "forward" ? forwardSide(this.direction) : backwardSide(this.direction),
        });
        if (mode === "pending") return;
        pointer.mode = mode;
        if (mode === "canonical") return;
        void this.beginDirectDrag(pointer, event.clientX, event.clientY, elapsed);
        return;
      }
    }

    if (pointer.mode === "focus" && this.focusSlide) {
      const rect = this.canvas.getBoundingClientRect();
      const from = this.stableFocus(
        this.focusSlide.fromPage,
        spreadForPage(this.focusSlide.fromPage, this.pageCount, this.direction),
      );
      const to = this.stableFocus(
        this.focusSlide.toPage,
        spreadForPage(this.focusSlide.toPage, this.pageCount, this.direction),
      );
      const flow = this.direction === "ltr" ? 1 : -1;
      const directionalPixels = pointer.navigation === "forward"
        ? -deltaX * flow
        : deltaX * flow;
      const worldPerPixel = (this.camera.right - this.camera.left) / Math.max(1, rect.width);
      pointer.focusProgress = clamp01(
        directionalPixels * worldPerPixel / Math.max(0.0001, Math.abs(to - from)),
      );
      this.focusSlide.progress = pointer.focusProgress;
      this.updateCamera();
      this.renderNow();
      return;
    }

    if (pointer.mode === "direct") this.updateDirectDrag(pointer, event.clientX, event.clientY, elapsed);
  };

  private async beginDirectDrag(pointer: PointerState, clientX: number, clientY: number, elapsed = 16): Promise<void> {
    const navigation = pointer.navigation;
    if (!navigation) return;
    const targetWorld = this.screenToWorld(clientX, clientY);
    pointer.targetY = clamp01((targetWorld.y + this.pageHeight / 2) / this.pageHeight);
    const turn = this.activeTurn ?? await this.prepareTurn(navigation, false, pointer.corner, {
      grabX: pointer.materialX / PAGE_WIDTH,
      grabY: pointer.grabY,
      targetY: pointer.targetY,
      verticalInfluence: 1,
    });
    if (!turn || this.pointer !== pointer || pointer.mode !== "direct") return;
    this.commitTurn();
    this.updateDirectDrag(pointer, clientX, clientY, elapsed);
  }

  private updateDirectDrag(pointer: PointerState, clientX: number, clientY: number, elapsed = 16): void {
    const turn = this.activeTurn;
    if (!turn) return;
    const previousProgress = turn.progress;
    const rect = this.canvas.getBoundingClientRect();
    const normalizedX = (clientX - rect.left) / Math.max(1, rect.width);
    const relativePointerX = this.camera.left
      + normalizedX * (this.camera.right - this.camera.left)
      + this.panX;
    const hinge = turn.faces.turningSide === "right" ? this.gapWorld / 2 : -this.gapWorld / 2;
    const sideSign = turn.faces.turningSide === "right" ? 1 : -1;
    const signedTargetAtSourceFocus = (
      turn.sourceFocus + relativePointerX - hinge
    ) * sideSign;
    const signedFocusTravel = (turn.targetFocus - turn.sourceFocus) * sideSign;
    const progress = solveProgressForPointer(
      pointer.materialX,
      PAGE_WIDTH,
      signedTargetAtSourceFocus,
      this.tuning.curlRadius,
      signedFocusTravel,
    );
    const world = this.screenToWorld(clientX, clientY);
    pointer.targetY = clamp01((world.y + this.pageHeight / 2) / this.pageHeight);
    turn.targetY = pointer.targetY;
    turn.verticalInfluence = 1;
    pointer.progressVelocity = pointer.progressVelocity * 0.55
      + ((progress - previousProgress) / Math.max(1, elapsed) * 1000) * 0.45;
    this.setTurnProgress(progress, true);
  }

  private onPointerUp = (event: PointerEvent): void => {
    const pointer = this.pointer;
    if (!pointer || pointer.id !== event.pointerId) return;
    this.pointer = null;
    this.canvas.style.cursor = "";
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);

    if (pointer.mode === "pan") return;
    if (pointer.mode === "focus" && this.focusSlide) {
      const directionalVelocity = this.direction === "ltr" ? -pointer.velocityX : pointer.velocityX;
      const completes = pointer.focusProgress > 0.34 || directionalVelocity > 0.45;
      this.animateFocusSlide(this.focusSlide.toPage, completes ? 1 : 0);
      return;
    }
    if (pointer.mode === "canonical") {
      if (pointer.navigation) {
        void this.startCanonicalTurn(pointer.navigation, pointer.corner, {
          grabX: pointer.materialX / PAGE_WIDTH,
          grabY: pointer.grabY,
          targetY: pointer.targetY,
          verticalInfluence: 1,
        });
      }
      return;
    }
    if (pointer.mode === "direct" && this.activeTurn) {
      const completes = shouldCompleteTurn({
        progress: this.activeTurn.progress,
        progressVelocity: pointer.progressVelocity,
        threshold: this.tuning.releaseThreshold,
      });
      this.animateTurnTo(completes ? 1 : 0);
      return;
    }
    if (pointer.mode === "pending" && pointer.navigation && this.canNavigate(pointer.navigation)) {
      const targetY = pointer.corner === "top"
        ? 1 - this.tuning.cornerPull
        : pointer.corner === "bottom"
          ? this.tuning.cornerPull
          : pointer.grabY;
      void this.startCanonicalTurn(pointer.navigation, pointer.corner, {
        grabX: pointer.materialX / PAGE_WIDTH,
        grabY: pointer.grabY,
        targetY,
        verticalInfluence: 1,
      });
    }
  };

  private onPointerCancel = (event: PointerEvent): void => {
    if (!this.pointer || this.pointer.id !== event.pointerId) return;
    this.pointer = null;
    this.canvas.style.cursor = "";
    if (this.activeTurn?.committed) this.animateTurnTo(0);
    if (this.focusSlide) this.animateFocusSlide(this.focusSlide.toPage, 0);
  };

  private onPointerLeave = (): void => {
    if (!this.pointer && this.activeTurn?.hover) this.resetPose();
    if (!this.pointer) this.canvas.style.cursor = "default";
  };

  private handleHover(event: PointerEvent): void {
    if (!this.interactive || this.mobile || this.animationFrame !== null) return;
    const world = this.screenToWorld(event.clientX, event.clientY);
    const hit = this.pageHit(world.x, world.y);
    const corner = this.cornerAt(world.y);
    if (!hit || hit.materialX < PAGE_WIDTH * 0.84 || !corner) {
      if (this.activeTurn?.hover) this.resetPose();
      this.canvas.style.cursor = hit
        ? hit.materialX >= PAGE_WIDTH * 0.52 ? "ew-resize" : "grab"
        : "default";
      return;
    }
    const navigation = navigationForHorizontalIntent(hit.side, forwardSide(this.direction));
    if (!this.canNavigate(navigation)) {
      if (this.activeTurn?.hover) this.resetPose();
      this.canvas.style.cursor = "default";
      return;
    }
    this.canvas.style.cursor = "grab";
    const grabY = corner === "top" ? 1 : 0;
    const targetY = clamp01((world.y + this.pageHeight / 2) / this.pageHeight);
    const previewProgress = clamp01((PAGE_WIDTH - hit.materialX) / (2 * PAGE_WIDTH));
    if (
      this.activeTurn?.hover
      && this.activeTurn.navigation === navigation
      && this.activeTurn.corner === corner
    ) {
      this.activeTurn.grabX = 1;
      this.activeTurn.grabY = grabY;
      this.activeTurn.targetY = targetY;
      this.activeTurn.verticalInfluence = 1;
      this.setTurnProgress(previewProgress, true);
      return;
    }
    this.resetPose();
    void this.prepareTurn(navigation, true, corner, {
      grabX: 1,
      grabY,
      targetY,
      verticalInfluence: 1,
    }, previewProgress);
  }

  private onWheel = (event: WheelEvent): void => {
    if (!this.interactive) return;
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      this.setZoom(this.zoom + (event.deltaY < 0 ? 0.18 : -0.18));
      return;
    }
    if (this.zoom > 1) {
      event.preventDefault();
      const scale = (this.camera.top - this.camera.bottom) / Math.max(1, this.canvas.clientHeight);
      this.panX += event.deltaX * scale;
      this.panY -= event.deltaY * scale;
      this.updateCamera();
      this.requestRender();
    }
  };

  async setDiagnosticPose(testCase: DiagnosticCase): Promise<void> {
    this.resetPose();
    const backward = testCase.startsWith("backward");
    const navigation: NavigationDirection = backward ? "backward" : "forward";
    if (!this.canNavigate(navigation)) {
      const fallback = backward ? Math.min(this.pageCount, 4) : Math.min(this.pageCount, 2);
      if (fallback >= 1) {
        this.page = fallback;
        await this.showStableSpread(true);
      }
    }
    if (!this.canNavigate(navigation)) return;
    const corner = testCase.includes("top") ? "top" : testCase.includes("bottom") ? "bottom" : null;
    const hover = testCase.includes("hover");
    const interaction = testCase === "near-spine-diagonal"
      ? { grabX: 0.2, grabY: 0.12, targetY: 0.82, verticalInfluence: 1 }
      : testCase === "extreme-low-high"
        ? { grabX: 1, grabY: 0.04, targetY: 0.96, verticalInfluence: 1 }
        : testCase.includes("mid-turn")
          ? { grabX: 1, grabY: 0.78, targetY: 0.44, verticalInfluence: 1 }
          : undefined;
    const turn = await this.prepareTurn(navigation, hover, corner, interaction);
    if (!turn) return;
    this.activeCase = testCase;
    if (!hover) this.commitTurn();
    const progress = hover
      ? 0.075
      : testCase === "near-spine-diagonal"
        ? 0.28
        : testCase === "extreme-low-high"
          ? 0.62
          : 0.5;
    this.setTurnProgress(progress, true);
    this.sampleStats();
  }

  resetPose(): void {
    this.hoverRequest += 1;
    this.stopAnimation();
    this.pointer = null;
    this.activeCase = null;
    this.focusSlide = null;
    if (this.activeTurn) {
      this.activeTurn = null;
      this.curlMesh.visible = false;
      this.setShadowReceiversVisible(false);
      void this.showStableSpread(false);
      this.updateCamera();
      this.requestRender();
    }
  }

  async toggleFullscreen(): Promise<void> {
    if (document.fullscreenElement === this.root) await document.exitFullscreen();
    else await this.root.requestFullscreen();
  }

  downloadPng(filename = "flipdocs-frame.png"): void {
    this.renderNow();
    const url = this.canvas.toDataURL("image/png");
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
  }

  getSnapshot(): DiagnosticSnapshot {
    return {
      page: this.page,
      pageCount: this.pageCount,
      direction: this.direction,
      activeCase: this.activeCase,
      progress: this.activeTurn?.progress ?? this.focusSlide?.progress ?? 0,
      fps: this.fps,
      renderCount: this.renderCount,
      mode: this.mobile ? "mobile" : "desktop",
      zoom: this.zoom,
    };
  }

  private emitPageChange(): void {
    const spread = spreadForPage(this.page, this.pageCount, this.direction);
    this.callbacks.onPageChange?.({
      page: this.page,
      pageCount: this.pageCount,
      visiblePages: this.mobile ? [this.page] : pagesInSpread(spread),
    });
    this.sampleStats();
  }

  private requestRender(): void {
    if (this.renderFrame !== null || this.destroyed) return;
    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = null;
      this.renderNow();
    });
  }

  private renderNow(): void {
    if (this.destroyed) return;
    if (this.renderFrame !== null) {
      cancelAnimationFrame(this.renderFrame);
      this.renderFrame = null;
    }
    this.renderer.shadowMap.needsUpdate = this.curlMesh.visible
      && (this.leftShadowMesh.visible || this.rightShadowMesh.visible);
    this.renderer.render(this.scene, this.camera);
    this.renderCount += 1;
    this.renderTimes.push(performance.now());
    this.cache?.disposeRetired();
  }

  private sampleStats(): void {
    const now = performance.now();
    while (this.renderTimes.length && (this.renderTimes[0] ?? now) < now - 1000) this.renderTimes.shift();
    this.fps = this.renderTimes.length;
    this.callbacks.onStats?.(this.getSnapshot());
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.sourceGeneration += 1;
    this.stopAnimation();
    if (this.renderFrame !== null) cancelAnimationFrame(this.renderFrame);
    if (this.zoomRasterTimer !== null) window.clearTimeout(this.zoomRasterTimer);
    window.clearInterval(this.statsTimer);
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerCancel);
    this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
    this.canvas.removeEventListener("wheel", this.onWheel);
    this.cache?.dispose();
    this.source?.dispose();
    this.leftMesh.geometry.dispose();
    this.rightMesh.geometry.dispose();
    this.leftShadowMesh.geometry.dispose();
    this.rightShadowMesh.geometry.dispose();
    this.curlMesh.geometry.dispose();
    this.shadowCasterMesh.geometry.dispose();
    this.spineMesh.geometry.dispose();
    this.leftMaterial.dispose();
    this.rightMaterial.dispose();
    this.curlMaterial.dispose();
    this.curlDepthMaterial.dispose();
    this.shadowCasterMaterial.dispose();
    this.leftShadowMaterial.dispose();
    this.rightShadowMaterial.dispose();
    this.shadowLight.shadow.dispose();
    this.spineMaterial.dispose();
    this.paperTexture.dispose();
    this.renderer.dispose();
  }
}
