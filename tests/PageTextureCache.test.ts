import { describe, expect, it } from "vitest";
import { PageTextureCache } from "../src/core/PageTextureCache";
import type { PageSource, PageSurface } from "../src/source/PageSource";

function surface(pageIndex: number, height: number, disposed: number[]): PageSurface {
  return {
    image: { width: height, height } as unknown as CanvasImageSource,
    width: height,
    height,
    dispose: () => disposed.push(pageIndex),
  };
}

class FakeSource implements PageSource {
  readonly pageCount = 20;
  readonly pageAspect = 0.75;
  readonly calls: Array<{ pageIndex: number; height: number }> = [];
  readonly disposedSurfaces: number[] = [];
  disposed = false;

  async render(pageIndex: number, targetHeight: number): Promise<PageSurface> {
    this.calls.push({ pageIndex, height: targetHeight });
    return surface(pageIndex, targetHeight, this.disposedSurfaces);
  }

  dispose(): void {
    this.disposed = true;
  }
}

describe("PageTextureCache", () => {
  it("evicts the least-recently-used unpinned surface", async () => {
    const source = new FakeSource();
    const cache = new PageTextureCache(source, 2);
    await cache.request(0, 100);
    await cache.request(1, 100);
    cache.setPinned([0]);
    await cache.request(2, 100);
    expect(cache.peek(0)).toBeDefined();
    expect(cache.peek(1)).toBeUndefined();
    expect(cache.peek(2)).toBeDefined();
    expect(source.disposedSurfaces).toEqual([1]);
    cache.dispose();
  });

  it("queues a sharper replacement after an in-flight low-resolution request", async () => {
    const calls: number[] = [];
    const disposed: number[] = [];
    let releaseFirst: ((value: PageSurface) => void) | undefined;
    const source: PageSource = {
      pageCount: 1,
      pageAspect: 0.75,
      render: (_page, height) => {
        calls.push(height);
        if (calls.length === 1) {
          return new Promise<PageSurface>((resolve) => { releaseFirst = resolve; });
        }
        return Promise.resolve(surface(0, height, disposed));
      },
      dispose: () => undefined,
    };
    const cache = new PageTextureCache(source, 2);
    const low = cache.request(0, 100);
    const high = cache.request(0, 320);
    releaseFirst?.(surface(0, 100, disposed));
    await Promise.all([low, high]);
    expect(calls).toEqual([100, 320]);
    expect(cache.peek(0)?.targetHeight).toBe(320);
    expect(disposed).toEqual([]);
    cache.disposeRetired();
    expect(disposed).toEqual([0]);
    cache.dispose();
  });

  it("rejects an obsolete render after disposal", async () => {
    let release: ((value: PageSurface) => void) | undefined;
    const disposed: number[] = [];
    const source: PageSource = {
      pageCount: 1,
      pageAspect: 0.75,
      render: () => new Promise<PageSurface>((resolve) => { release = resolve; }),
      dispose: () => undefined,
    };
    const cache = new PageTextureCache(source, 2);
    const pending = cache.request(0, 100);
    cache.dispose();
    release?.(surface(0, 100, disposed));
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(disposed).toEqual([0]);
    expect(cache.size).toBe(0);
  });
});
