import { defineConfig } from "vite";
import { resolve } from "node:path";
import { createReadStream, statSync } from "node:fs";
import react from "@vitejs/plugin-react";

const regressionPdfRoot = "C:/Users/Artscroll/Documents/flipdocs/public/pdfs";
const regressionPdfs = [
  "002 MS Stone Shemos (F-32) SMS2HI.pdf",
  "025 Niddah.pdf",
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

export default defineConfig({
  plugins: [react(), regressionPdfPlugin()],
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
    hmr: {
      protocol: "wss",
      clientPort: 443,
    },
  },
});
