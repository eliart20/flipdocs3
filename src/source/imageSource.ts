import type { PageSource, PageSurface } from "./PageSource";

type ImageInput = string | Blob | ImageBitmap;

interface LoadedImage {
  image: HTMLImageElement | ImageBitmap;
  width: number;
  height: number;
  dispose(): void;
}

function imageDimensions(image: HTMLImageElement | ImageBitmap): { width: number; height: number } {
  if (image instanceof HTMLImageElement) {
    return { width: image.naturalWidth, height: image.naturalHeight };
  }
  return { width: image.width, height: image.height };
}

async function loadImage(input: ImageInput): Promise<LoadedImage> {
  if (typeof ImageBitmap !== "undefined" && input instanceof ImageBitmap) {
    return { image: input, width: input.width, height: input.height, dispose: () => undefined };
  }

  const objectUrl = input instanceof Blob ? URL.createObjectURL(input) : undefined;
  const image = new Image();
  image.decoding = "async";
  if (!objectUrl) image.crossOrigin = "anonymous";
  image.src = objectUrl ?? (typeof input === "string" ? input : "");
  try {
    await image.decode();
  } catch (error) {
    objectUrl && URL.revokeObjectURL(objectUrl);
    throw error;
  }
  const dimensions = imageDimensions(image);
  if (!dimensions.width || !dimensions.height) {
    objectUrl && URL.revokeObjectURL(objectUrl);
    throw new Error("The page image has no usable dimensions.");
  }
  return {
    image,
    ...dimensions,
    dispose: () => objectUrl && URL.revokeObjectURL(objectUrl),
  };
}

class ImagePageSource implements PageSource {
  readonly pageCount: number;
  readonly pageAspect: number;
  private readonly loaded = new Map<number, Promise<LoadedImage>>();

  private constructor(
    private readonly pages: ImageInput[],
    first: LoadedImage,
  ) {
    this.pageCount = pages.length;
    this.pageAspect = first.width / first.height;
    this.loaded.set(0, Promise.resolve(first));
  }

  static async create(pages: ImageInput[]): Promise<ImagePageSource> {
    if (!pages.length) throw new Error("An image flipbook needs at least one page.");
    const first = await loadImage(pages[0] as ImageInput);
    return new ImagePageSource(pages, first);
  }

  async render(pageIndex: number, targetHeight: number): Promise<PageSurface> {
    const input = this.pages[pageIndex];
    if (input === undefined) throw new RangeError(`Page ${pageIndex + 1} is out of range.`);
    let pending = this.loaded.get(pageIndex);
    if (!pending) {
      pending = loadImage(input);
      this.loaded.set(pageIndex, pending);
    }
    const loaded = await pending;
    const height = Math.max(1, Math.min(loaded.height, Math.round(targetHeight)));
    const width = Math.max(1, Math.round(height * (loaded.width / loaded.height)));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("A 2D canvas context is required for image pages.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(loaded.image, 0, 0, width, height);
    return {
      image: canvas,
      width,
      height,
      dispose: () => {
        canvas.width = 1;
        canvas.height = 1;
      },
    };
  }

  dispose(): void {
    for (const pending of this.loaded.values()) void pending.then((entry) => entry.dispose());
    this.loaded.clear();
  }
}

export function createImagePageSource(pages: ImageInput[]): Promise<PageSource> {
  return ImagePageSource.create(pages);
}
