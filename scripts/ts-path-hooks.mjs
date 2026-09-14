/**
 * Lets Node's own test runner import the app's TypeScript exactly as the app
 * does: the `@/*` path alias from tsconfig, plus the extensionless relative
 * specifiers a bundler resolves.
 *
 * Node 22 strips types from `.ts` files natively, so the suite needs no build
 * step and no test framework. Only `.ts` modules load this way, which is why
 * the tests cover the domain and service layers and never a `.tsx` component.
 */
import { registerHooks } from "node:module";
import { statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const SRC = path.resolve(import.meta.dirname, "..", "src");
const EXTENSIONS = [".ts", ".tsx", ".mts", "/index.ts", "/index.tsx"];

const isFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

function resolveFile(base) {
  if (isFile(base)) return base;
  for (const ext of EXTENSIONS) {
    if (isFile(`${base}${ext}`)) return `${base}${ext}`;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    let base = null;
    if (specifier.startsWith("@/")) {
      base = path.join(SRC, specifier.slice(2));
    } else if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
      base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
    }
    if (base) {
      const file = resolveFile(base);
      if (file) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
