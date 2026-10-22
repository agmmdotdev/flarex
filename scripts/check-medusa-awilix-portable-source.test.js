// @ts-check
import { builtinModules, createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "vite";
import * as portable from "../packages/medusa-deps/src/awilix-portable.mjs";
import {
  awilixPortableDeclarations,
  checkPortableAwilixSource,
  extractPortableAwilix,
  verifyPortableAwilixSource,
} from "./check-medusa-awilix-portable-source.mjs";

const dependency = createRequire(new URL("../packages/medusa-deps/package.json", import.meta.url));
const native = dependency("awilix");
const source = readFileSync(dependency.resolve("awilix/lib/awilix.module.mjs"), "utf8");
const target = readFileSync(new URL("../packages/medusa-deps/src/awilix-portable.mjs", import.meta.url), "utf8");

/** Compare data and native class identity within each actual implementation.
 * @param {typeof portable} awilix */
async function nativeContract(awilix) {
  const container = awilix.createContainer();
  const repository = {}, adapter = {}, provider = {};
  let next = 0;
  /** @type {number[]} */
  const disposed = [];
  container.register({
    logger: awilix.asValue(undefined),
    taxProviderRepository: awilix.asValue(repository),
    modulePersistenceAdapter: awilix.asValue(adapter),
    tp_system: awilix.asValue(provider),
    value: awilix.asValue(7),
    alias: awilix.aliasTo("value"),
    scoped: awilix.asFunction(() => ({ ordinal: ++next })).scoped(),
    singleton: awilix.asFunction(() => ({ ordinal: ++next })).singleton()
      .disposer(value => { disposed.push(value.ordinal); }),
    transient: awilix.asFunction(() => ({ ordinal: ++next })),
  });
  const scope = container.createScope();
  const rootScoped = container.resolve("scoped");
  const scopeScoped = scope.resolve("scoped");
  const singleton = container.resolve("singleton");
  const cache = {
    sameRootScope: rootScoped === container.resolve("scoped"),
    sameChildScope: scopeScoped === scope.resolve("scoped"),
    separateScope: rootScoped !== scopeScoped,
    sameSingleton: singleton === scope.resolve("singleton"),
    distinctTransient: container.resolve("transient") !== container.resolve("transient"),
  };
  class Constructed {
    /** @param {{value: number}} cradle */
    constructor({ value }) { this.value = value; }
  }
  function classic(value = 9) { return value; }
  const built = [container.build(Constructed).value,
    container.build(awilix.asFunction(classic).classic()), container.resolve("alias")];
  /** @type {Array<{name: string, message: string, genuine: boolean, base: boolean}>} */
  const errors = [];
  for (const name of ["tp_missing", "another_missing"]) {
    try { container.resolve(name); throw new Error("Missing native resolution failure"); }
    catch (error) {
      if (!(error instanceof Error)) throw error;
      errors.push({ name: error.name, message: error.message,
        genuine: error instanceof awilix.AwilixResolutionError,
        base: error instanceof awilix.AwilixError && error instanceof awilix.ExtendableError });
    }
  }
  const identity = [container.cradle.taxProviderRepository === repository,
    container.cradle.modulePersistenceAdapter === adapter, container.cradle.tp_system === provider,
    container.cradle.logger === undefined];
  /** @type {{value: string} | {errorName: string, message: string}} */
  let display;
  try { display = { value: String(container.cradle) }; }
  catch (error) {
    if (!(error instanceof Error)) throw error;
    display = { errorName: error.name, message: error.message };
  }
  const symbols = {
    container: typeof Reflect.get(container, Symbol.for("nodejs.util.inspect.custom")),
    cradle: typeof Reflect.get(container.cradle, Symbol.for("nodejs.util.inspect.custom")),
    display,
  };
  await scope.dispose();
  await container.dispose();
  return { cache, built, errors, identity, symbols, disposed,
    emptyCache: container.cache.size === 0 && scope.cache.size === 0 };
}

describe("pinned native Awilix portable extraction", () => {
  it("retains every non-loader source byte and genuine declaration exports", () => {
    expect(extractPortableAwilix(source)).toBe(target);
    expect(verifyPortableAwilixSource()).toEqual([]);
    expect(target).not.toMatch(/^import\s/mu);
    expect(target).not.toContain("require(uri)");
    expect(target).not.toContain("process.cwd()");
    expect(target).not.toContain("function listModules(");
    expect(target).not.toContain("function __awaiter(");
    expect(target.match(/Symbol\.for\('nodejs\.util\.inspect\.custom'\)/gu)).toHaveLength(3);
    expect(target).toContain("Copyright (c) Jeff Hansen 2016 to present.");
  });

  it("refuses upstream drift, algorithm changes and a fabricated declaration facade", () => {
    expect(checkPortableAwilixSource(source + "\n", target, awilixPortableDeclarations)).toContain("Changed pinned Awilix 8.0.1 module source");
    for (const mutation of [
      target.replace("class ExtendableError extends Error", "class ExtendableError extends TypeError"),
      target.replace("new Map()", "new WeakMap()"),
      target.replace("createContainer(options, parentContainer)", "createContainer(options)"),
    ]) expect(checkPortableAwilixSource(source, mutation, awilixPortableDeclarations)).toContain("Changed native Awilix portable extraction");
    expect(checkPortableAwilixSource(source, target, 'export const createContainer: unknown;\n'))
      .toContain("Changed native Awilix declaration reuse");
  });

  it("packs the direct ESM leaf and keeps the existing host entrypoint unchanged", () => {
    const manifest = JSON.parse(readFileSync(new URL("../packages/medusa-deps/package.json", import.meta.url), "utf8"));
    expect(manifest.dependencies.awilix).toBe("8.0.1");
    expect(manifest.exports["./awilix"]).toEqual({
      types: "./dist/awilix.d.ts", source: "./src/awilix.ts", default: "./dist/awilix.js",
    });
    expect(manifest.exports["./awilix-portable"]).toEqual({
      types: "./src/awilix-portable.d.mts", source: "./src/awilix-portable.mjs", default: "./src/awilix-portable.mjs",
    });
    expect(manifest.files).toEqual(["dist", "src"]);
  });

  it("preserves native Error inheritance, parser, resolvers, scope, cache, build and disposal", async () => {
    const expected = await nativeContract(native);
    const actual = await nativeContract(portable);
    expect(actual).toEqual(expected);
    expect(actual.identity).toEqual([true, true, true, true]);
    expect(actual.built).toEqual([7, 7, 7]);
    expect(actual.errors.every(error => error.name === "AwilixResolutionError" && error.genuine && error.base)).toBe(true);
    expect(Object.values(actual.cache).every(Boolean)).toBe(true);
    expect(actual.emptyCache).toBe(true);
    expect(actual.disposed).toHaveLength(1);
  });

  it("keeps module loading unavailable with the exact native browser refusal", async () => {
    const container = portable.createContainer();
    const scope = container.createScope();
    try {
      for (const current of [container, scope]) {
        for (const options of [undefined, { esModules: false }, { esModules: true }]) {
          expect(() => current.loadModules([], options)).toThrowError(new Error("loadModules is not supported in the browser."));
        }
      }
      expect(Reflect.has(portable, "listModules")).toBe(false);
    } finally { await scope.dispose(); await container.dispose(); }
  });

  it("executes the browser-built native Tax provider with modern Awilix errors and independent cradles", async () => {
    const entry = fileURLToPath(new URL("./__awilix-tax-browser-witness__.mjs", import.meta.url)).replaceAll("\\", "/");
    /** @param {string} relative */
    const input = (relative) => JSON.stringify(fileURLToPath(new URL(relative, import.meta.url)).replaceAll("\\", "/"));
    const source = `
      import { createContainer, asValue, AwilixResolutionError, AwilixError, ExtendableError }
        from ${input("../packages/medusa-deps/src/awilix-portable.mjs")};
      import TaxProviderService from ${input("../packages/medusa-tax/src/services/tax-provider.ts")};
      import SystemTaxService from ${input("../packages/medusa-tax/src/providers/system.ts")};

      export async function witness() {
        const first = createContainer(), second = createContainer();
        const firstRepository = {}, secondRepository = {};
        const firstSystem = new SystemTaxService(), secondSystem = new SystemTaxService();
        const firstLogs = [], secondLogs = [];
        const firstLogger = { error: (message, error) => firstLogs.push({ message, error }) };
        const secondLogger = { error: (message, error) => secondLogs.push({ message, error }) };
        first.register({ logger: asValue(firstLogger), taxProviderRepository: asValue(firstRepository),
          modulePersistenceAdapter: asValue(undefined), tp_system: asValue(firstSystem), tp_first_only: asValue(firstSystem) });
        second.register({ logger: asValue(secondLogger), taxProviderRepository: asValue(secondRepository),
          modulePersistenceAdapter: asValue(undefined), tp_system: asValue(secondSystem) });
        try {
          const firstService = new TaxProviderService(first.cradle);
          const secondService = new TaxProviderService(second.cradle);
          let direct;
          try { first.resolve("tp_missing"); }
          catch (error) {
            direct = { name: error.name, message: error.message,
              constructor: error.constructor === AwilixResolutionError,
              inheritance: error instanceof Error && error instanceof ExtendableError && error instanceof AwilixError };
          }
          let missing, isolated;
          try { firstService.retrieveProvider("tp_missing"); }
          catch (error) { missing = { name: error.name, message: error.message }; }
          try { secondService.retrieveProvider("tp_first_only"); }
          catch (error) { isolated = { name: error.name, message: error.message }; }
          const logs = [firstLogs, secondLogs].map(entries => entries.map(({ message, error }) => ({ message,
            errorName: error.name, errorMessage: error.message,
            constructor: error.constructor === AwilixResolutionError,
            inheritance: error instanceof AwilixError && error instanceof ExtendableError && error instanceof Error })));
          return { direct, missing, isolated, logs,
            explicitLoggers: [first.cradle.logger === firstLogger, second.cradle.logger === secondLogger],
            providerIdentity: [firstService.retrieveProvider("tp_system") === firstSystem,
              secondService.retrieveProvider("tp_system") === secondSystem,
              firstService.retrieveProvider("tp_first_only") === firstSystem, firstSystem !== secondSystem],
            independentCradles: firstService.__container__ !== secondService.__container__,
            repositoryIdentity: [firstService.__taxProviderRepository__ === firstRepository,
              secondService.__taxProviderRepository__ === secondRepository],
            identifiers: [firstSystem.getIdentifier(), secondSystem.getIdentifier()] };
        } finally { await first.dispose(); await second.dispose(); }
      }
    `;
    /** @type {Set<string>} */
    const inputs = new Set();
    const result = await build({
      configFile: false, logLevel: "silent", resolve: { conditions: ["source", "browser"] },
      plugins: [{ name: "native-tax-browser-runtime-witness", enforce: "pre",
        resolveId(id) {
          if (id.replaceAll("\\", "/") === entry) return "\0" + entry;
          if (id.startsWith("node:") || builtinModules.includes(id)) throw new Error(`Node import in browser witness: ${id}`);
        },
        load(id) {
          if (id === "\0" + entry) return source;
          inputs.add(id.replaceAll("\\", "/"));
        },
      }],
      build: { write: false, minify: false, target: "es2022", lib: { entry, formats: ["es"] } },
    });
    const builds = Array.isArray(result) ? result : [result];
    expect(builds).toHaveLength(1);
    const [built] = builds;
    if (built === undefined || !("output" in built)) throw new Error("Expected one in-memory browser build");
    const chunks = built.output.filter(output => output.type === "chunk");
    expect(chunks).toHaveLength(1);
    const [chunk] = chunks;
    if (chunk === undefined) throw new Error("Missing trusted browser bundle");
    expect(chunk.imports).toEqual([]);
    expect(chunk.dynamicImports).toEqual([]);
    for (const path of ["/packages/medusa-deps/src/awilix-portable.mjs",
      "/packages/medusa-tax/src/services/tax-provider.ts", "/packages/medusa-tax/src/providers/system.ts"])
      expect([...inputs].some(input => input.endsWith(path))).toBe(true);
    const bundled = await import(/* @vite-ignore */ "data:text/javascript;base64," + Buffer.from(chunk.code).toString("base64"));
    const observed = await bundled.witness();
    expect(observed.direct).toEqual({ name: "AwilixResolutionError",
      message: "Could not resolve 'tp_missing'.\n\nResolution path: tp_missing", constructor: true, inheritance: true });
    /** @param {string} id */
    const configurationMessage = id => `\n  Unable to retrieve the tax provider with id: ${id}\n  Please make sure that the provider is registered in the container and it is configured correctly in your project configuration file.`;
    expect(observed.missing).toEqual({ name: "Error", message: configurationMessage("tp_missing") });
    expect(observed.isolated).toEqual({ name: "Error", message: configurationMessage("tp_first_only") });
    for (const [index, id] of ["tp_missing", "tp_first_only"].entries()) {
      const message = `Could not resolve '${id}'.\n\nResolution path: ${id}`;
      expect(observed.logs[index]).toEqual([{ message: `AwilixResolutionError: ${message}`,
        errorName: "AwilixResolutionError", errorMessage: message, constructor: true, inheritance: true }]);
    }
    expect(observed.explicitLoggers).toEqual([true, true]);
    expect(observed.providerIdentity).toEqual([true, true, true, true]);
    expect(observed.repositoryIdentity).toEqual([true, true]);
    expect(observed.independentCradles).toBe(true);
    expect(observed.identifiers).toEqual(["system", "system"]);
  }, 60_000);
});
