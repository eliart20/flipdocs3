import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
} from "pdfjs-dist";
import pdfParserWorkerSource from "pdfjs-dist/build/pdf.worker.min.mjs?raw";
import type { PageSource, PageSurface } from "./PageSource";
import { openPdfDocument, type MessageFromPdfWorker, type MessageToPdfWorker } from "./pdfCommon";
import PdfRasterWorker from "./pdfRasterWorker.ts?worker&inline";

let parserWorkerUrl: string | undefined;

function packagedWorkerUrl(): string {
  if (!parserWorkerUrl) {
    parserWorkerUrl = URL.createObjectURL(new Blob(
      [pdfParserWorkerSource],
      { type: "text/javascript" },
    ));
  }
  return parserWorkerUrl;
}

/** Rasterizing off the main thread needs both a module worker and OffscreenCanvas 2D. */
function supportsRasterWorker(): boolean {
  return typeof Worker === "function"
    && typeof OffscreenCanvas === "function"
    && typeof OffscreenCanvas.prototype.getContext === "function";
}

interface PendingWorkerRender {
  resolve: (surface: PageSurface) => void;
  reject: (error: unknown) => void;
  detachAbort: () => void;
}

class WorkerPdfPageSource implements PageSource {
  private sequence = 0;
  private readonly pending = new Map<number, PendingWorkerRender>();
  private disposed = false;

  private constructor(
    private readonly worker: Worker,
    readonly pageCount: number,
    readonly pageAspect: number,
  ) {
    this.worker.onmessage = (event: MessageEvent<MessageFromPdfWorker>) => this.onMessage(event.data);
    this.worker.onerror = () => this.failAll(new Error("The PDF raster worker crashed."));
  }

  static create(src: string | Blob, timeoutMs = 120_000): Promise<WorkerPdfPageSource> {
    const worker = new PdfRasterWorker();
    return new Promise<WorkerPdfPageSource>((resolve, reject) => {
      const timeout = setTimeout(() => {
        worker.terminate();
        reject(new Error("The PDF raster worker did not finish loading the document."));
      }, timeoutMs);
      worker.onerror = (event) => {
        clearTimeout(timeout);
        worker.terminate();
        reject(new Error(event.message || "The PDF raster worker failed to start."));
      };
      worker.onmessage = (event: MessageEvent<MessageFromPdfWorker>) => {
        const message = event.data;
        if (message.type === "ready") {
          clearTimeout(timeout);
          resolve(new WorkerPdfPageSource(worker, message.pageCount, message.pageAspect));
        } else if (message.type === "init-error") {
          clearTimeout(timeout);
          worker.terminate();
          reject(new Error(message.message));
        }
      };
      const init: MessageToPdfWorker = {
        type: "init",
        src,
        baseUrl: document.baseURI,
        parserWorkerUrl: packagedWorkerUrl(),
      };
      worker.postMessage(init);
    });
  }

  render(pageIndex: number, targetHeight: number, signal?: AbortSignal): Promise<PageSurface> {
    if (pageIndex < 0 || pageIndex >= this.pageCount) {
      return Promise.reject(new RangeError(`Page ${pageIndex + 1} is out of range.`));
    }
    if (this.disposed) {
      return Promise.reject(new DOMException("The PDF source has been disposed.", "AbortError"));
    }
    if (signal?.aborted) {
      return Promise.reject(new DOMException("The page render was cancelled.", "AbortError"));
    }
    const id = ++this.sequence;
    return new Promise<PageSurface>((resolve, reject) => {
      const cancel = () => this.post({ type: "cancel", id });
      signal?.addEventListener("abort", cancel, { once: true });
      this.pending.set(id, {
        resolve,
        reject,
        detachAbort: () => signal?.removeEventListener("abort", cancel),
      });
      this.post({ type: "render", id, pageIndex, targetHeight: Math.max(1, Math.round(targetHeight)) });
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.post({ type: "destroy" });
    this.failAll(new DOMException("The PDF source has been disposed.", "AbortError"));
    // Give the worker a moment to destroy the loading task before termination.
    setTimeout(() => this.worker.terminate(), 1000);
  }

  private post(message: MessageToPdfWorker): void {
    this.worker.postMessage(message);
  }

  private onMessage(message: MessageFromPdfWorker): void {
    if (message.type === "rendered") {
      const pending = this.takePending(message.id);
      if (!pending) {
        message.bitmap.close();
        return;
      }
      const bitmap = message.bitmap;
      pending.resolve({
        image: bitmap,
        width: message.width,
        height: message.height,
        dispose: () => bitmap.close(),
      });
      return;
    }
    if (message.type === "render-error") {
      const pending = this.takePending(message.id);
      pending?.reject(message.name === "AbortError"
        ? new DOMException("The page render was cancelled.", "AbortError")
        : new Error(message.message));
    }
  }

  private takePending(id: number): PendingWorkerRender | undefined {
    const pending = this.pending.get(id);
    if (!pending) return undefined;
    this.pending.delete(id);
    pending.detachAbort();
    return pending;
  }

  private failAll(error: unknown): void {
    const pending = [...this.pending.values()];
    this.pending.clear();
    for (const entry of pending) {
      entry.detachAbort();
      entry.reject(error);
    }
  }
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

  async render(pageIndex: number, targetHeight: number, signal?: AbortSignal): Promise<PageSurface> {
    if (pageIndex < 0 || pageIndex >= this.pageCount) {
      throw new RangeError(`Page ${pageIndex + 1} is out of range.`);
    }
    if (signal?.aborted) throw new DOMException("The page render was cancelled.", "AbortError");
    const page = await this.document.getPage(pageIndex + 1);
    if (signal?.aborted) {
      page.cleanup();
      throw new DOMException("The page render was cancelled.", "AbortError");
    }
    const natural = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.max(0.05, targetHeight / natural.height) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("A 2D canvas context is required for PDF pages.");
    const task = page.render({ canvas, canvasContext: context, viewport, background: "#ffffff" });
    const cancel = () => task.cancel();
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      await task.promise;
    } catch (error) {
      if (signal?.aborted) {
        canvas.width = 1;
        canvas.height = 1;
        throw new DOMException("The page render was cancelled.", "AbortError");
      }
      throw error;
    } finally {
      signal?.removeEventListener("abort", cancel);
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
  const resolvedSrc = typeof src === "string" ? new URL(src, document.baseURI).href : src;

  if (supportsRasterWorker()) {
    try {
      return await WorkerPdfPageSource.create(resolvedSrc);
    } catch (error) {
      // Fall back to main-thread rasterization rather than failing the book.
      console.warn("Flipdocs: PDF raster worker unavailable, rendering on the main thread.", error);
    }
  }

  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = packagedWorkerUrl();
  const opened = await openPdfDocument(pdfjs, resolvedSrc, document.baseURI);
  return new PdfPageSource(opened.document, opened.loadingTask, opened.pageAspect);
}
