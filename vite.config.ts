import { defineConfig } from "vite";
import { resolve } from "node:path";
import { createReadStream, statSync } from "node:fs";
import react from "@vitejs/plugin-react";

const regressionPdfRoot = "C:/Users/Artscroll/Documents/flipdocs/public/pdfs";
const regressionPdfs = [
  "002 MS Stone Shemos (F-32) SMS2HI.pdf",
  "025 Niddah.pdf",
  "025 Niddah (20pp full).pdf",
  "11b - Five Megilos (b).pdf",
  "257 HT Chullin (10) -257- 7x10-2up.pdf",
  "Bais Yaakov Pomona - Final Yearbook combined.pdf",
  "Bnos_Chaya_Yearbook_2026_Print_2-Runger2.pdf",
  "FST Bava Basra (02)-177- (11a-20b).pdf",
  "FST Menachos (01) -236- (02a-11a).pdf",
  "FST Niddah (01)-284- (02a-11a).pdf",
  "Shir Hashirim HT.pdf",
];

function regressionPdfPlugin() {
  return {
    name: "flipdocs-regression-pdfs",
    configureServer(server: import("vite").ViteDevServer) {
      server.middlewares.use("/test-pdfs", (request, response, next) => {
        const match = /^\/(\d+)$/.exec((request.url ?? "").split("?")[0] ?? "");
        const index = match ? Number(match[1]) : -1;
        const name = regressionPdfs[index];
        if (!name) return next();
        const path = resolve(regressionPdfRoot, name);
        let size: number;
        try {
          size = statSync(path).size;
        } catch {
          response.statusCode = 404;
          response.end("Regression PDF not found");
          return;
        }
        response.setHeader("Accept-Ranges", "bytes");
        response.setHeader("Content-Type", "application/pdf");
        response.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(name)}`);
        const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
        if (range) {
          const start = Number(range[1]);
          const requestedEnd = range[2] ? Number(range[2]) : size - 1;
          const end = Math.min(size - 1, requestedEnd);
          if (!Number.isSafeInteger(start) || start < 0 || start > end) {
            response.statusCode = 416;
            response.setHeader("Content-Range", `bytes */${size}`);
            response.end();
            return;
          }
          response.statusCode = 206;
          response.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
          response.setHeader("Content-Length", end - start + 1);
          createReadStream(path, { start, end }).pipe(response);
          return;
        }
        response.setHeader("Content-Length", size);
        createReadStream(path).pipe(response);
      });
    },
  };
}

/**
 * tunn3l's HTTP endpoint carries ordinary requests reliably but currently
 * rejects Vite's WebSocket upgrade. A tiny no-cache revision poll gives the
 * public demo dependable full-page hot reload without a second transport.
 */
function tunnelReloadPlugin() {
  let revision = `${Date.now()}-0`;
  let sequence = 0;
  return {
    name: "flipdocs-tunnel-reload",
    apply: "serve" as const,
    configureServer(server: import("vite").ViteDevServer) {
      // Vite injects /@vite/client even with server.hmr=false because CSS
      // modules use its style helpers. Serve only those helpers here so the
      // browser does not attempt the WebSocket that tunn3l rejects.
      server.middlewares.use((request, response, next) => {
        if ((request.url ?? "").split("?")[0] !== "/@vite/client") return next();
        response.statusCode = 200;
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Type", "text/javascript; charset=utf-8");
        response.end(`
          const styles = new Map();
          export function createHotContext() {
            return {
              accept() {}, acceptExports() {}, dispose() {}, prune() {}, decline() {},
              invalidate() { window.location.reload(); }, on() {}, off() {}, send() {},
            };
          }
          export function updateStyle(id, content) {
            let style = styles.get(id);
            if (!style) {
              style = document.createElement('style');
              style.setAttribute('data-vite-dev-id', id);
              document.head.appendChild(style);
              styles.set(id, style);
            }
            style.textContent = content;
          }
          export function removeStyle(id) {
            styles.get(id)?.remove();
            styles.delete(id);
          }
          export function injectQuery(url, query) {
            const hashIndex = url.indexOf('#');
            const hash = hashIndex < 0 ? '' : url.slice(hashIndex);
            const withoutHash = hashIndex < 0 ? url : url.slice(0, hashIndex);
            return withoutHash + (withoutHash.includes('?') ? '&' : '?') + query + hash;
          }
          export class ErrorOverlay extends (globalThis.HTMLElement ?? class {}) {}
        `);
      });
      const updateRevision = (_event: string, path: string) => {
        const normalized = path.replaceAll("\\", "/");
        if (
          normalized.includes("/node_modules/")
          || normalized.includes("/.git/")
          || normalized.includes("/.codex-remote-attachments/")
          || normalized.includes("/dist/")
        ) return;
        revision = `${Date.now()}-${sequence += 1}`;
      };
      server.watcher.on("all", updateRevision);
      server.middlewares.use("/__flipdocs_revision", (_request, response) => {
        response.statusCode = 200;
        response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.end(revision);
      });
    },
    transformIndexHtml() {
      return [{
        tag: "script",
        attrs: { type: "module" },
        injectTo: "body" as const,
        children: `
          let flipdocsRevision;
          const pollFlipdocsRevision = async () => {
            try {
              const response = await fetch('/__flipdocs_revision', { cache: 'no-store' });
              const nextRevision = await response.text();
              if (flipdocsRevision === undefined) flipdocsRevision = nextRevision;
              else if (nextRevision !== flipdocsRevision) window.location.reload();
            } catch {
              // The next poll recovers automatically when the tunnel reconnects.
            }
          };
          pollFlipdocsRevision();
          window.setInterval(pollFlipdocsRevision, 650);
        `,
      }];
    },
  };
}

export default defineConfig({
  plugins: [react(), regressionPdfPlugin(), tunnelReloadPlugin()],
  worker: {
    format: "es",
  },
  build: {
    copyPublicDir: false,
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      formats: ["es"],
      fileName: () => "flipdocs.js",
      cssFileName: "flipdocs",
    },
    rollupOptions: {
      external: ["react", "react-dom", "react/jsx-runtime", "three", "pdfjs-dist"],
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5183,
    strictPort: true,
    allowedHosts: true,
    watch: {
      usePolling: true,
      interval: 150,
    },
    hmr: false,
  },
});
