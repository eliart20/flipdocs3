import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const required = [
  "dist/flipdocs.js",
  "dist/flipdocs.css",
  "dist/index.d.ts",
  "dist/pdf.worker.min.mjs",
];
for (const file of required) {
  const path = resolve(file);
  if (!existsSync(path) || statSync(path).size === 0) throw new Error(`Missing package artifact: ${file}`);
}
const entry = readFileSync(resolve("dist/flipdocs.js"), "utf8");
if (entry.includes("pdf.worker.min.mjs?url")) throw new Error("The PDF worker was unexpectedly inlined.");
console.log(`Package audit passed: ${required.join(", ")}`);
