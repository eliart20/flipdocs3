/// <reference lib="webworker" />
import "./pdfWorkerShims";
import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from "pdfjs-dist";
import { openPdfDocument, type MessageFromPdfWorker, type MessageToPdfWorker } from "./pdfCommon";

/**
 * Dedicated raster worker. Dense pages (a Talmud daf is tens of thousands of
 * glyph draws) paint here instead of on the main thread, so page-turn
 * animation frames never compete with pdf.js canvas work.
 */
const scope = self as unknown as DedicatedWorkerGlobalScope;

let documentProxy: PDFDocumentProxy | null = null;
let loadingTask: PDFDocumentLoadingTask | null = null;
const activeRenders = new Map<number, RenderTask>();

function post(message: MessageFromPdfWorker, transfer: Transferable[] = []): void {
  scope.postMessage(message, transfer);
}

async function initialize(src: string | Blob, baseUrl: string, parserWorkerUrl: string): Promise<void> {
  // pdf.js installs embedded fonts through ownerDocument.fonts. Workers expose
  // their own FontFaceSet as self.fonts; without it, glyphs would paint as
  // boxes, so report failure and let the main thread render instead.
  const fonts = (scope as { fonts?: unknown }).fonts;
  if (!fonts) throw new Error("This browser does not expose FontFaceSet to workers.");
  pdfjs.GlobalWorkerOptions.workerSrc = parserWorkerUrl;
  const opened = await openPdfDocument(pdfjs, src, baseUrl, {
    ownerDocument: {
      fonts,
      // pdf.js creates scratch canvases (patterns, masks, group rendering)
      // through ownerDocument; hand it OffscreenCanvas equivalents.
      createElement: (name: string) => {
        if (name === "canvas") return new OffscreenCanvas(1, 1);
        throw new Error(`The PDF raster worker cannot create <${name}> elements.`);
      },
    },
  });
  documentProxy = opened.document;
  loadingTask = opened.loadingTask;
  post({ type: "ready", pageCount: opened.document.numPages, pageAspect: opened.pageAspect });
}

async function renderPage(id: number, pageIndex: number, targetHeight: number): Promise<void> {
  if (!documentProxy) throw new Error("The PDF document is not loaded yet.");
  const page = await documentProxy.getPage(pageIndex + 1);
  try {
    const natural = page.getViewport({ scale: 1 });
    // dontFlip bakes the vertical mirror WebGL expects, so the main thread can
    // upload the ImageBitmap with texture.flipY = false (browsers ignore
    // UNPACK_FLIP_Y_WEBGL for ImageBitmap sources).
    const viewport = page.getViewport({
      scale: Math.max(0.05, targetHeight / natural.height),
      dontFlip: true,
    });
    const width = Math.max(1, Math.ceil(viewport.width));
    const height = Math.max(1, Math.ceil(viewport.height));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("A 2D canvas context is required for PDF pages.");
    const task = page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
      background: "#ffffff",
    });
    activeRenders.set(id, task);
    try {
      await task.promise;
    } finally {
      activeRenders.delete(id);
    }
    const bitmap = canvas.transferToImageBitmap();
    post({ type: "rendered", id, bitmap, width, height }, [bitmap]);
  } finally {
    page.cleanup();
  }
}

scope.onmessage = (event: MessageEvent<MessageToPdfWorker>) => {
  const message = event.data;
  if (message.type === "init") {
    initialize(message.src, message.baseUrl, message.parserWorkerUrl).catch((error) => {
      post({ type: "init-error", message: error instanceof Error ? error.message : String(error) });
    });
    return;
  }
  if (message.type === "render") {
    renderPage(message.id, message.pageIndex, message.targetHeight).catch((error) => {
      const cancelled = error instanceof Error
        && (error.name === "RenderingCancelledException" || error.name === "AbortError");
      post({
        type: "render-error",
        id: message.id,
        name: cancelled ? "AbortError" : error instanceof Error ? error.name : "Error",
        message: error instanceof Error ? error.message : String(error),
      });
    });
    return;
  }
  if (message.type === "cancel") {
    activeRenders.get(message.id)?.cancel();
    return;
  }
  if (message.type === "destroy") {
    for (const task of activeRenders.values()) task.cancel();
    activeRenders.clear();
    void loadingTask?.destroy();
    documentProxy = null;
    loadingTask = null;
    scope.close();
  }
};
