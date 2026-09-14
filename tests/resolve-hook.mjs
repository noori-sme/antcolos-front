import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

const SRC = pathToFileURL(path.join(process.cwd(), "src") + path.sep).href;
const EXTS = [".ts", ".tsx", ".mts", ".js"];

function firstExisting(base) {
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const ext of EXTS) if (existsSync(base + ext)) return base + ext;
  for (const ext of EXTS) {
    const idx = path.join(base, "index" + ext);
    if (existsSync(idx)) return idx;
  }
  return null;
}

export async function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    const target = firstExisting(fileURLToPath(SRC + specifier.slice(2)));
    if (target) return { url: pathToFileURL(target).href, shortCircuit: true };
  }
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    const base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
    const target = firstExisting(base);
    if (target) return { url: pathToFileURL(target).href, shortCircuit: true };
  }
  return next(specifier, context);
}
