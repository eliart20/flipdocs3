import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
const expectedRepository = "git+https://github.com/eliart20/flipdocs3.git";
if (packageJson.private === true) throw new Error("Package is marked private.");
if (packageJson.license !== "MIT") throw new Error("Package license must be MIT.");
if (packageJson.scripts?.prepare !== "npm run build") throw new Error("Git dependencies must build through the prepare lifecycle.");
if (packageJson.publishConfig?.access !== "public") throw new Error("Package must publish with public access.");
if (packageJson.repository?.url !== expectedRepository) throw new Error("Package repository metadata is missing or incorrect.");
if (packageJson.exports?.["."]?.types !== "./dist/index.d.ts") throw new Error("Root type export is missing.");
if (packageJson.exports?.["./style.css"] !== "./dist/flipdocs.css") throw new Error("Stylesheet export is missing.");
if (packageJson.exports?.["./pdf.worker.min.mjs"] !== "./dist/pdf.worker.min.mjs") throw new Error("PDF worker export is missing.");

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
