import type { FlipBookSource } from "../types";

export interface PageSurface {
  image: CanvasImageSource;
  width: number;
  height: number;
  dispose(): void;
}

export interface PageSource {
  readonly pageCount: number;
  readonly pageAspect: number;
  render(pageIndex: number, targetHeight: number): Promise<PageSurface>;
  dispose(): void;
}

export async function createPageSource(source: FlipBookSource): Promise<PageSource> {
  if (source.type === "images") {
    const { createImagePageSource } = await import("./imageSource");
    return createImagePageSource(source.pages);
  }
  const { createPdfPageSource } = await import("./pdfSource");
  return createPdfPageSource(source.src);
}
