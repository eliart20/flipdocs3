import {
  LinearFilter,
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

interface PendingEntry {
  targetHeight: number;
  generation: number;
  promise: Promise<TextureEntry>;
}

export class PageTextureCache {
  private entries = new Map<number, TextureEntry>();
  private pending = new Map<number, PendingEntry>();
  private pinned = new Set<number>();
  private retired: TextureEntry[] = [];
  private generation = 0;
  private clock = 0;

  constructor(
    private source: PageSource,
    private limit: number,
  ) {}

  setPinned(pageIndexes: Iterable<number>): void {
    this.pinned = new Set(pageIndexes);
    this.evict();
  }

  peek(pageIndex: number): TextureEntry | undefined {
    const entry = this.entries.get(pageIndex);
    if (entry) entry.lastUsed = ++this.clock;
    return entry;
  }

  async request(pageIndex: number, targetHeight: number): Promise<TextureEntry> {
    const desiredHeight = Math.max(1, Math.round(targetHeight));
    const existing = this.entries.get(pageIndex);
    if (existing && existing.targetHeight >= desiredHeight * 0.92) {
      existing.lastUsed = ++this.clock;
      return existing;
    }

    const inFlight = this.pending.get(pageIndex);
    if (inFlight) {
      const result = await inFlight.promise;
      if (inFlight.targetHeight >= desiredHeight * 0.92) return result;
      return this.request(pageIndex, desiredHeight);
    }

    const requestGeneration = this.generation;
    const promise = this.source.render(pageIndex, desiredHeight).then((surface) => {
      if (requestGeneration !== this.generation) {
        surface.dispose();
        throw new DOMException("The page render belongs to an old document.", "AbortError");
      }
      const texture = new Texture(surface.image);
      texture.colorSpace = SRGBColorSpace;
      texture.minFilter = LinearFilter;
      texture.magFilter = LinearFilter;
      texture.generateMipmaps = false;
      texture.needsUpdate = true;
      const entry: TextureEntry = {
        pageIndex,
        targetHeight: desiredHeight,
        texture,
        surface,
        lastUsed: ++this.clock,
      };
      const previous = this.entries.get(pageIndex);
      this.entries.set(pageIndex, entry);
      if (previous) this.retired.push(previous);
      this.evict();
      return entry;
    }).finally(() => {
      const current = this.pending.get(pageIndex);
      if (current?.promise === promise) this.pending.delete(pageIndex);
    });

    this.pending.set(pageIndex, { targetHeight: desiredHeight, generation: requestGeneration, promise });
    return promise;
  }

  /** Dispose replaced textures only after a renderer pass has uploaded their replacements. */
  disposeRetired(): void {
    const retired = this.retired;
    this.retired = [];
    for (const entry of retired) this.disposeEntry(entry);
  }

  reset(source: PageSource, limit = this.limit): void {
    this.generation += 1;
    for (const entry of this.entries.values()) this.disposeEntry(entry);
    for (const entry of this.retired) this.disposeEntry(entry);
    this.entries.clear();
    this.retired = [];
    this.pending.clear();
    this.pinned.clear();
    this.source = source;
    this.limit = limit;
  }

  dispose(): void {
    this.generation += 1;
    for (const entry of this.entries.values()) this.disposeEntry(entry);
    for (const entry of this.retired) this.disposeEntry(entry);
    this.entries.clear();
    this.retired = [];
    this.pending.clear();
    this.pinned.clear();
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

  private disposeEntry(entry: TextureEntry): void {
    entry.texture.dispose();
    entry.surface.dispose();
  }
}
