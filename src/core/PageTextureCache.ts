import {
  LinearFilter,
  LinearMipmapLinearFilter,
  SRGBColorSpace,
  Texture,
} from "three";
import type { PageSource, PageSurface } from "../source/PageSource";

export interface TextureEntry {
  pageIndex: number;
  targetHeight: number;
  texture: Texture;
  surface: PageSurface;
  lastUsed: number;
}

export type TextureRequestPriority = "preload" | "visible" | "turn";

const PRIORITY_WEIGHT: Record<TextureRequestPriority, number> = {
  preload: 0,
  visible: 1,
  turn: 2,
};

interface PendingEntry {
  targetHeight: number;
  generation: number;
  priority: number;
  sequence: number;
  started: boolean;
  controller: AbortController;
  promise: Promise<TextureEntry>;
  resolve: (entry: TextureEntry) => void;
  reject: (error: unknown) => void;
}

interface QueuedEntry {
  pageIndex: number;
  pending: PendingEntry;
}

export class PageTextureCache {
  private entries = new Map<number, TextureEntry>();
  private pending = new Map<number, PendingEntry>();
  private pinned = new Set<number>();
  private retired: TextureEntry[] = [];
  private generation = 0;
  private clock = 0;
  private sequence = 0;
  private activeRenders = 0;
  private criticalMode = false;
  private queue: QueuedEntry[] = [];

  constructor(
    private source: PageSource,
    private limit: number,
  ) {}

  setPinned(pageIndexes: Iterable<number>): void {
    this.pinned = new Set(pageIndexes);
    this.evict();
  }

  setLimit(limit: number): void {
    this.limit = Math.max(1, Math.floor(limit));
    this.evict();
  }

  peek(pageIndex: number): TextureEntry | undefined {
    const entry = this.entries.get(pageIndex);
    if (entry) entry.lastUsed = ++this.clock;
    return entry;
  }

  /** Pause background raster work while a visible page animation is active. */
  setCriticalMode(enabled: boolean): void {
    this.criticalMode = enabled;
    if (enabled) {
      this.cancelMatching(
        (pending) => pending.priority < PRIORITY_WEIGHT.turn,
        "Background page rendering was preempted by a turn.",
      );
    }
    this.pump();
  }

  /** Drop queued speculative work when the reader changes direction or page. */
  cancelPreloads(): void {
    this.cancelMatching(
      (pending) => pending.priority === PRIORITY_WEIGHT.preload,
      "The preload is no longer relevant.",
    );
  }

  async request(
    pageIndex: number,
    targetHeight: number,
    priority: TextureRequestPriority = "visible",
  ): Promise<TextureEntry> {
    const desiredHeight = Math.max(1, Math.round(targetHeight));
    const priorityWeight = PRIORITY_WEIGHT[priority];
    const existing = this.entries.get(pageIndex);
    if (existing && existing.targetHeight >= desiredHeight * 0.92) {
      existing.lastUsed = ++this.clock;
      return existing;
    }

    const inFlight = this.pending.get(pageIndex);
    if (inFlight) {
      if (!inFlight.started && priorityWeight > inFlight.priority) {
        inFlight.priority = priorityWeight;
        this.pump();
      }
      const result = await inFlight.promise;
      if (inFlight.targetHeight >= desiredHeight * 0.92) return result;
      return this.request(pageIndex, desiredHeight, priority);
    }

    const requestGeneration = this.generation;
    let resolve!: (entry: TextureEntry) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<TextureEntry>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const pending: PendingEntry = {
      targetHeight: desiredHeight,
      generation: requestGeneration,
      priority: priorityWeight,
      sequence: ++this.sequence,
      started: false,
      controller: new AbortController(),
      promise,
      resolve,
      reject,
    };
    this.pending.set(pageIndex, pending);
    this.queue.push({ pageIndex, pending });
    this.pump();
    return promise;
  }

  /** Dispose replaced textures only after a renderer pass has uploaded their replacements. */
  disposeRetired(): void {
    const retired = this.retired;
    this.retired = [];
    for (const entry of retired) this.disposeEntry(entry);
  }

  reset(source: PageSource, limit = this.limit): void {
    this.invalidatePending();
    for (const entry of this.entries.values()) this.disposeEntry(entry);
    for (const entry of this.retired) this.disposeEntry(entry);
    this.entries.clear();
    this.retired = [];
    this.pinned.clear();
    this.criticalMode = false;
    this.source = source;
    this.limit = limit;
    this.pump();
  }

  dispose(): void {
    this.invalidatePending();
    for (const entry of this.entries.values()) this.disposeEntry(entry);
    for (const entry of this.retired) this.disposeEntry(entry);
    this.entries.clear();
    this.retired = [];
    this.pinned.clear();
    this.criticalMode = false;
  }

  get size(): number {
    return this.entries.size;
  }

  private evict(): void {
    while (this.entries.size > Math.max(1, this.limit)) {
      const candidate = [...this.entries.values()]
        .filter((entry) => !this.pinned.has(entry.pageIndex))
        .sort((a, b) => a.lastUsed - b.lastUsed)[0];
      if (!candidate) return;
      this.entries.delete(candidate.pageIndex);
      this.disposeEntry(candidate);
    }
  }

  private pump(): void {
    if (this.activeRenders >= 1) return;
    let candidateIndex = -1;
    for (let index = 0; index < this.queue.length; index += 1) {
      const queued = this.queue[index]!;
      if (queued.pending.generation !== this.generation) continue;
      if (this.criticalMode && queued.pending.priority < PRIORITY_WEIGHT.turn) continue;
      if (candidateIndex < 0) {
        candidateIndex = index;
        continue;
      }
      const candidate = this.queue[candidateIndex]!.pending;
      if (
        queued.pending.priority > candidate.priority
        || (queued.pending.priority === candidate.priority && queued.pending.sequence < candidate.sequence)
      ) candidateIndex = index;
    }
    if (candidateIndex < 0) return;

    const [queued] = this.queue.splice(candidateIndex, 1);
    if (!queued) return;
    queued.pending.started = true;
    this.activeRenders += 1;
    void this.runQueued(queued);
  }

  private async runQueued({ pageIndex, pending }: QueuedEntry): Promise<void> {
    try {
      const surface = await this.source.render(pageIndex, pending.targetHeight, pending.controller.signal);
      if (pending.generation !== this.generation || pending.controller.signal.aborted) {
        surface.dispose();
        throw new DOMException("The page render belongs to an old document.", "AbortError");
      }
      const texture = new Texture(surface.image);
      // Worker-rendered pages arrive as pre-flipped ImageBitmaps because
      // browsers ignore UNPACK_FLIP_Y_WEBGL for ImageBitmap uploads.
      texture.flipY = !(typeof ImageBitmap !== "undefined" && surface.image instanceof ImageBitmap);
      texture.colorSpace = SRGBColorSpace;
      texture.minFilter = LinearMipmapLinearFilter;
      texture.magFilter = LinearFilter;
      texture.generateMipmaps = true;
      texture.anisotropy = 4;
      texture.needsUpdate = true;
      const entry: TextureEntry = {
        pageIndex,
        targetHeight: pending.targetHeight,
        texture,
        surface,
        lastUsed: ++this.clock,
      };
      const previous = this.entries.get(pageIndex);
      this.entries.set(pageIndex, entry);
      if (previous) this.retired.push(previous);
      this.evict();
      pending.resolve(entry);
    } catch (error) {
      pending.reject(error);
    } finally {
      const current = this.pending.get(pageIndex);
      if (current === pending) this.pending.delete(pageIndex);
      this.activeRenders = Math.max(0, this.activeRenders - 1);
      this.pump();
    }
  }

  private invalidatePending(): void {
    this.generation += 1;
    const error = new DOMException("The page render belongs to an old document.", "AbortError");
    for (const pending of this.pending.values()) {
      pending.controller.abort();
      pending.reject(error);
    }
    this.pending.clear();
    this.queue = [];
  }

  private cancelMatching(
    matches: (pending: PendingEntry) => boolean,
    message: string,
  ): void {
    const cancelled = new Set<PendingEntry>();
    for (const [pageIndex, pending] of this.pending) {
      if (!matches(pending)) continue;
      cancelled.add(pending);
      this.pending.delete(pageIndex);
      pending.controller.abort();
      pending.reject(new DOMException(message, "AbortError"));
    }
    if (cancelled.size > 0) {
      this.queue = this.queue.filter((queued) => !cancelled.has(queued.pending));
    }
  }

  private disposeEntry(entry: TextureEntry): void {
    entry.texture.dispose();
    entry.surface.dispose();
  }
}
