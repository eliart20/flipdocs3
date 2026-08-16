/**
 * pdf.js's display layer occasionally reaches for window/screen (canvas area
 * capping uses window.screen.availWidth/Height). Provide harmless stand-ins so
 * it can run inside a dedicated worker. Imported before pdfjs-dist.
 */
const scope = globalThis as Record<string, unknown>;
if (typeof scope.window === "undefined") scope.window = scope;
if (typeof scope.screen === "undefined") {
  scope.screen = { availWidth: 4096, availHeight: 4096, width: 4096, height: 4096 };
}
export {};
