// @ts-check
import { describe, expect, it } from "vitest";
import { posix } from "node:path";
import { analyzeMedusaSourceIslandBoundary } from "./check-medusa-source-island-boundary.mjs";

const emptyInput = {
  rootManifests: [],
  rootSources: [],
  rootConfigs: [],
  rootSymlinks: [],
  rootToolSources: [],
  islandManifests: [],
  islandSources: [],
  islandConfigs: [],
  islandSymlinks: [],
  islandWorkspaceText: undefined,
  rootWorkspaceText: "packages:\n  - packages/*\n  - apps/*\n",
  rootScripts: {},
};
const nativeScenario = "packages/medusa-adapter/benchmarks/core-performance/native-retrieval/scenario.ts";
const nativeObserver = "packages/medusa-adapter/benchmarks/core-performance/native-retrieval/observation.ts";
const nativeConfig = "packages/medusa-adapter/vitest.native-retrieval.config.ts";
const nativeControlImports = [
  "../../../../../third_party/medusa/upstream/packages/modules/product/dist/services/product-module-service",
  "../../../../../third_party/medusa/upstream/packages/medusa-test-utils/dist/module-test-persistence-adapter",
];
const nativeControlPromotion = {
  sourceCommit: "test", buildFiles: [], testAliases: [],
  packages: [{ path: "packages/medusa-adapter", name: "@flarex/medusa-adapter", dependencies: {}, exports: [] }],
  files: [nativeScenario, nativeObserver, nativeConfig].map(target =>
    ({ target, targetSha256: "pinned", classification: "authored" })),
};

describe("Medusa source-island boundary checker", () => {
  it("confines historical capture imports to the actual query and erased metadata owners", () => {
    const fixture = "packages/executor/test/performance/support/historicalCaptureFixture.ts";
    const edges = [
      { specifier: "../../../../medusa-adapter/src/modules/product/query", name: "findProducts", typeOnly: false },
      { specifier: "../../../../medusa-adapter/src/modules/product/runtime-metadata", name: "ProductRuntimeMetadata", typeOnly: true },
    ];
    const promotion = { ...nativeControlPromotion, files: edges.map(edge => ({
      target: posix.normalize(posix.join(posix.dirname(fixture), edge.specifier)) + ".ts",
      classification: "authored", targetSha256: "pinned",
    })) };
    /** @param {string} relativePath @param {string} text
     * @param {import("./check-medusa-currency-promotion.mjs").Promotion} [selected] */
    const check = (relativePath, text, selected = promotion) => analyzeMedusaSourceIslandBoundary({
      ...emptyInput, currencyPromotion: selected, rootSources: [{ relativePath, text }],
    }).errors;
    for (const edge of edges) {
      const imported = `import ${edge.typeOnly ? "type " : ""}{ ${edge.name} } from ${JSON.stringify(edge.specifier)};`;
      expect(check(fixture, imported)).toEqual([]);
      for (const relativePath of [fixture.replace("historicalCaptureFixture", "adjacentFixture"),
        "packages/executor/src/historicalCaptureFixture.ts"]) {
        const target = posix.normalize(posix.join(posix.dirname(fixture), edge.specifier));
        const neighboringImport = imported.replace(edge.specifier, posix.relative(posix.dirname(relativePath), target));
        expect(check(relativePath, neighboringImport).length).toBeGreaterThan(0);
      }
      expect(check(fixture, imported, { ...promotion, files: [] }).length).toBeGreaterThan(0);
      expect(check(fixture, imported, { ...promotion, files: promotion.files.map(file => ({
        ...file, classification: "preserved",
      })) }).length).toBeGreaterThan(0);
      for (const malformed of [
        imported.replace(`{ ${edge.name} }`, `{ ${edge.name}, adjacent }`),
        imported.replace(`{ ${edge.name} }`, `{ ${edge.name} as renamed }`),
        imported.replace(`{ ${edge.name} }`, "* as owner"),
        imported.replace(edge.specifier, edge.specifier + ".ts"),
        `import ${edge.typeOnly ? "" : "type "}{ ${edge.name} } from ${JSON.stringify(edge.specifier)};`,
      ]) expect(check(fixture, malformed).length).toBeGreaterThan(0);
    }
  });

  it("admits only the exact measurement SDK collector's inventoried native business import", () => {
    const prefix = "packages/medusa-adapter/benchmarks/core-performance/native-business/";
    const owners = ["native.ts", "workflow.ts", "run.ts", "tsconfig.json"].map(file => prefix + file);
    const promotion = { ...nativeControlPromotion, files: [...nativeControlPromotion.files,
      ...owners.map(target => ({ target, targetSha256: "pinned", classification: "authored" }))] };
    const consumer = "packages/executor/test/performance/measurement/collectors/native.ts";
    const specifier = "../../../../../medusa-adapter/benchmarks/core-performance/native-business/native";
    /** @param {string} relativePath @param {string} selectedSpecifier
     * @param {import("./check-medusa-currency-promotion.mjs").Promotion} [selected] */
    const check = (relativePath, selectedSpecifier, selected = promotion) => analyzeMedusaSourceIslandBoundary({
      ...emptyInput, currencyPromotion: selected,
      rootSources: [{ relativePath, text: `const { prepareNativeBusiness } = await import(${JSON.stringify(selectedSpecifier)});` }],
    }).errors;
    expect(check(consumer, specifier)).toEqual([]);
    expect(check(consumer.replace("/native.ts", "/adjacent.ts"), specifier).length).toBeGreaterThan(0);
    expect(check("packages/executor/src/native.ts",
      "../../medusa-adapter/benchmarks/core-performance/native-business/native").length).toBeGreaterThan(0);
    for (const alternative of [specifier + ".ts", specifier.replace("/native-business/native", "/native-business/workflow"),
      specifier.replace("/native-business/native", "/native-business/./native"),
      "../../../../../medusa-adapter/src/modules/currency/service",
      "../../../../../third_party/medusa/upstream/packages/core/framework/dist/utils/index.js"]) {
      expect(check(consumer, alternative).length).toBeGreaterThan(0);
    }
    expect(check(consumer, specifier, nativeControlPromotion).length).toBeGreaterThan(0);
    for (const missing of owners) {
      expect(check(consumer, specifier, { ...promotion,
        files: promotion.files.filter(file => file.target !== missing) }).length).toBeGreaterThan(0);
      expect(check(consumer, specifier, { ...promotion,
        files: promotion.files.map(file => file.target === missing
          ? { ...file, classification: "testHarnessPort" } : file) }).length).toBeGreaterThan(0);
    }
  });

  it("confines complete native business imports and loader use to the inventoried benchmark", () => {
    const prefix = "packages/medusa-adapter/benchmarks/core-performance/native-business/";
    const owners = ["native.ts", "workflow.ts", "run.ts", "tsconfig.json"].map(file => prefix + file);
    const promotion = { ...nativeControlPromotion, files: [...nativeControlPromotion.files,
      ...owners.map(target => ({ target, targetSha256: "pinned", classification: "authored" }))] };
    /** @param {string} file @param {string} text
     * @param {import("./check-medusa-currency-promotion.mjs").Promotion} [selected] */
    const check = (file, text, selected = promotion) => analyzeMedusaSourceIslandBoundary({
      ...emptyInput, currencyPromotion: selected, rootSources: [{ relativePath: file, text }],
    }).errors;
    const specifier = "../../../../../third_party/medusa/upstream/packages/core/core-flows/dist/product/steps/create-product-variants.js";
    const importing = `import { step } from ${JSON.stringify(specifier)};`;
    expect(check(prefix + "workflow.ts", importing)).toEqual([]);
    expect(check(prefix + "native.ts", importing).length).toBeGreaterThan(0);
    expect(check(prefix + "adjacent.ts", importing).length).toBeGreaterThan(0);
    expect(check("packages/medusa-adapter/src/native.ts", importing).length).toBeGreaterThan(0);
    for (const missing of owners) expect(check(prefix + "workflow.ts", importing,
      { ...promotion, files: promotion.files.filter(file => file.target !== missing) }).length).toBeGreaterThan(0);
    const mock = "../../../../../third_party/medusa/upstream/packages/medusa-test-utils/dist/mock-event-bus-service.js";
    const loading = `import { createRequire } from "node:module"; const event = createRequire(import.meta.url)(${JSON.stringify(mock)});`;
    expect(check(prefix + "native.ts", loading)).toEqual([]);
    expect(check(prefix + "native.ts", loading.replace("mock-event-bus-service", "database")).length).toBeGreaterThan(0);
    expect(check(prefix + "native.ts", loading.replace("import.meta.url", "root")).length).toBeGreaterThan(0);
    expect(check(prefix + "native.ts", 'const load = createRequire(import.meta.url); load("pg");').length).toBeGreaterThan(0);
    expect(check(prefix + "native.ts", 'import("pg");').length).toBeGreaterThan(0);
    expect(check(prefix + "run.ts", 'const require = createRequire(import.meta.url); Object.keys(require.cache);')).toEqual([]);
    expect(check(prefix + "run.ts", 'const require = createRequire(import.meta.url); require("pg");').length).toBeGreaterThan(0);
  });
  it("limits matched finite retrieval to named inventoried controls and the pinned runner", () => {
    const scenario = "packages/medusa-adapter/benchmarks/core-performance/mixed-native-read/scenario.ts";
    const test = "packages/medusa-adapter/benchmarks/core-performance/mixed-native-read/scenario.postgres.test.ts";
    const config = "packages/medusa-adapter/vitest.mixed-native-read.config.ts";
    const runner = "packages/medusa-adapter/benchmarks/core-performance/native-retrieval/native-runner.ts";
    const promotion = { ...nativeControlPromotion, files: [...nativeControlPromotion.files,
      ...[scenario, test, config].map(target => ({ target, targetSha256: "pinned", classification: "authored" })),
      { target: runner, targetSha256: "pinned", classification: "testHarnessPort",
        source: "third_party/medusa/upstream/packages/medusa-test-utils/src/module-test-runner.ts", sourceSha256: "pinned" }] };
    /** @param {string} relativePath @param {string} text
     * @param {import("./check-medusa-currency-promotion.mjs").Promotion} [selected] */
    const check = (relativePath, text, selected = promotion) => analyzeMedusaSourceIslandBoundary({
      ...emptyInput, currencyPromotion: selected, rootSources: [{ relativePath, text }],
    }).errors;
    const native = `import type Native from ${JSON.stringify(nativeControlImports[0])};`;
    const adapter = `import { adapter } from ${JSON.stringify(nativeControlImports[1])};`;
    const resolve = 'moduleIntegrationTestRunner({ resolve: fileURLToPath(new URL("../../../../../third_party/medusa/upstream/packages/modules/product", import.meta.url)) });';
    expect(check(scenario, native).length).toBeGreaterThan(0);
    expect(check(test, `${native}\n${adapter}\n${resolve}`)).toEqual([]);
    expect(check(scenario, adapter).length).toBeGreaterThan(0);
    expect(check(test, native, nativeControlPromotion).length).toBeGreaterThan(0);
    for (const missing of [scenario, test, config, runner])
      expect(check(test, native, { ...promotion, files: promotion.files.filter(file => file.target !== missing) }).length).toBeGreaterThan(0);
    expect(check(test.replace("scenario.postgres", "adjacent"), native).length).toBeGreaterThan(0);
    expect(check(test.replace("/benchmarks/core-performance/mixed-native-read/", "/src/"), native).length).toBeGreaterThan(0);
    expect(check(test, resolve.replace("moduleIntegrationTestRunner", "anotherLoader")).length).toBeGreaterThan(0);
    expect(check(test, resolve.replace("import.meta.url", "root")).length).toBeGreaterThan(0);
    expect(check(test, resolve.replace("modules/product", "modules/currency")).length).toBeGreaterThan(0);
    expect(check(scenario, 'const path = "x"; import(path);').length).toBeGreaterThan(0);
  });
  it("inventories only the named publication and measurement consumers of the authored server observer", () => {
    const server = "packages/medusa-adapter/benchmarks/core-performance/native-retrieval/server.ts";
    const promotion = { ...nativeControlPromotion, files: [...nativeControlPromotion.files,
      { target: server, targetSha256: "pinned", classification: "authored" }] };
    /** @type {Array<[string, string]>} */
    const consumers = [
      ["packages/flarex-backend/test/publicationPerformance.postgres.test.ts",
        "../../medusa-adapter/benchmarks/core-performance/native-retrieval/server"],
      ["packages/flarex-backend/test/support/publicationPerformanceReport.ts",
        "../../../medusa-adapter/benchmarks/core-performance/native-retrieval/server"],
      ["packages/flarex-backend/test/support/publicationPerformanceServer.ts",
        "../../../medusa-adapter/benchmarks/core-performance/native-retrieval/server"],
      ["packages/executor/test/performance/measurement/server.ts",
        "../../../../medusa-adapter/benchmarks/core-performance/native-retrieval/server"],
      ["packages/executor/test/performance/measurement/collectors/server.ts",
        "../../../../../medusa-adapter/benchmarks/core-performance/native-retrieval/server"],
      ["packages/executor/test/performance/measurement/collectors/server.test.ts",
        "../../../../../medusa-adapter/benchmarks/core-performance/native-retrieval/server"],
    ];
    /** @param {string} relativePath @param {string} specifier
     * @param {import("./check-medusa-currency-promotion.mjs").Promotion} [selected] */
    const check = (relativePath, specifier, selected = promotion) => analyzeMedusaSourceIslandBoundary({
      ...emptyInput, currencyPromotion: selected,
      rootSources: [{ relativePath, text: `import { openRetrievalServerObserver } from ${JSON.stringify(specifier)};` }],
    }).errors;
    for (const [relativePath, specifier] of consumers) {
      expect(check(relativePath, specifier)).toEqual([]);
      expect(check(relativePath, specifier, nativeControlPromotion).length).toBeGreaterThan(0);
      expect(check(relativePath.replace(/[^/]+\.ts$/, "adjacent.ts"), specifier).length).toBeGreaterThan(0);
      expect(check(relativePath.replace("/test/", "/src/"), specifier).length).toBeGreaterThan(0);
      expect(check(relativePath, specifier.replace("/server", "/observation")).length).toBeGreaterThan(0);
      expect(check(relativePath, specifier, {
        ...promotion, files: promotion.files.map(file => file.target === server
          ? { ...file, classification: "testHarnessPort" } : file),
      }).length).toBeGreaterThan(0);
    }
  });
  it("limits the benchmark runner port to its exact native helpers and provenance", () => {
    const runner = "packages/medusa-adapter/benchmarks/core-performance/native-retrieval/native-runner.ts";
    const helper = "../../../../../third_party/medusa/upstream/packages/medusa-test-utils/dist/init-modules";
    const promotion = { ...nativeControlPromotion, files: [...nativeControlPromotion.files, {
      target: runner, targetSha256: "pinned", classification: "testHarnessPort",
      source: "third_party/medusa/upstream/packages/medusa-test-utils/src/module-test-runner.ts", sourceSha256: "pinned",
    }] };
    /** @param {string} relativePath @param {string} specifier
     * @param {import("./check-medusa-currency-promotion.mjs").Promotion} [selected] */
    const check = (relativePath, specifier, selected = promotion) => analyzeMedusaSourceIslandBoundary({
      ...emptyInput, currencyPromotion: selected,
      rootSources: [{ relativePath, text: `import { initModules } from ${JSON.stringify(specifier)};` }],
    }).errors;
    expect(check(runner, helper)).toEqual([]);
    expect(check(runner.replace("native-runner", "adjacent"), helper).length).toBeGreaterThan(0);
    expect(check(runner, helper.replace("init-modules", "unlisted-helper")).length).toBeGreaterThan(0);
    expect(check(runner, helper, nativeControlPromotion).length).toBeGreaterThan(0);
    expect(check(runner, helper, { ...promotion, files: promotion.files.map(file =>
      file.target === runner ? { ...file, classification: "authored" } : file) }).length).toBeGreaterThan(0);
    const source = "third_party/medusa/upstream/packages/medusa-test-utils/src/module-test-runner.ts";
    /** @param {string} text
     * @param {import("./check-medusa-currency-promotion.mjs").Promotion} [selected] */
    const checkFingerprint = (text, selected = promotion) => analyzeMedusaSourceIslandBoundary({
      ...emptyInput, currencyPromotion: selected,
      rootSources: [{ relativePath: nativeScenario, text }],
    }).errors;
    const fingerprint = `async function sourceEvidence() { const paths = [${JSON.stringify(source)}]; }`;
    expect(checkFingerprint(fingerprint)).toEqual([]);
    expect(checkFingerprint(fingerprint, nativeControlPromotion).length).toBeGreaterThan(0);
    expect(checkFingerprint(`const paths = [${JSON.stringify(source)}];`).length).toBeGreaterThan(0);
    expect(checkFingerprint(`import Runner from ${JSON.stringify("../../../../../" + source)};`).length)
      .toBeGreaterThan(0);
  });
  it("admits the exact authored native built control separately from forensic source data", () => {
    const control = nativeControlImports.map(specifier => `import type Native from ${JSON.stringify(specifier)};`).join("\n");
    expect(analyzeMedusaSourceIslandBoundary({
      ...emptyInput, currencyPromotion: nativeControlPromotion,
      rootSources: [{ relativePath: nativeScenario, text: `${control}\n
        import { createRequire } from "node:module";
        async function sourceEvidence() { const paths = ["third_party/medusa/SOURCE.json",
          "third_party/medusa/upstream/packages/modules/product/src/services/product-module-service.ts"];
          const requirePinned = createRequire(new URL("third_party/medusa/upstream/packages/medusa-test-utils/package.json", root));
          const nativePgExport = requirePinned.resolve("@medusajs/framework/pg");
          const nativeDepsPg = createRequire(nativePgExport).resolve("@medusajs/deps/pg");
          const nativeDriver = createRequire(nativeDepsPg).resolve("pg");
          const requirePromoted = createRequire(import.meta.url);
          requirePromoted.resolve("pg"); requirePromoted.resolve("@medusajs/product/services");
          requirePromoted.resolve("@medusajs/utils/modules-sdk/medusa-internal-service"); }
        nativeRunner({ resolve: fileURLToPath(new URL("third_party/medusa/upstream/packages/modules/product", root)) });` },
      { relativePath: nativeObserver, text: `import { createRequire } from "node:module";
        const requirePinned = createRequire(new URL("../../../../../third_party/medusa/upstream/packages/medusa-test-utils/package.json", import.meta.url));
        requirePinned("@medusajs/framework/pg");` }],
    }).errors).toEqual([]);

    for (const relativePath of [
      "packages/medusa-adapter/benchmarks/core-performance/native-retrieval/adjacent.ts",
      "packages/medusa-adapter/src/native-control.ts",
      "packages/other/src/native-control.ts",
    ]) {
      expect(analyzeMedusaSourceIslandBoundary({
        ...emptyInput, currencyPromotion: nativeControlPromotion,
        rootSources: [{ relativePath, text: `import Native from ${JSON.stringify(nativeControlImports[0])};` }],
      }).errors.some(error => error.includes("must not import Medusa source-island module"))).toBe(true);
    }
  });

  it("refuses computed imports and aliases of the native control loader", () => {
    const computedSource = `async function sourceEvidence() {
      const paths = ["third_party/medusa/upstream/packages/modules/product/src/services/product-module-service.ts"];
      await import(paths[0]); }`;
    expect(analyzeMedusaSourceIslandBoundary({ ...emptyInput, currencyPromotion: nativeControlPromotion,
      rootSources: [{ relativePath: nativeScenario, text: computedSource }] }).errors)
      .toContain(`${nativeScenario}:3 must not compute or alias native control module loading.`);
    for (const tail of [
      'const load = requirePinned; load(repository);',
      'const load = createRequire; load(import.meta.url)(repository);',
      'requirePinned(repository);',
      'requirePinned.resolve(repository);',
      'requirePinned["resolve"](repository);',
      'Reflect.apply(requirePinned, undefined, [repository]);',
    ]) {
      const text = `import { createRequire } from "node:module";
        const requirePinned = createRequire(new URL("../../../../../third_party/medusa/upstream/packages/medusa-test-utils/package.json", import.meta.url));
        const repository = "./dist/repositories/product.js"; ${tail}`;
      expect(analyzeMedusaSourceIslandBoundary({ ...emptyInput, currencyPromotion: nativeControlPromotion,
        rootSources: [{ relativePath: nativeObserver, text }] }).errors.some(error =>
          error.includes("must not compute or alias native control module loading"))).toBe(true);
    }
    for (const text of [
      'import * as mod from "node:module"; mod["createRequire"](import.meta.url)(repository);',
      'import mod from "node:module"; mod["createRequire"](import.meta.url)(repository);',
      'import { createRequire as load } from "node:module"; load(import.meta.url)(repository);',
      'import * as mod from "module"; mod["createRequire"](import.meta.url)(repository);',
    ]) {
      expect(analyzeMedusaSourceIslandBoundary({ ...emptyInput, currencyPromotion: nativeControlPromotion,
        rootSources: [{ relativePath: nativeObserver, text }] }).errors.some(error =>
          error.includes("must not compute or alias native control module loading"))).toBe(true);
    }
    expect(analyzeMedusaSourceIslandBoundary({ ...emptyInput, currencyPromotion: nativeControlPromotion,
      rootSources: [{ relativePath: nativeScenario,
        text: 'const outside = "third_party/medusa/upstream/packages/modules/product/src/services/product-module-service.ts";' }] }).errors)
      .toContain(`${nativeScenario}:1 must not alias the Medusa source island.`);
  });

  it("refuses unlisted native paths, source imports and missing authored benchmark configuration", () => {
    for (const specifier of [
      "../../../../../third_party/medusa/upstream/packages/modules/product/src/services/product-module-service.ts",
      "third_party/medusa/upstream/packages/modules/product/src/services/product-module-service.ts",
      "../../../../../third_party/medusa/upstream/packages/medusa-test-utils/dist/unlisted-runner",
    ]) {
      expect(analyzeMedusaSourceIslandBoundary({
        ...emptyInput, currencyPromotion: nativeControlPromotion,
        rootSources: [{ relativePath: nativeScenario, text: `import Native from ${JSON.stringify(specifier)};` }],
      }).errors.some(error => error.includes("must not import Medusa source-island module"))).toBe(true);
    }
    for (const relativePath of [nativeScenario, nativeObserver]) {
      expect(analyzeMedusaSourceIslandBoundary({
        ...emptyInput, currencyPromotion: nativeControlPromotion,
        rootSources: [{ relativePath, text: 'const path = "third_party/medusa/upstream/packages/modules/product/dist/unlisted.js";' }],
      }).errors.some(error => error.includes("must not alias the Medusa source island"))).toBe(true);
    }
    for (const files of [nativeControlPromotion.files.filter(file => file.target !== nativeConfig),
      nativeControlPromotion.files.map(file => file.target === nativeScenario ? { ...file, classification: "preserved" } : file)]) {
      const errors = analyzeMedusaSourceIslandBoundary({
        ...emptyInput, currencyPromotion: { ...nativeControlPromotion, files },
        rootSources: [{ relativePath: nativeScenario, text: `import Native from ${JSON.stringify(nativeControlImports[0])};
          const path = "third_party/medusa/upstream/packages/modules/product/src/services/product-module-service.ts";` }],
      }).errors;
      expect(errors.some(error => error.includes("must not import Medusa source-island module"))).toBe(true);
      expect(errors.some(error => error.includes("must not alias the Medusa source island"))).toBe(true);
    }
  });

  it("admits only the named connected proof edges and exact authored targets", () => {
    const edges = [
      { importer: "packages/persistence-postgres/test/execution/finiteIndexedBodyPermission.test.ts",
        specifier: "../../../medusa-adapter/test/support/native-product-attempt-seed", target: "packages/medusa-adapter/test/support/native-product-attempt-seed.ts" },
      { importer: "packages/persistence-postgres/test/execution/finitePreparedSourceComposition.test.ts",
        specifier: "../../../medusa-adapter/src/composition/schema", target: "packages/medusa-adapter/src/composition/schema.ts" },
      { importer: "packages/flarex-backend/test/mixedMutationProduct.workerd.test.ts",
        specifier: "../../medusa-adapter/src/modules/product/attempt", target: "packages/medusa-adapter/src/modules/product/attempt.ts" },
      { importer: "packages/flarex-backend/test/preparedTargetMetadata.postgres.test.ts",
        specifier: "../../medusa-adapter/test/support/logical-currency-fixture", target: "packages/medusa-adapter/test/support/logical-currency-fixture.ts" },
      { importer: "packages/flarex-backend/test/mixedMutationFiniteRetirement.workerd.test.ts",
        specifier: "../../medusa-adapter/src/modules/currency/service", target: "packages/medusa-adapter/src/modules/currency/service.ts" },
      ...["application/applicationFiniteBindingCorrelation.test.ts", "application/bindingMetadataBackfillScenario.ts", "execution/finiteSourceCommitClosure.test.ts",
        "storage/catalog/appSchemaCandidateValidation.postgres.test.ts", "execution/journal/sessionJournalMultiSource.test.ts",
        "frameworks/commerceTransaction/commerceLogicalInitialization.test.ts"]
        .map(file => ({ importer: `packages/persistence-postgres/test/${file}`,
          specifier: posix.relative(posix.dirname(`packages/persistence-postgres/test/${file}`),
            "packages/medusa-adapter/test/support/logical-currency-fixture.ts").replace(/\.ts$/u, ""),
          target: "packages/medusa-adapter/test/support/logical-currency-fixture.ts" })),
      ...["logical-currency-fixture", "logical-product-fixture"].map(fixture => ({
        importer: "packages/executor/test/performance/support/productFlows.ts",
        specifier: `../../../../medusa-adapter/test/support/${fixture}`, target: `packages/medusa-adapter/test/support/${fixture}.ts`,
      })),
    ];
    const promotion = { ...nativeControlPromotion, files: edges.map(edge =>
      ({ target: edge.target, targetSha256: "pinned", classification: "authored" })) };
    for (const edge of edges) {
      const text = `import { operation } from ${JSON.stringify(edge.specifier)};`;
      expect(analyzeMedusaSourceIslandBoundary({ ...emptyInput, currencyPromotion: promotion,
        rootSources: [{ relativePath: edge.importer, text }] }).errors).toEqual([]);
      for (const relativePath of ["packages/flarex-backend/test/adjacent.test.ts", "packages/flarex-backend/src/runtime.ts",
        "packages/persistence-postgres/test/adjacent.test.ts", "packages/persistence-postgres/src/runtime.ts",
        "packages/executor/test/performance/support/adjacentFlows.ts", "packages/executor/src/productFlows.ts"]) {
        const specifier = posix.relative(posix.dirname(relativePath), edge.target).replace(/\.ts$/u, "");
        expect(analyzeMedusaSourceIslandBoundary({ ...emptyInput, currencyPromotion: promotion,
          rootSources: [{ relativePath, text: `import { operation } from ${JSON.stringify(specifier)};` }] }).errors
          .some(error => error.includes("must not cross Currency package ownership"))).toBe(true);
      }
      expect(analyzeMedusaSourceIslandBoundary({ ...emptyInput,
        currencyPromotion: { ...promotion, files: [] }, rootSources: [{ relativePath: edge.importer, text }] }).errors.length).toBeGreaterThan(0);
      expect(analyzeMedusaSourceIslandBoundary({ ...emptyInput,
        currencyPromotion: { ...promotion, files: promotion.files.map(file => file.target === edge.target
          ? { ...file, classification: "preserved" } : file) }, rootSources: [{ relativePath: edge.importer, text }] }).errors.length).toBeGreaterThan(0);
      const nativeSpecifier = posix.relative(posix.dirname(edge.importer), "packages/medusa-adapter/src/modules/product/module.ts")
        .replace(/\.ts$/u, "");
      expect(analyzeMedusaSourceIslandBoundary({ ...emptyInput, currencyPromotion: promotion,
        rootSources: [{ relativePath: edge.importer, text: `import ${JSON.stringify(nativeSpecifier)};` }] }).errors
        .some(error => error.includes("must not cross Currency package ownership"))).toBe(true);
    }
    const importer = "packages/executor/test/performance/support/productFlows.ts";
    for (const specifier of [
      "../../../../medusa-adapter/test/support/logical-pricing-fixture",
      "../../../../medusa-adapter/src/modules/product/attempt",
      "../../../../medusa-adapter/src/workflows/product/launch",
      "../../../../medusa-adapter/test/support/logical-currency-fixture.ts",
      "../../../../medusa-adapter/test/support/./logical-product-fixture",
    ]) expect(analyzeMedusaSourceIslandBoundary({ ...emptyInput, currencyPromotion: promotion,
      rootSources: [{ relativePath: importer, text: `import ${JSON.stringify(specifier)};` }] }).errors.length).toBeGreaterThan(0);
    for (const relativePath of ["packages/executor/src/productFlows.ts", "packages/executor/test/performance/support/adjacentFlows.ts"]) {
      const specifier = posix.relative(posix.dirname(relativePath), "packages/medusa-adapter/test/support/logical-product-fixture.ts")
        .replace(/\.ts$/u, "");
      expect(analyzeMedusaSourceIslandBoundary({ ...emptyInput, currencyPromotion: promotion,
        rootSources: [{ relativePath, text: `import ${JSON.stringify(specifier)};` }] }).errors
        .some(error => error.includes("must not cross Currency package ownership"))).toBe(true);
    }
  });

  it("admits only the extracted diagnostic owner's exact erased Product result type", () => {
    const specifier = "@flarex/medusa-adapter/internal/product-attempt";
    const target = "packages/medusa-adapter/src/modules/product/attempt.ts";
    const promotion = { sourceCommit: "test", buildFiles: [], testAliases: [],
      packages: [{ path: "packages/medusa-adapter", name: "@flarex/medusa-adapter", dependencies: {},
        exports: ["./internal/product-attempt"] }],
      files: [{ target, targetSha256: "pinned", classification: "authored" }],
    };
    const importType = `import type { PrivateProductAttemptExecution } from "${specifier}";`;
    const consumers = ["packages/executor/test/performance/support/nativeProductOperationDiagnostics.ts",
      "packages/flarex-backend/test/nativeProductOperationDiagnostics.test.ts"];
    for (const relativePath of consumers) {
      /** @param {string} text */
      const check = (text, currencyPromotion = promotion) => analyzeMedusaSourceIslandBoundary({
        ...emptyInput, currencyPromotion, rootSources: [{ relativePath, text }],
      }).errors;
      expect(check(importType)).toEqual([]);
      expect(check(`import type {\n PrivateProductAttemptExecution\n } from '${specifier}';`)).toEqual([]);
      for (const forbidden of [
        `import { PrivateProductAttemptExecution } from "${specifier}";`,
        `import { type PrivateProductAttemptExecution, executePrivateProductAttemptOperation } from "${specifier}";`,
        `import type Product from "${specifier}";`,
        `import type * as Product from "${specifier}";`,
        `import type { PrivateProductAttemptExecution, PrivateProductAttemptBinding } from "${specifier}";`,
        `import type { PrivateProductAttemptExecution as Renamed } from "${specifier}";`,
        `export type { PrivateProductAttemptExecution } from "${specifier}";`,
        `require("${specifier}");`, `import("${specifier}");`,
        `/** @type {import("${specifier}").PrivateProductAttemptExecution} */ let product;`,
      ]) {
        expect(check(forbidden).length).toBeGreaterThan(0);
        // A valid erased import must not suppress another source position on
        // the same line through the preprocessing duplicate filter.
        expect(check(`${importType} ${forbidden}`).length).toBeGreaterThan(0);
      }
      expect(check(importType, { ...promotion, files: [] }).length).toBeGreaterThan(0);
      expect(check(importType, { ...promotion, packages: promotion.packages.map(pkg => ({ ...pkg, exports: [] })) }).length)
        .toBeGreaterThan(0);
    }
    for (const relativePath of ["packages/flarex-backend/test/support/adjacentDiagnostic.ts",
      "packages/flarex-backend/test/adjacentDiagnostic.test.ts", "packages/flarex-backend/src/nativeProductOperationDiagnostics.ts"]) {
      expect(analyzeMedusaSourceIslandBoundary({ ...emptyInput, currencyPromotion: promotion,
        rootSources: [{ relativePath, text: importType }] }).errors.length).toBeGreaterThan(0);
    }
  });

  it("admits only the pinned core Product, Pricing and Link proof fixture and test dependency", () => {
    const promotion = {
      sourceCommit: "test", buildFiles: [], testAliases: [],
      packages: [{ path: "packages/medusa-adapter", name: "@flarex/medusa-adapter",
        dependencies: {}, exports: ["./internal/product-attempt"] }],
      files: [
        "packages/medusa-adapter/test/support/logical-currency-fixture.ts",
        "packages/medusa-adapter/test/support/logical-product-fixture.ts",
        "packages/medusa-adapter/test/support/logical-pricing-fixture.ts",
        "packages/medusa-adapter/test/support/logical-variant-pricing-link-fixture.ts",
        "packages/medusa-adapter/test/support/native-product-attempt-seed.ts",
        "packages/medusa-adapter/src/modules/product/attempt.ts",
        "packages/medusa-adapter/src/workflows/product/launch.ts",
        "packages/medusa-adapter/test/support/product-launch-performance-fixture.ts",
      ].map(target => ({ target, targetSha256: "pinned", classification: "authored" })),
    };
    const imports = `
      import "../../../../medusa-adapter/test/support/logical-currency-fixture";
      import "../../../../medusa-adapter/test/support/logical-product-fixture";
      import "../../../../medusa-adapter/test/support/logical-pricing-fixture";
      import "../../../../medusa-adapter/test/support/logical-variant-pricing-link-fixture";
      import "../../../../medusa-adapter/test/support/native-product-attempt-seed";
      import "@flarex/medusa-adapter/internal/product-attempt";
      import "../../../../medusa-adapter/src/workflows/product/launch";
    `;
    expect(analyzeMedusaSourceIslandBoundary({
      ...emptyInput, currencyPromotion: promotion,
      rootManifests: [{ relativePath: "packages/executor/package.json",
        manifest: { devDependencies: { "@flarex/medusa-adapter": "workspace:*" } } }],
      rootSources: [{ relativePath: "packages/executor/test/performance/support/mixedMutationProductFixture.ts",
        text: imports }],
    }).errors).toEqual([]);
    expect(analyzeMedusaSourceIslandBoundary({ ...emptyInput, currencyPromotion: promotion,
      rootSources: [{ relativePath: "packages/executor/test/performance/support/medusaScenario.ts",
        text: 'import "../../../../medusa-adapter/test/support/product-launch-performance-fixture";' }],
    }).errors).toEqual([]);
    for (const relativePath of ["packages/executor/src/medusaScenario.ts", "packages/executor/test/performance/support/adjacentScenario.ts"]) {
      expect(analyzeMedusaSourceIslandBoundary({ ...emptyInput, currencyPromotion: promotion,
        rootSources: [{ relativePath, text: relativePath.includes("/src/")
          ? 'import "../../medusa-adapter/test/support/product-launch-performance-fixture";'
          : 'import "../../../../medusa-adapter/test/support/product-launch-performance-fixture";' }],
      }).errors.length).toBeGreaterThan(0);
    }
    expect(analyzeMedusaSourceIslandBoundary({ ...emptyInput, currencyPromotion: promotion,
      rootManifests: [{ relativePath: "packages/executor/package.json",
        manifest: { dependencies: { "@flarex/medusa-adapter": "workspace:*" } } }],
    }).errors.length).toBeGreaterThan(0);
    const timingImport = 'import type { LogicalCurrencyPreparationTiming } from "../../../../medusa-adapter/test/support/logical-currency-fixture";';
    expect(analyzeMedusaSourceIslandBoundary({ ...emptyInput, currencyPromotion: promotion,
      rootSources: [{ relativePath: "packages/executor/test/performance/support/scenario.ts", text: timingImport }],
    }).errors).toEqual([]);
    for (const text of [timingImport.replace("import type", "import"), timingImport.replace("LogicalCurrencyPreparationTiming", "LogicalCurrencyFixture")]) {
      expect(analyzeMedusaSourceIslandBoundary({ ...emptyInput, currencyPromotion: promotion,
        rootSources: [{ relativePath: "packages/executor/test/performance/support/scenario.ts", text }],
      }).errors.length).toBeGreaterThan(0);
    }
    const production = analyzeMedusaSourceIslandBoundary({
      ...emptyInput, currencyPromotion: promotion,
      rootManifests: [{ relativePath: "packages/flarex-backend/package.json",
        manifest: { dependencies: { "@flarex/medusa-adapter": "workspace:*" } } }],
      rootSources: [{ relativePath: "packages/flarex-backend/src/support/nativeProduct.ts", text: imports.replaceAll("../../../../medusa-adapter/", "../../../medusa-adapter/") }],
    }).errors;
    expect(production).toContain(
      'packages/flarex-backend/package.json: dependencies must not reference Medusa source-island dependency "@flarex/medusa-adapter".',
    );
    expect(production).toContain(
      'packages/flarex-backend/src/support/nativeProduct.ts:7 must not import unadmitted promoted Currency module "@flarex/medusa-adapter/internal/product-attempt".',
    );
    expect(production).toContain(
      'packages/flarex-backend/src/support/nativeProduct.ts:2 must not cross Currency package ownership through "../../../medusa-adapter/test/support/logical-currency-fixture".',
    );
    expect(production).toContain(
      'packages/flarex-backend/src/support/nativeProduct.ts:4 must not cross Currency package ownership through "../../../medusa-adapter/test/support/logical-pricing-fixture".',
    );
    expect(production).toContain(
      'packages/flarex-backend/src/support/nativeProduct.ts:5 must not cross Currency package ownership through "../../../medusa-adapter/test/support/logical-variant-pricing-link-fixture".',
    );
    expect(production).toContain(
      'packages/flarex-backend/src/support/nativeProduct.ts:8 must not cross Currency package ownership through "../../../medusa-adapter/src/workflows/product/launch".',
    );
    const otherFixture = analyzeMedusaSourceIslandBoundary({
      ...emptyInput, currencyPromotion: promotion,
      rootSources: [{ relativePath: "packages/flarex-backend/test/support/otherFixture.ts", text: imports.replaceAll("../../../../medusa-adapter/", "../../../medusa-adapter/") }],
    }).errors;
    expect(otherFixture).toContain(
      'packages/flarex-backend/test/support/otherFixture.ts:4 must not cross Currency package ownership through "../../../medusa-adapter/test/support/logical-pricing-fixture".',
    );
    expect(otherFixture).toContain(
      'packages/flarex-backend/test/support/otherFixture.ts:8 must not cross Currency package ownership through "../../../medusa-adapter/src/workflows/product/launch".',
    );
    const benchmarkImport = 'import "../../medusa-adapter/test/support/product-launch-performance-fixture";';
    expect(analyzeMedusaSourceIslandBoundary({
      ...emptyInput, currencyPromotion: promotion,
      rootSources: [{ relativePath: "packages/flarex-backend/test/mixedMutationPerformance.postgres.test.ts",
        text: benchmarkImport }],
    }).errors).toEqual([]);
    for (const relativePath of ["packages/flarex-backend/test/otherPerformance.test.ts",
      "packages/flarex-backend/src/performance.ts"]) {
      expect(analyzeMedusaSourceIslandBoundary({
        ...emptyInput, currencyPromotion: promotion,
        rootSources: [{ relativePath, text: benchmarkImport }],
      }).errors).toContain(
        `${relativePath}:1 must not cross Currency package ownership through "../../medusa-adapter/test/support/product-launch-performance-fixture".`,
      );
    }
  });

  it("admits the exact native capture decoder only in its connected root-gate proofs", () => {
    const target = "packages/medusa-adapter/src/workflow/value.ts";
    const promotion = {
      sourceCommit: "test", buildFiles: [], testAliases: [],
      packages: [{ path: "packages/medusa-adapter", name: "@flarex/medusa-adapter", dependencies: {}, exports: [] }],
      files: [{ target, targetSha256: "pinned", classification: "authored" }],
    };
    const specifier = "../../../../medusa-adapter/src/workflow/value";
    const text = `import { captureWorkflowValue } from ${JSON.stringify(specifier)};`;
    for (const relativePath of ["packages/persistence-postgres/test/frameworks/atomicCommerce/atomicCommerceSharedInstallation.test.ts",
      "packages/persistence-postgres/test/frameworks/atomicCommerce/borrowedWorkflowCapture.test.ts"]) {
      const input = { ...emptyInput, currencyPromotion: promotion, rootSources: [{ relativePath, text }] };
      expect(analyzeMedusaSourceIslandBoundary(input).errors).toEqual([]);
      expect(analyzeMedusaSourceIslandBoundary({ ...input,
        currencyPromotion: { ...promotion, files: [] },
      }).errors.length).toBeGreaterThan(0);
      expect(analyzeMedusaSourceIslandBoundary({ ...input,
        rootSources: [{ relativePath, text: text.replace("workflow/value", "workflow/host") }],
      }).errors.length).toBeGreaterThan(0);
    }
    for (const relativePath of ["packages/persistence-postgres/test/adjacentCapture.test.ts",
      "packages/persistence-postgres/src/workflowCapture.ts"]) {
      const adjacentSpecifier = posix.relative(posix.dirname(relativePath), target).replace(/\.ts$/u, "");
      expect(analyzeMedusaSourceIslandBoundary({ ...emptyInput, currencyPromotion: promotion,
        rootSources: [{ relativePath, text: `import { captureWorkflowValue } from ${JSON.stringify(adjacentSpecifier)};` }],
      }).errors.length).toBeGreaterThan(0);
    }
  });

  it("accepts independent Flarex and Medusa graphs", () => {
    expect(analyzeMedusaSourceIslandBoundary({
      ...emptyInput,
      rootManifests: [{
        relativePath: "packages/example/package.json",
        manifest: { dependencies: { "flarex-protocol": "workspace:*" } },
      }],
      rootSources: [{
        relativePath: "packages/example/src/index.ts",
        text: 'export { value } from "flarex-protocol";',
      }],
      islandManifests: [{
        relativePath: "third_party/medusa/upstream/packages/example/package.json",
        manifest: { dependencies: { "@medusajs/types": "workspace:*" } },
      }],
      islandSources: [{
        relativePath: "third_party/medusa/upstream/packages/example/src/index.ts",
        text: 'export { value } from "@medusajs/types";',
      }],
      rootScripts: {
        "medusa:install": "corepack pnpm@11.7.0 --dir third_party/medusa/upstream install",
      },
    }).errors).toEqual([]);
  });

  it("rejects Medusa packages and island paths in Flarex manifests", () => {
    expect(analyzeMedusaSourceIslandBoundary({
      ...emptyInput,
      rootManifests: [{
        relativePath: "packages/example/package.json",
        manifest: {
          dependencies: { "@medusajs/types": "workspace:*" },
          devDependencies: {
            medusa: "file:../../third_party/medusa/upstream/packages/medusa",
          },
        },
      }],
    }).errors).toEqual([
      'packages/example/package.json: dependencies must not reference Medusa source-island dependency "@medusajs/types".',
      'packages/example/package.json: devDependencies must not use a path dependency into the Medusa source island "medusa".',
    ]);
  });

  it("rejects every static Flarex import form into Medusa", () => {
    expect(analyzeMedusaSourceIslandBoundary({
      ...emptyInput,
      rootSources: [{
        relativePath: "apps/example/src/index.ts",
        text: `
          import { one } from "@medusajs/types";
          export type { Two } from "@medusajs/framework/types";
          type Three = import("@medusajs/utils").Three;
          import Four = require("@medusajs/modules-sdk");
          const five = require("@medusajs/dal");
          const six = require.resolve("@medusajs/dml");
          void import("../../../third_party/medusa/upstream/package.json");
        `,
      }],
    }).errors).toEqual([
      'apps/example/src/index.ts:2 must not import Medusa source-island module "@medusajs/types".',
      'apps/example/src/index.ts:3 must not import Medusa source-island module "@medusajs/framework/types".',
      'apps/example/src/index.ts:4 must not import Medusa source-island module "@medusajs/utils".',
      'apps/example/src/index.ts:5 must not import Medusa source-island module "@medusajs/modules-sdk".',
      'apps/example/src/index.ts:6 must not import Medusa source-island module "@medusajs/dal".',
      'apps/example/src/index.ts:7 must not import Medusa source-island module "@medusajs/dml".',
      'apps/example/src/index.ts:8 must not import Medusa source-island module "../../../third_party/medusa/upstream/package.json".',
    ]);
  });

  it("rejects Flarex dependencies and escaping paths in island manifests", () => {
    expect(analyzeMedusaSourceIslandBoundary({
      ...emptyInput,
      islandManifests: [{
        relativePath: "third_party/medusa/upstream/packages/example/package.json",
        manifest: {
          dependencies: { "@flarex/utils": "workspace:*" },
          devDependencies: { host: "file:../../../../../packages/executor" },
        },
      }],
    }).errors).toEqual([
      'third_party/medusa/upstream/packages/example/package.json: dependencies must not reference Flarex dependency "@flarex/utils".',
      'third_party/medusa/upstream/packages/example/package.json: devDependencies must not use a path dependency outside the Medusa source island "host".',
    ]);
  });

  it("rejects Flarex and escaping imports from island source", () => {
    expect(analyzeMedusaSourceIslandBoundary({
      ...emptyInput,
      islandSources: [{
        relativePath: "third_party/medusa/upstream/packages/example/src/index.ts",
        text: `
          import { one } from "@flarex/utils/records";
          export { two } from "flarex-protocol";
          void import("../../../../../packages/executor/src/index.ts");
        `,
      }],
    }).errors).toEqual([
      'third_party/medusa/upstream/packages/example/src/index.ts:2 must not import Flarex or escape the Medusa source island through "@flarex/utils/records".',
      'third_party/medusa/upstream/packages/example/src/index.ts:3 must not import Flarex or escape the Medusa source island through "flarex-protocol".',
      'third_party/medusa/upstream/packages/example/src/index.ts:4 must not import Flarex or escape the Medusa source island through "../../../../../packages/executor/src/index.ts".',
    ]);
  });

  it("rejects root-workspace membership and implicit root-script entry", () => {
    expect(analyzeMedusaSourceIslandBoundary({
      ...emptyInput,
      rootWorkspaceText: "packages:\n  - packages/*\n  - third_party/medusa/upstream/packages/*\n",
      rootScripts: {
        test: "pnpm --dir third_party/medusa/upstream test",
        "medusa:test": "pnpm --dir third_party/medusa/upstream test",
      },
    }).errors).toEqual([
      "pnpm-workspace.yaml must not include the Medusa source island.",
      'package.json: non-Medusa script "test" must not enter the Medusa source island.',
    ]);
  });

  it("rejects package scripts and unsupported workspace declarations that can evade root recursion", () => {
    const packageScriptErrors = analyzeMedusaSourceIslandBoundary({
      ...emptyInput,
      rootManifests: [{
        relativePath: "packages/example/package.json",
        manifest: {
          name: "example",
          scripts: { build: "pnpm --dir ../../third_party/medusa/upstream build" },
        },
      }],
    }).errors;
    expect(packageScriptErrors).toContain(
      'packages/example/package.json: root-workspace script "build" must not enter the Medusa source island.',
    );

    for (const rootWorkspaceText of [
      'packages: ["packages/*", "apps/*", "third_party/medusa/upstream/*"]\n',
      "packages:\n  - packages/**\n  - apps/*\n",
    ]) {
      expect(analyzeMedusaSourceIslandBoundary({
        ...emptyInput,
        rootWorkspaceText,
      }).errors).toContain(
        "pnpm-workspace.yaml must not include the Medusa source island.",
      );
    }
  });

  it("rejects indirect Medusa command entry from ordinary root recursion", () => {
    expect(analyzeMedusaSourceIslandBoundary({
      ...emptyInput,
      rootScripts: {
        test: "pnpm medusa:source:verify",
        "medusa:verify": "pnpm medusa:source:verify",
      },
      rootManifests: [{
        relativePath: "packages/example/package.json",
        manifest: {
          scripts: {
            test: "pnpm --workspace-root medusa:test:workerd",
          },
        },
      }],
    }).errors).toEqual([
      'package.json: non-Medusa script "test" must not enter the Medusa source island.',
      'packages/example/package.json: root-workspace script "test" must not enter the Medusa source island.',
    ]);
  });

  it("rejects Medusa workspace scripts that enter Flarex", () => {
    expect(analyzeMedusaSourceIslandBoundary({
      ...emptyInput,
      rootManifests: [{
        relativePath: "packages/executor/package.json",
        manifest: { name: "@flarex/executor" },
      }],
      islandManifests: [{
        relativePath: "third_party/medusa/upstream/packages/example/package.json",
        manifest: {
          scripts: {
            build: "node ../../../../../packages/executor/src/index.ts",
            test: "pnpm --filter @flarex/executor test",
          },
        },
      }],
    }).errors).toEqual([
      'third_party/medusa/upstream/packages/example/package.json: Medusa script "build" must not enter the Flarex root workspace.',
      'third_party/medusa/upstream/packages/example/package.json: Medusa script "test" must not enter the Flarex root workspace.',
    ]);
  });

  it("rejects inherited root aliases and root tooling entry", () => {
    expect(analyzeMedusaSourceIslandBoundary({
      ...emptyInput,
      rootConfigs: [{
        relativePath: "tsconfig.base.json",
        text: '{"compilerOptions":{"paths":{"commerce":["./third_party/medusa/upstream/packages/medusa"]}}}',
      }],
      rootToolSources: [{
        relativePath: "scripts/run-tests.mjs",
        text: 'await import("../third_party/medusa/upstream/package.json");',
      }, {
        relativePath: "test-lanes.json",
        text: '{"steps":[{"args":["medusa:source:verify"]}]}',
      }],
      rootSymlinks: [{
        relativePath: "scripts/lib",
        target: "../third_party/medusa/upstream",
      }],
    }).errors).toEqual([
      "scripts/run-tests.mjs: root tooling must not enter the Medusa source island.",
      "test-lanes.json: root tooling must not enter the Medusa source island.",
      "tsconfig.base.json: configuration must not alias the Medusa source island.",
      "scripts/lib: symlink must not target the Medusa source island.",
    ]);
  });

  it("rejects package-manager resolver edges across the island boundary", () => {
    expect(analyzeMedusaSourceIslandBoundary({
      ...emptyInput,
      rootManifests: [{
        relativePath: "package.json",
        manifest: {
          pnpm: {
            overrides: { commerce: "link:third_party/medusa/upstream/packages/medusa" },
            packageExtensions: {
              host: { dependencies: { "@medusajs/types": "workspace:*" } },
            },
          },
        },
      }],
      islandManifests: [{
        relativePath: "third_party/medusa/upstream/package.json",
        manifest: {
          resolutions: { host: "link:../../../packages/executor" },
        },
      }],
    }).errors).toEqual([
      "package.json: pnpm must not resolve Medusa or the Medusa source island.",
      "third_party/medusa/upstream/package.json: resolutions must not resolve Flarex or escape the Medusa source island.",
    ]);
  });

  it("rejects workspace-level resolver edges across both package graphs", () => {
    expect(analyzeMedusaSourceIslandBoundary({
      ...emptyInput,
      rootManifests: [{
        relativePath: "packages/flarex-dev/package.json",
        manifest: { name: "flarex-dev" },
      }],
      rootWorkspaceText: `${emptyInput.rootWorkspaceText}
catalog:
  commerce: link:third_party/medusa/upstream/packages/medusa
`,
      islandWorkspaceText: `packages:
  - packages/*
catalog:
  host: link:../../../packages/flarex-dev
`,
    }).errors).toEqual([
      "pnpm-workspace.yaml must not resolve Medusa or the Medusa source island.",
      "third_party/medusa/upstream/pnpm-workspace.yaml must not resolve Flarex or escape the Medusa source island.",
    ]);
  });

  it("rejects island workspace membership that escapes into Flarex", () => {
    expect(analyzeMedusaSourceIslandBoundary({
      ...emptyInput,
      islandWorkspaceText: `packages:
  - packages/*
  - ../../../packages/*
`,
    }).errors).toEqual([
      "third_party/medusa/upstream/pnpm-workspace.yaml must not include paths outside the Medusa source island.",
    ]);
  });

  it("fails closed on unsupported workspace resolver YAML forms", () => {
    expect(analyzeMedusaSourceIslandBoundary({
      ...emptyInput,
      rootWorkspaceText: `${emptyInput.rootWorkspaceText}
catalog: { commerce: "link:third_party/medusa/upstream/packages/medusa" }
`,
      islandWorkspaceText: `packages:
  - packages/*
catalog:
  host: &host link:../../../packages/executor
`,
    }).errors).toEqual([
      "pnpm-workspace.yaml must not resolve Medusa or the Medusa source island.",
      "third_party/medusa/upstream/pnpm-workspace.yaml must not resolve Flarex or escape the Medusa source island.",
    ]);
  });

  it("rejects workspace path dependencies, config aliases, bundler aliases, and symlinks into the island", () => {
    expect(analyzeMedusaSourceIslandBoundary({
      ...emptyInput,
      rootManifests: [{
        relativePath: "packages/example/package.json",
        manifest: {
          devDependencies: {
            medusa: "workspace:../../third_party/medusa/upstream/packages/medusa",
          },
        },
      }],
      rootConfigs: [{
        relativePath: "packages/example/tsconfig.json",
        text: '{"compilerOptions":{"paths":{"medusa":["../../third_party/medusa/upstream"]}}}',
      }],
      rootSources: [{
        relativePath: "apps/example/vite.config.ts",
        text: 'const alias = "../../third_party/medusa/upstream/packages/medusa";',
      }],
      rootSymlinks: [{
        relativePath: "packages/example/medusa",
        target: "../../third_party/medusa/upstream",
      }],
    }).errors).toEqual([
      'packages/example/package.json: devDependencies must not use a path dependency into the Medusa source island "medusa".',
      "apps/example/vite.config.ts:1 must not alias the Medusa source island.",
      "packages/example/tsconfig.json: configuration must not alias the Medusa source island.",
      "packages/example/medusa: symlink must not target the Medusa source island.",
    ]);
  });

  it("rejects absolute dependency paths, absolute symlinks, and broad workspace membership", () => {
    const errors = analyzeMedusaSourceIslandBoundary({
      ...emptyInput,
      rootWorkspaceText: "packages:\n  - \"**\"\n",
      rootScripts: {
        build: "pnpm --dir THIRD_PARTY/MEDUSA/upstream build",
      },
      rootManifests: [{
        relativePath: "packages/example/package.json",
        manifest: {
          dependencies: {
            medusa: "file:C:/repo/third_party/medusa/upstream/packages/medusa",
            medusaCaseVariant: "link:../../THIRD_PARTY/MEDUSA/upstream/packages/medusa",
          },
        },
      }],
      rootSymlinks: [
        {
          relativePath: "packages/example/medusa",
          target: "C:/repo/third_party/medusa/upstream",
        },
        {
          relativePath: "packages/example/medusa-case-variant",
          target: "../../THIRD_PARTY/MEDUSA/upstream",
        },
      ],
      islandManifests: [{
        relativePath: "third_party/medusa/upstream/packages/example/package.json",
        manifest: { dependencies: { host: "link:C:/repo/packages/executor" } },
      }],
    }).errors;

    expect(errors).toContain("pnpm-workspace.yaml must not include the Medusa source island.");
    expect(errors).toContain(
      'package.json: non-Medusa script "build" must not enter the Medusa source island.',
    );
    expect(errors).toContain(
      'packages/example/package.json: dependencies must not use a path dependency into the Medusa source island "medusa".',
    );
    expect(errors).toContain(
      'packages/example/package.json: dependencies must not use a path dependency into the Medusa source island "medusaCaseVariant".',
    );
    expect(errors).toContain(
      "packages/example/medusa: symlink must not target the Medusa source island.",
    );
    expect(errors).toContain(
      "packages/example/medusa-case-variant: symlink must not target the Medusa source island.",
    );
    expect(errors).toContain(
      'third_party/medusa/upstream/packages/example/package.json: dependencies must not use a path dependency outside the Medusa source island "host".',
    );
  });

  it("rejects module.require, triple-slash, and JSDoc references in both directions", () => {
    const errors = analyzeMedusaSourceIslandBoundary({
      ...emptyInput,
      rootManifests: [{
        relativePath: "packages/flarex-dev/package.json",
        manifest: { name: "flarex-dev" },
      }],
      rootSources: [{
        relativePath: "packages/example/src/index.js",
        text: `/// <reference types="@medusajs/types" />
/** @type {import("@medusajs/utils").Thing} */
/** @import { Other } from "@medusajs/framework" */
module.require("@medusajs/dal");`,
      }],
      islandSources: [{
        relativePath: "third_party/medusa/upstream/packages/example/src/index.js",
        text: `/// <reference types="flarex-dev" />
/** @type {import("flarex-dev/runtime").Thing} */
module.require("flarex-dev");`,
      }],
    }).errors;

    expect(errors).toHaveLength(7);
    expect(errors).toEqual(expect.arrayContaining([
      'packages/example/src/index.js:1 must not import Medusa source-island module "@medusajs/types".',
      'packages/example/src/index.js:2 must not import Medusa source-island module "@medusajs/utils".',
      'packages/example/src/index.js:3 must not import Medusa source-island module "@medusajs/framework".',
      'packages/example/src/index.js:4 must not import Medusa source-island module "@medusajs/dal".',
      'third_party/medusa/upstream/packages/example/src/index.js:1 must not import Flarex or escape the Medusa source island through "flarex-dev".',
      'third_party/medusa/upstream/packages/example/src/index.js:2 must not import Flarex or escape the Medusa source island through "flarex-dev/runtime".',
      'third_party/medusa/upstream/packages/example/src/index.js:3 must not import Flarex or escape the Medusa source island through "flarex-dev".',
    ]));
  });

  it("derives root package names and rejects manifest, config, and symlink aliases", () => {
    const errors = analyzeMedusaSourceIslandBoundary({
      ...emptyInput,
      rootManifests: [
        {
          relativePath: "packages/flarex-dev/package.json",
          manifest: { name: "flarex-dev" },
        },
        {
          relativePath: "packages/example/package.json",
          manifest: {
            imports: { "#medusa": "../../third_party/medusa/upstream/package.json" },
          },
        },
      ],
      islandManifests: [{
        relativePath: "third_party/medusa/upstream/packages/example/package.json",
        manifest: {
          dependencies: {
            dev: "flarex-dev",
            devAlias: "npm:flarex-dev@0.0.0",
          },
          imports: { "#host": "../../../../../packages/flarex-dev/src/index.ts" },
        },
      }],
      islandConfigs: [{
        relativePath: "third_party/medusa/upstream/packages/example/tsconfig.json",
        text: '{"compilerOptions":{"paths":{"host":["../../../../../packages/flarex-dev/src"]}}}',
      }],
      islandSymlinks: [{
        relativePath: "third_party/medusa/upstream/packages/example/host",
        target: "../../../../../packages/flarex-dev",
      }],
    }).errors;

    expect(errors).toEqual(expect.arrayContaining([
      'third_party/medusa/upstream/packages/example/package.json: dependencies must not reference Flarex dependency "dev".',
      'third_party/medusa/upstream/packages/example/package.json: dependencies must not reference Flarex dependency "devAlias".',
      'packages/example/package.json: imports must not alias the Medusa source island through "../../third_party/medusa/upstream/package.json".',
      'third_party/medusa/upstream/packages/example/package.json: imports must not alias Flarex or escape the Medusa source island through "../../../../../packages/flarex-dev/src/index.ts".',
      "third_party/medusa/upstream/packages/example/tsconfig.json: configuration must not alias Flarex or escape the Medusa source island.",
      "third_party/medusa/upstream/packages/example/host: symlink must not escape the Medusa source island.",
    ]));
  });
});
