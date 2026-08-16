import type {
  PDFDataRangeTransport,
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
} from "pdfjs-dist";

export const RANGE_CHUNK_SIZE = 256 * 1024;

type PdfJsModule = typeof import("pdfjs-dist");

export function pdfFileName(input: string | Blob, baseUrl: string): string {
  if (input instanceof Blob && "name" in input && typeof input.name === "string") return input.name;
  if (typeof input === "string") {
    try {
      return decodeURIComponent(new URL(input, baseUrl).pathname.split("/").at(-1) ?? "document.pdf");
    } catch {
      return "document.pdf";
    }
  }
  return "document.pdf";
}

export function blobRangeTransport(
  pdfjs: PdfJsModule,
  blob: Blob,
  baseUrl: string,
): PDFDataRangeTransport {
  class BlobTransport extends pdfjs.PDFDataRangeTransport {
    private stopped = false;

    constructor() {
      super(blob.size, null, true, pdfFileName(blob, baseUrl));
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

export async function urlRangeTransport(
  pdfjs: PdfJsModule,
  url: string,
  baseUrl: string,
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
      super(total, initial, true, pdfFileName(url, baseUrl));
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

export interface OpenedPdfDocument {
  document: PDFDocumentProxy;
  loadingTask: PDFDocumentLoadingTask;
  pageAspect: number;
}

/** Open a PDF with byte-range lazy loading when the source supports it. */
export async function openPdfDocument(
  pdfjs: PdfJsModule,
  src: string | Blob,
  baseUrl: string,
  extraParameters?: Record<string, unknown>,
): Promise<OpenedPdfDocument> {
  let parameters: Parameters<typeof pdfjs.getDocument>[0];
  if (typeof src === "string") {
    const range = await urlRangeTransport(pdfjs, src, baseUrl);
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
      range: blobRangeTransport(pdfjs, src, baseUrl),
      rangeChunkSize: RANGE_CHUNK_SIZE,
      disableStream: true,
      disableAutoFetch: true,
    };
  }

  const loadingTask = pdfjs.getDocument({ ...parameters, ...extraParameters });
  const documentProxy = await loadingTask.promise;
  const first = await documentProxy.getPage(1);
  const viewport = first.getViewport({ scale: 1 });
  first.cleanup();
  return {
    document: documentProxy,
    loadingTask,
    pageAspect: viewport.width / viewport.height,
  };
}

export interface WorkerInitMessage {
  type: "init";
  src: string | Blob;
  /** Base used to resolve relative URLs and derive the document name. */
  baseUrl: string;
  /** Absolute URL of pdf.js's own parser worker script. */
  parserWorkerUrl: string;
}

export interface WorkerRenderMessage {
  type: "render";
  id: number;
  pageIndex: number;
  targetHeight: number;
}

export interface WorkerCancelMessage {
  type: "cancel";
  id: number;
}

export interface WorkerDestroyMessage {
  type: "destroy";
}

export type MessageToPdfWorker =
  | WorkerInitMessage
  | WorkerRenderMessage
  | WorkerCancelMessage
  | WorkerDestroyMessage;

export interface WorkerReadyMessage {
  type: "ready";
  pageCount: number;
  pageAspect: number;
}

export interface WorkerInitErrorMessage {
  type: "init-error";
  message: string;
}

export interface WorkerRenderedMessage {
  type: "rendered";
  id: number;
  bitmap: ImageBitmap;
  width: number;
  height: number;
}

export interface WorkerRenderErrorMessage {
  type: "render-error";
  id: number;
  name: string;
  message: string;
}

export type MessageFromPdfWorker =
  | WorkerReadyMessage
  | WorkerInitErrorMessage
  | WorkerRenderedMessage
  | WorkerRenderErrorMessage;
