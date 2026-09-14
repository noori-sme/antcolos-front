import { existsSync, statSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Resolves the "@/*" path alias from tsconfig.json so the test runner can
 * import application modules exactly as the app does. Node's own type
 * stripping handles the TypeScript; this only answers "which file is that".
 */
const SRC = resolvePath(dirname(fileURLToPath(import.meta.url)), "../src");
const EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".mjs"];

function firstExisting(base) {
  if (existsSync(base) && statSync(base).isFile()) return base;
  for (const ext of EXTENSIONS) {
    const candidate = `${base}${ext}`;
    if (existsSync(candidate)) return candidate;
  }
  for (const ext of EXTENSIONS) {
    const candidate = `${base}/index${ext}`;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const target = firstExisting(resolvePath(SRC, specifier.slice(2)));
    if (target) return { url: pathToFileURL(target).href, shortCircuit: true };
  }

  // Application code is written for a bundler, so relative imports carry no
  // file extension. Resolve those the same way the bundler does.
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    const from = dirname(fileURLToPath(context.parentURL));
    const target = firstExisting(resolvePath(from, specifier));
    if (target) return { url: pathToFileURL(target).href, shortCircuit: true };
  }

  return nextResolve(specifier, context);
}
