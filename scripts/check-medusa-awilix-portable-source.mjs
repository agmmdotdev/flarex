// @ts-check
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const awilixPortableSourceSha256 = "6d4fe451008ed64f294d383bf23637cc8fb872c874efaa143be672fb8418f1ae";
export const awilixPortableTarget = "packages/medusa-deps/src/awilix-portable.mjs";

const notice = `/*
 * Portable extraction of Awilix 8.0.1 lib/awilix.module.mjs.
 * Source SHA-256: ${awilixPortableSourceSha256}
 * Source package: https://www.npmjs.com/package/awilix/v/8.0.1
 * Mechanical extraction: scripts/check-medusa-awilix-portable-source.mjs.
 * Host module loading is unavailable, as in the published browser entrypoint.
 * Error classes and all retained container/resolver/parser code stay native.
 *
 * The MIT License (MIT)
 *
 * Copyright (c) Jeff Hansen 2016 to present.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
`;

/** Genuine declaration reuse, with exactly the retained runtime exports.
 * The container's native loadModules method remains declared but always throws,
 * matching the published browser entrypoint. No standalone listModules export. */
export const awilixPortableDeclarations = `// Awilix 8.0.1 declaration reuse; see awilix-portable.mjs for MIT notice/provenance.
export {
  AwilixError, AwilixResolutionError, AwilixTypeError, ExtendableError,
  InjectionMode, Lifetime, RESOLVER, aliasTo, asClass, asFunction, asValue,
  createBuildResolver, createContainer, createDisposableResolver,
} from "awilix";
export type {
  AwilixContainer, ResolveOptions, CacheEntry, NameAndRegistrationPair,
  FunctionReturning, ClassOrFunctionReturning, ContainerOptions,
  RegistrationHash, ResolutionStack, InjectorFunction, Resolver,
  BuildResolver, DisposableResolverOptions, DisposableResolver, Disposer,
  ResolverOptions, BuildResolverOptions, Constructor, InjectionModeType,
  LifetimeType, ListModulesOptions, ModuleDescriptor, GlobWithOptions,
} from "awilix";
`;

/** @param {string} value */
const sha256 = value => createHash("sha256").update(value).digest("hex");

/** Unique anchored removal, protected by the complete upstream source digest.
 * @param {string} source @param {string} start @param {string} end
 * @param {string} [replacement] */
function replaceIsland(source, start, end, replacement = "") {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first + start.length);
  if (first < 0 || last < 0 || source.indexOf(start, first + start.length) !== -1) {
    throw new Error("Changed Awilix portable extraction island");
  }
  return source.slice(0, first) + replacement + source.slice(last);
}

/** Extract only the loader-free native leaf; every other source byte survives.
 * @param {string} source */
export function extractPortableAwilix(source) {
  if (sha256(source) !== awilixPortableSourceSha256) throw new Error("Changed pinned Awilix 8.0.1 module source");
  let output = replaceIsland(source, "import * as glob from 'fast-glob';", "/**\n * Newline.");
  output = replaceIsland(output, "/**\n * Quick flatten utility", "/**\n * Creates a { name: value }");
  output = replaceIsland(output, "// Regex to extract the module name.", "/**\n * Lifetime types.");
  output = replaceIsland(output, "const nameFormatters = {", "/**\n * Family tree symbol.");
  output = replaceIsland(output, "    /**\n     * Binds `lib/loadModules`", "    /**\n     * Disposes this container",
    '    function loadModules$1() {\n        throw new Error("loadModules is not supported in the browser.");\n    }\n');
  if (output.split("util.inspect.custom").length !== 4) throw new Error("Changed Awilix inspection symbol sites");
  output = output.replaceAll("util.inspect.custom", "Symbol.for('nodejs.util.inspect.custom')");
  const exports = "createDisposableResolver, listModules };";
  if (!output.endsWith(exports + "\n")) throw new Error("Changed Awilix native exports");
  output = output.slice(0, -exports.length - 1) + "createDisposableResolver };\n";
  return notice + "\n" + output;
}

/** @param {string} source @param {string} target @param {string} declarations */
export function checkPortableAwilixSource(source, target, declarations) {
  const errors = [];
  try {
    if (extractPortableAwilix(source) !== target) errors.push("Changed native Awilix portable extraction");
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Invalid Awilix portable source");
  }
  if (declarations !== awilixPortableDeclarations) errors.push("Changed native Awilix declaration reuse");
  return errors;
}

/** @param {URL} [root] */
export function verifyPortableAwilixSource(root = new URL("../", import.meta.url)) {
  const dependency = createRequire(new URL("packages/medusa-deps/package.json", root));
  return checkPortableAwilixSource(
    readFileSync(dependency.resolve("awilix/lib/awilix.module.mjs"), "utf8"),
    readFileSync(new URL(awilixPortableTarget, root), "utf8"),
    readFileSync(new URL("packages/medusa-deps/src/awilix-portable.d.mts", root), "utf8"),
  );
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = verifyPortableAwilixSource();
  if (errors.length !== 0) {
    for (const error of errors) console.error(error);
    process.exitCode = 1;
  } else console.log("Verified pinned Awilix 8.0.1 portable extraction.");
}
