import type {
  PDFDataRangeTransport,
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
} from "pdfjs-dist";
import type { PageSource, PageSurface } from "./PageSource";

const WORKER_FILE = "pdf.worker.min.mjs";
const RANGE_CHUNK_SIZE = 256 * 1024;

function packagedWorkerUrl(): string {
  if (import.meta.env.DEV && typeof window !== "undefined") {
    return new URL(`/${WORKER_FILE}`, window.location.href).href;
  }
  return new URL("./pdf.worker.min.mjs", import.meta.url).href;
}

function fileName(input: string | Blob): string {
  if (input instanceof Blob && "name" in input && typeof input.name === "string") return input.name;
  if (typeof input === "string") {
    try {
      return decodeURIComponent(new URL(input, document.baseURI).pathname.split("/").at(-1) ?? "document.pdf");
    } catch {
      return "document.pdf";
    }
  }
  return "document.pdf";
}

function blobRangeTransport(
  pdfjs: typeof import("pdfjs-dist"),
  blob: Blob,
): PDFDataRangeTransport {
  class BlobTransport extends pdfjs.PDFDataRangeTransport {
    private stopped = false;

    constructor() {
      super(blob.size, null, true, fileName(blob));
    }

    requestDataRange(begin: number, end: number): void {
      void blob.slice(begin, Math.min(end, blob.size)).arrayBuffer().then((buffer) => {
        if (!this.stopped) this.onDataRange(begin, new Uint8Array(buffer));
      }).catch(() => {
        if (!this.stopped) this.onDataRange(begin, new Uint8Array());
      });
    }

    abort(): void {
      this.stopped = true;
    }
  }

  return new BlobTransport();
}

async function urlRangeTransport(
  pdfjs: typeof import("pdfjs-dist"),
  url: string,
): Promise<PDFDataRangeTransport | undefined> {
  let probe: Response;
  try {
    probe = await fetch(url, { headers: { Range: "bytes=0-0" } });
  } catch {
    return undefined;
  }
  const match = /^bytes\s+0-0\/(\d+)$/i.exec(probe.headers.get("Content-Range") ?? "");
  if (probe.status !== 206 || !match) {
    await probe.body?.cancel().catch(() => undefined);
    return undefined;
  }
  const total = Number(match[1]);
  const initial = new Uint8Array(await probe.arrayBuffer());
  if (!Number.isSafeInteger(total) || total <= 1 || initial.byteLength !== 1) return undefined;

  class UrlTransport extends pdfjs.PDFDataRangeTransport {
    private stopped = false;
    private readonly controllers = new Set<AbortController>();

    constructor() {
      super(total, initial, true, fileName(url));
    }

    requestDataRange(begin: number, end: number): void {
      const boundedEnd = Math.min(total, end);
      const controller = new AbortController();
      this.controllers.add(controller);
      void fetch(url, {
        headers: { Range: `bytes=${begin}-${boundedEnd - 1}` },
        signal: controller.signal,
      }).then(async (response) => {
        if (response.status !== 206) throw new Error(`Expected HTTP 206, received ${response.status}.`);
        const expectedRange = `bytes ${begin}-${boundedEnd - 1}/${total}`;
        if (response.headers.get("Content-Range") !== expectedRange) {
          throw new Error("The PDF server returned an invalid byte range.");
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength !== boundedEnd - begin) throw new Error("The PDF byte range was incomplete.");
        if (!this.stopped) this.onDataRange(begin, bytes);
      }).catch(() => {
        if (!this.stopped) this.onDataRange(begin, new Uint8Array());
      }).finally(() => this.controllers.delete(controller));
    }

    abort(): void {
      this.stopped = true;
      for (const controller of this.controllers) controller.abort();
      this.controllers.clear();
    }
  }

  return new UrlTransport();
}

class PdfPageSource implements PageSource {
  readonly pageCount: number;
  readonly pageAspect: number;

  constructor(
    private readonly document: PDFDocumentProxy,
    private readonly loadingTask: PDFDocumentLoadingTask,
    pageAspect: number,
  ) {
    this.pageCount = document.numPages;
    this.pageAspect = pageAspect;
  }

  async render(pageIndex: number, targetHeight: number): Promise<PageSurface> {
    if (pageIndex < 0 || pageIndex >= this.pageCount) {
      throw new RangeError(`Page ${pageIndex + 1} is out of range.`);
    }
    const page = await this.document.getPage(pageIndex + 1);
    const natural = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.max(0.05, targetHeight / natural.height) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("A 2D canvas context is required for PDF pages.");
    try {
      await page.render({ canvas, canvasContext: context, viewport, background: "#ffffff" }).promise;
    } finally {
      page.cleanup();
    }
    return {
      image: canvas,
      width: canvas.width,
      height: canvas.height,
      dispose: () => {
        canvas.width = 1;
        canvas.height = 1;
      },
    };
  }

  dispose(): void {
    void this.loadingTask.destroy();
  }
}

export async function createPdfPageSource(src: string | File | Blob): Promise<PageSource> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = packagedWorkerUrl();

  let parameters: Parameters<typeof pdfjs.getDocument>[0];
  if (typeof src === "string") {
    const range = await urlRangeTransport(pdfjs, src);
    parameters = range ? {
      url: src,
      docBaseUrl: src,
      range,
      rangeChunkSize: RANGE_CHUNK_SIZE,
      disableStream: true,
      disableAutoFetch: true,
    } : {
      url: src,
      rangeChunkSize: RANGE_CHUNK_SIZE,
      disableStream: false,
      disableAutoFetch: false,
    };
  } else {
    parameters = {
      range: blobRangeTransport(pdfjs, src),
      rangeChunkSize: RANGE_CHUNK_SIZE,
      disableStream: true,
      disableAutoFetch: true,
    };
  }

  const loadingTask = pdfjs.getDocument(parameters);
  const documentProxy = await loadingTask.promise;
  const first = await documentProxy.getPage(1);
  const viewport = first.getViewport({ scale: 1 });
  first.cleanup();
  return new PdfPageSource(documentProxy, loadingTask, viewport.width / viewport.height);
}
