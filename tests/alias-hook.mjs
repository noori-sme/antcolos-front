import { existsSync, statSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "node:module";

/**
 * Lets `node --test` load the app's own modules unchanged.
 *
 * The source uses two things Node's resolver does not do on its own: the `@/`
 * alias from tsconfig, and extensionless imports. Rather than keep a second,
 * subtly different copy of the code for tests to run against — which is how a
 * test suite ends up passing on something that is not what ships — this hook
 * teaches the loader both conventions and the tests import the real files.
 */

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolvePath(ROOT, "src");

const CANDIDATE_SUFFIXES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

function firstExisting(basePath) {
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = `${basePath}${suffix}`;
    // isFile() rather than existsSync alone: with the "" suffix, a specifier
    // naming a directory that has an index (`@/types`) would otherwise resolve
    // to the directory itself and fail to read.
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return undefined;
}

export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const found = firstExisting(resolvePath(SRC, specifier.slice(2)));
    if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
  }

  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
    const parentDir = dirname(fileURLToPath(context.parentURL));
    const found = firstExisting(resolvePath(parentDir, specifier));
    if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
  }

  return nextResolve(specifier, context);
}

// Registering from inside the hook file lets a single --import flag serve both
// as the registration entry point and as the hook implementation.
if (!process.env.ANTCOLOS_ALIAS_HOOK_REGISTERED) {
  process.env.ANTCOLOS_ALIAS_HOOK_REGISTERED = "1";
  register(import.meta.url, import.meta.url);
}
