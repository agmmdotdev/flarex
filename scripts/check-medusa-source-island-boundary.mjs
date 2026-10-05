#!/usr/bin/env node
// @ts-check
import {
  existsSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "@typescript/typescript6";
import { admitsCurrencyImport, verifyCurrencyPromotion } from "./check-medusa-currency-promotion.mjs";

const sourceExtensions = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);
const dependencyFields = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];
const islandPrefix = "third_party/medusa/upstream/";
const mixedProductTestFixture = "packages/executor/test/performance/support/mixedMutationProductFixture.ts";
const nativeProductDiagnosticTypeConsumers = new Set([
  "packages/executor/test/performance/support/nativeProductOperationDiagnostics.ts",
  "packages/flarex-backend/test/nativeProductOperationDiagnostics.test.ts",
]);
const coreMedusaScenario = "packages/executor/test/performance/support/medusaScenario.ts";
const coreMedusaScenarioImports = new Map([
  ["../../../../medusa-adapter/test/support/product-launch-performance-fixture",
    "packages/medusa-adapter/test/support/product-launch-performance-fixture.ts"],
]);
const mixedPerformanceTest = "packages/flarex-backend/test/mixedMutationPerformance.postgres.test.ts";
const mixedProductTestImports = new Map([
  ["../../../../medusa-adapter/test/support/logical-currency-fixture",
    "packages/medusa-adapter/test/support/logical-currency-fixture.ts"],
  ["../../../../medusa-adapter/test/support/logical-product-fixture",
    "packages/medusa-adapter/test/support/logical-product-fixture.ts"],
  ["../../../../medusa-adapter/test/support/logical-pricing-fixture",
    "packages/medusa-adapter/test/support/logical-pricing-fixture.ts"],
  ["../../../../medusa-adapter/test/support/logical-variant-pricing-link-fixture",
    "packages/medusa-adapter/test/support/logical-variant-pricing-link-fixture.ts"],
  ["../../../../medusa-adapter/test/support/native-product-attempt-seed",
    "packages/medusa-adapter/test/support/native-product-attempt-seed.ts"],
  ["@flarex/medusa-adapter/internal/product-attempt",
    "packages/medusa-adapter/src/product-attempt.ts"],
  ["../../../../medusa-adapter/src/product-launch-workflow",
    "packages/medusa-adapter/src/product-launch-workflow.ts"],
]);
const mixedPerformanceTestImports = new Map([
  ["../../medusa-adapter/test/support/product-launch-performance-fixture",
    "packages/medusa-adapter/test/support/product-launch-performance-fixture.ts"],
]);
const mixedProductWorkerdTest = "packages/flarex-backend/test/mixedMutationProduct.workerd.test.ts";
const mixedProductWorkerdTestImports = new Map([
  ["../../medusa-adapter/src/product-attempt", "packages/medusa-adapter/src/product-attempt.ts"],
]);
const preparedTargetMetadataTest = "packages/flarex-backend/test/preparedTargetMetadata.postgres.test.ts";
const preparedTargetMetadataTestImports = new Map([
  ["../../medusa-adapter/test/support/logical-currency-fixture", "packages/medusa-adapter/test/support/logical-currency-fixture.ts"],
]);
// Connected finite-contract proofs borrow the exact authored native construction.
// These edges grant no permission to adjacent tests or production consumers.
const finiteContractTestImports = new Map([
  ["packages/flarex-backend/test/mixedMutationFiniteRetirement.workerd.test.ts", {
    specifier: "../../medusa-adapter/src/currency-service", target: "packages/medusa-adapter/src/currency-service.ts",
  }],
  ["packages/persistence-postgres/test/applicationFiniteBindingCorrelation.test.ts", {
    specifier: "../../medusa-adapter/test/support/logical-currency-fixture", target: "packages/medusa-adapter/test/support/logical-currency-fixture.ts",
  }],
  ["packages/persistence-postgres/test/bindingMetadataBackfillScenario.ts", {
    specifier: "../../medusa-adapter/test/support/logical-currency-fixture", target: "packages/medusa-adapter/test/support/logical-currency-fixture.ts",
  }],
  ["packages/persistence-postgres/test/finiteSourceCommitClosure.test.ts", {
    specifier: "../../medusa-adapter/test/support/logical-currency-fixture", target: "packages/medusa-adapter/test/support/logical-currency-fixture.ts",
  }],
]);
// Existing publication measurements reuse the authored observer through these
// exact test consumers. Adjacent files and runtime code inherit no permission.
const publicationServerTestImports = new Map([
  ["packages/flarex-backend/test/publicationPerformance.postgres.test.ts",
    "../../medusa-adapter/benchmarks/core-performance/native-retrieval/server"],
  ["packages/flarex-backend/test/support/publicationPerformanceReport.ts",
    "../../../medusa-adapter/benchmarks/core-performance/native-retrieval/server"],
  ["packages/flarex-backend/test/support/publicationPerformanceServer.ts",
    "../../../medusa-adapter/benchmarks/core-performance/native-retrieval/server"],
]);
const publicationServerOwner = "packages/medusa-adapter/benchmarks/core-performance/native-retrieval/server.ts";
const nativeRetrievalScenario = "packages/medusa-adapter/benchmarks/core-performance/native-retrieval/scenario.ts";
const nativeRetrievalObservation = "packages/medusa-adapter/benchmarks/core-performance/native-retrieval/observation.ts";
const nativeRetrievalConfig = "packages/medusa-adapter/vitest.native-retrieval.config.ts";
const nativeRetrievalRunner = "packages/medusa-adapter/benchmarks/core-performance/native-retrieval/native-runner.ts";
const mixedNativeReadScenario = "packages/medusa-adapter/benchmarks/core-performance/mixed-native-read/scenario.ts";
const mixedNativeReadTest = "packages/medusa-adapter/benchmarks/core-performance/mixed-native-read/scenario.postgres.test.ts";
const mixedNativeReadConfig = "packages/medusa-adapter/vitest.mixed-native-read.config.ts";
const nativeBusinessPrefix = "packages/medusa-adapter/benchmarks/core-performance/native-business/";
const nativeBusinessOwners = ["native.ts", "workflow.ts", "run.ts", "tsconfig.json"].map(file => nativeBusinessPrefix + file);
const nativeBusinessImports = new Map([
  [nativeBusinessPrefix + "native.ts", new Set([
    "core/framework/dist/deps/awilix", "core/framework/dist/utils/index", "core/modules-sdk/dist/medusa-app",
    "medusa-test-utils/dist/module-test-persistence-adapter", "medusa-test-utils/dist/database",
    "medusa-test-utils/dist/init-modules", "medusa-test-utils/dist/mock-event-bus-service",
    "modules/product/dist/services/product-module-service", "modules/pricing/dist/services/pricing-module",
  ].map(file => `../../../../../third_party/medusa/upstream/packages/${file}.js`))],
  [nativeBusinessPrefix + "workflow.ts", new Set([
    "core/workflows-sdk/dist/index", "core/framework/dist/types/index",
    "core/core-flows/dist/product/steps/create-product-variants", "core/core-flows/dist/pricing/steps/create-price-sets",
    "core/core-flows/dist/product/steps/create-variant-pricing-link", "core/core-flows/dist/product/workflows/update-product-tags",
    "core/core-flows/dist/common/steps/use-query-graph",
  ].map(file => `../../../../../third_party/medusa/upstream/packages/${file}.js`))],
]);
/** Benchmark-only native business reference. Every named owner must be inventoried;
 * neighbors and production consumers receive no source-island permission.
 * @param {import("./check-medusa-currency-promotion.mjs").Promotion | undefined} promotion */
function admitsNativeBusinessOwner(promotion) {
  return promotion !== undefined && nativeBusinessOwners.every(target =>
    promotion.files.some(file => file.target === target && file.classification === "authored"));
}
const nativeRunnerSource = "third_party/medusa/upstream/packages/medusa-test-utils/src/module-test-runner.ts";
const nativeRunnerImports = new Set([
  "../../../../../third_party/medusa/upstream/packages/core/framework/dist/logger",
  "../../../../../third_party/medusa/upstream/packages/core/framework/dist/modules-sdk",
  "../../../../../third_party/medusa/upstream/packages/core/framework/dist/utils",
  "../../../../../third_party/medusa/upstream/node_modules/ulid",
  ...["database", "init-modules", "mock-event-bus-service", "module-test-persistence-adapter", "module-test-runner",
    "test-worker-identity"].map(name =>
    `../../../../../third_party/medusa/upstream/packages/medusa-test-utils/dist/${name}`),
]);
const nativeRetrievalImports = new Set([
  "../../../../../third_party/medusa/upstream/packages/modules/product/dist/services/product-module-service",
  "../../../../../third_party/medusa/upstream/packages/medusa-test-utils/dist/module-test-persistence-adapter",
]);
// Exact forensic inputs and the pinned bootstrap path are data allowances, not
// module import permissions. In particular the source .ts paths stay forbidden.
const nativeRetrievalScenarioPaths = new Set([
  "third_party/medusa/SOURCE.json",
  "third_party/medusa/upstream/pnpm-lock.yaml",
  "third_party/medusa/upstream/packages/modules/product/src/services/product-module-service.ts",
  "third_party/medusa/upstream/packages/core/utils/src/modules-sdk/medusa-internal-service.ts",
  "third_party/medusa/upstream/packages/core/utils/src/dal/mikro-orm/mikro-orm-repository.ts",
  "third_party/medusa/upstream/packages/modules/product/dist/index.js",
  "third_party/medusa/upstream/packages/modules/product/dist/services/product-module-service.js",
  "third_party/medusa/upstream/packages/modules/product/dist/repositories/product.js",
  "third_party/medusa/upstream/packages/modules/link-modules/dist/index.js",
  nativeRunnerSource,
  "third_party/medusa/upstream/packages/medusa-test-utils/dist/module-test-runner.js",
  "third_party/medusa/upstream/packages/medusa-test-utils/dist/module-test-persistence-adapter.js",
  "third_party/medusa/upstream/packages/medusa-test-utils/dist/init-modules.js",
  "third_party/medusa/upstream/packages/medusa-test-utils/dist/database.js",
  "third_party/medusa/upstream/node_modules/pg-god/node_modules/tslib/tslib.js",
  "third_party/medusa/upstream/node_modules/pg-god/node_modules/tslib/package.json",
  "third_party/medusa/upstream/packages/medusa-test-utils/package.json",
  "third_party/medusa/upstream/packages/modules/product",
]);

/** The verified promotion manifest pins the authored optional scenario,
 * observer and dedicated config. No neighboring benchmark or runtime inherits
 * these native control permissions.
 * @param {import("./check-medusa-currency-promotion.mjs").Promotion | undefined} promotion */
function admitsNativeRetrievalOwner(promotion) {
  return promotion?.packages.some(pkg => pkg.path === "packages/medusa-adapter" && pkg.name === "@flarex/medusa-adapter") === true
    && [nativeRetrievalScenario, nativeRetrievalObservation, nativeRetrievalConfig].every(target =>
      promotion.files.some(file => file.target === target && file.classification === "authored"));
}

/** @param {import("./check-medusa-currency-promotion.mjs").Promotion | undefined} promotion */
function admitsNativeRetrievalRunner(promotion) {
  return admitsNativeRetrievalOwner(promotion) && promotion?.files.some(file =>
    file.target === nativeRetrievalRunner && file.classification === "testHarnessPort" && file.source === nativeRunnerSource) === true;
}

/** This paired finite benchmark borrows the inventoried native runner; it does
 * not authorize another native loader or adjacent framework consumer.
 * @param {import("./check-medusa-currency-promotion.mjs").Promotion | undefined} promotion */
function admitsMixedNativeReadOwner(promotion) {
  return admitsNativeRetrievalRunner(promotion) && promotion !== undefined
    && [mixedNativeReadScenario, mixedNativeReadTest, mixedNativeReadConfig].every(target =>
      promotion.files.some(file => file.target === target && file.classification === "authored"));
}

/** @param {import("./check-medusa-currency-promotion.mjs").Promotion | undefined} promotion
 * @param {string} relativePath @param {ts.StringLiteralLike} node */
function admitsNativeRetrievalPath(promotion, relativePath, node) {
  if (admitsNativeBusinessOwner(promotion) && relativePath === nativeBusinessPrefix + "native.ts") {
    const parent = node.parent;
    if (node.text === "../../../../../third_party/medusa/upstream/packages/medusa-test-utils/dist/mock-event-bus-service.js")
      return (ts.isLiteralTypeNode(parent) && ts.isImportTypeNode(parent.parent))
        || ts.isCallExpression(parent) && parent.arguments[0] === node && parent.arguments.length === 1
        && ts.isCallExpression(parent.expression) && ts.isIdentifier(parent.expression.expression)
        && parent.expression.expression.text === "createRequire"
        && parent.expression.arguments.length === 1 && parent.expression.arguments[0]?.getText() === "import.meta.url";
    if (["product", "pricing", "link-modules"].some(name => node.text === `../../../../../third_party/medusa/upstream/packages/modules/${name}`))
      return ts.isNewExpression(parent) && parent.arguments?.[0] === node && parent.arguments.length === 2
        && parent.arguments[1]?.getText() === "import.meta.url" && ts.isCallExpression(parent.parent)
        && ts.isIdentifier(parent.parent.expression) && parent.parent.expression.text === "fileURLToPath";
  }
  if (!admitsNativeRetrievalOwner(promotion)) return false;
  const parent = node.parent;
  if (relativePath === mixedNativeReadTest && admitsMixedNativeReadOwner(promotion)
    && node.text === "../../../../../third_party/medusa/upstream/packages/modules/product")
    return ts.isNewExpression(parent) && parent.arguments?.[0] === node
      && parent.arguments?.length === 2 && parent.arguments[1]?.getText() === "import.meta.url"
      && ts.isCallExpression(parent.parent) && ts.isIdentifier(parent.parent.expression)
      && parent.parent.expression.text === "fileURLToPath"
      && ts.isPropertyAssignment(parent.parent.parent) && parent.parent.parent.name.getText() === "resolve"
      && ts.isObjectLiteralExpression(parent.parent.parent.parent)
      && ts.isCallExpression(parent.parent.parent.parent.parent)
      && ts.isIdentifier(parent.parent.parent.parent.parent.expression)
      && parent.parent.parent.parent.parent.expression.text === "moduleIntegrationTestRunner";
  if (relativePath === nativeRetrievalScenario && nativeRetrievalScenarioPaths.has(node.text)) {
    if (node.text === nativeRunnerSource && !admitsNativeRetrievalRunner(promotion)) return false;
    if (ts.isArrayLiteralExpression(parent) && ts.isVariableDeclaration(parent.parent)
      && ts.isIdentifier(parent.parent.name) && parent.parent.name.text === "paths") {
      /** @type {ts.Node | undefined} */
      let ancestor = parent.parent.parent;
      while (ancestor && !ts.isFunctionLike(ancestor)) ancestor = ancestor.parent;
      return ancestor !== undefined && ts.isFunctionDeclaration(ancestor) && ancestor.name?.text === "sourceEvidence";
    }
    if (node.text === "third_party/medusa/upstream/packages/medusa-test-utils/package.json")
      return ts.isNewExpression(parent) && parent.arguments?.[0] === node && ts.isCallExpression(parent.parent)
        && ts.isIdentifier(parent.parent.expression) && parent.parent.expression.text === "createRequire";
    if (node.text === "third_party/medusa/upstream/packages/modules/product")
      return ts.isNewExpression(parent) && parent.arguments?.[0] === node
        && parent.arguments?.length === 2 && parent.arguments[1]?.getText() === "root"
        && ts.isCallExpression(parent.parent) && ts.isIdentifier(parent.parent.expression)
        && parent.parent.expression.text === "fileURLToPath"
        && ts.isPropertyAssignment(parent.parent.parent) && parent.parent.parent.name.getText() === "resolve"
        && ts.isObjectLiteralExpression(parent.parent.parent.parent)
        && ts.isCallExpression(parent.parent.parent.parent.parent)
        && ts.isIdentifier(parent.parent.parent.parent.parent.expression)
        && parent.parent.parent.parent.parent.expression.text === "nativeRunner";
  }
  return relativePath === nativeRetrievalObservation
    && node.text === "../../../../../third_party/medusa/upstream/packages/medusa-test-utils/package.json"
    && ts.isNewExpression(parent) && parent.arguments?.[0] === node && ts.isCallExpression(parent.parent)
    && ts.isIdentifier(parent.parent.expression) && parent.parent.expression.text === "createRequire";
}

/** Seal the two named controls' small loader surface, rather than tracking
 * arbitrary data flow. Loader references may not escape into aliases, and only
 * the existing literal package keys may be resolved/loaded.
 * @param {ts.Node} node @param {string} relativePath */
function invalidNativeRetrievalLoader(node, relativePath) {
  if ([nativeBusinessPrefix + "native.ts", nativeBusinessPrefix + "run.ts"].includes(relativePath)) {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) return true;
    if (!ts.isIdentifier(node) || !["createRequire", "require"].includes(node.text)) return false;
    const parent = node.parent;
    if (node.text === "createRequire") {
      if (ts.isImportSpecifier(parent)) return parent.name !== node || parent.propertyName !== undefined;
      if (!ts.isCallExpression(parent) || parent.expression !== node || parent.arguments.length !== 1
        || parent.arguments[0]?.getText() !== "import.meta.url") return true;
      if (relativePath === nativeBusinessPrefix + "run.ts")
        return !ts.isVariableDeclaration(parent.parent) || parent.parent.name.getText() !== "require";
      const invocation = parent.parent;
      return !ts.isCallExpression(invocation) || invocation.expression !== parent || invocation.arguments.length !== 1
        || invocation.arguments[0] === undefined || !ts.isStringLiteralLike(invocation.arguments[0])
        || !["../../../../../third_party/medusa/upstream/packages/medusa-test-utils/dist/mock-event-bus-service.js",
          "../../../../../work/native-business-baseline/dependencies/node_modules/pg/lib/index.js"].includes(invocation.arguments[0].text);
    }
    if (ts.isVariableDeclaration(parent) && parent.name === node) return relativePath !== nativeBusinessPrefix + "run.ts";
    return relativePath !== nativeBusinessPrefix + "run.ts" || !ts.isPropertyAccessExpression(parent)
      || parent.expression !== node || parent.name.text !== "cache";
  }
  if (![nativeRetrievalScenario, nativeRetrievalObservation, mixedNativeReadScenario, mixedNativeReadTest].includes(relativePath)) return false;
  if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)
    && ["node:module", "module"].includes(node.moduleSpecifier.text)) {
    const bindings = node.importClause?.namedBindings;
    return node.moduleSpecifier.text !== "node:module" || node.importClause?.name !== undefined
      || bindings === undefined || !ts.isNamedImports(bindings) || bindings.elements.length !== 1
      || bindings.elements[0]?.name.text !== "createRequire" || bindings.elements[0]?.propertyName !== undefined;
  }
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
    && node.moduleReference.expression && ts.isStringLiteralLike(node.moduleReference.expression)
    && ["node:module", "module"].includes(node.moduleReference.expression.text)) return true;
  if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) return true;
  if (!ts.isIdentifier(node) || !["createRequire", "requirePinned", "requirePromoted", "require"].includes(node.text)) return false;
  const parent = node.parent;
  if (node.text === "createRequire") {
    if (ts.isImportSpecifier(parent)) return parent.name !== node || parent.propertyName !== undefined;
    if (!ts.isCallExpression(parent) || parent.expression !== node || parent.arguments.length !== 1) return true;
    const argument = parent.arguments[0];
    if (ts.isVariableDeclaration(parent.parent) && ts.isIdentifier(parent.parent.name)) {
      if (parent.parent.name.text === "requirePromoted")
        return relativePath !== nativeRetrievalScenario || argument?.getText() !== "import.meta.url";
      if (parent.parent.name.text === "requirePinned" && argument && ts.isNewExpression(argument)
        && ts.isIdentifier(argument.expression) && argument.expression.text === "URL") {
        const first = argument.arguments?.[0];
        const base = argument.arguments?.[1]?.getText();
        return argument.arguments?.length !== 2 || first === undefined || !ts.isStringLiteralLike(first)
          || (relativePath === nativeRetrievalScenario
            ? first.text !== "third_party/medusa/upstream/packages/medusa-test-utils/package.json" || base !== "root"
            : first.text !== "../../../../../third_party/medusa/upstream/packages/medusa-test-utils/package.json" || base !== "import.meta.url");
      }
    }
    const access = parent.parent;
    const resolve = access.parent;
    if (relativePath === nativeRetrievalScenario && ts.isPropertyAccessExpression(access) && access.name.text === "resolve"
      && ts.isCallExpression(resolve) && resolve.expression === access && resolve.arguments.length === 1
      && argument && ts.isIdentifier(argument) && resolve.arguments[0] && ts.isStringLiteralLike(resolve.arguments[0]))
      return !((argument.text === "nativePgExport" && resolve.arguments[0].text === "@medusajs/deps/pg")
        || (argument.text === "nativeDepsPg" && resolve.arguments[0].text === "pg"));
    return true;
  }
  if (ts.isVariableDeclaration(parent) && parent.name === node)
    return parent.initializer === undefined || !ts.isCallExpression(parent.initializer)
      || !ts.isIdentifier(parent.initializer.expression) || parent.initializer.expression.text !== "createRequire";
  if (node.text === "requirePinned" && relativePath === nativeRetrievalObservation && ts.isCallExpression(parent)
    && parent.expression === node && parent.arguments.length === 1 && parent.arguments[0] && ts.isStringLiteralLike(parent.arguments[0]))
    return parent.arguments[0].text !== "@medusajs/framework/pg";
  if (relativePath === nativeRetrievalScenario && ts.isPropertyAccessExpression(parent) && parent.expression === node
    && parent.name.text === "resolve" && ts.isCallExpression(parent.parent) && parent.parent.expression === parent
    && parent.parent.arguments.length === 1) {
    const key = parent.parent.arguments[0];
    return key === undefined || !ts.isStringLiteralLike(key) || !(node.text === "requirePinned"
      ? key.text === "@medusajs/framework/pg"
      : node.text === "requirePromoted" && ["pg", "@medusajs/product/services", "@medusajs/utils/modules-sdk/medusa-internal-service"].includes(key.text));
  }
  return true;
}

/** Only the named private tests may cross to their exact authored Medusa
 * support. Backend runtime has no authority. */
/** @param {import("./check-medusa-currency-promotion.mjs").Promotion | undefined} promotion
 * @param {string} relativePath
 * @param {string} specifier */
function admitsSelectedMixedTestImport(promotion, relativePath, specifier) {
  const permitted = relativePath === mixedProductTestFixture ? mixedProductTestImports
    : relativePath === coreMedusaScenario ? coreMedusaScenarioImports
    : relativePath === mixedPerformanceTest ? mixedPerformanceTestImports
      : relativePath === mixedProductWorkerdTest ? mixedProductWorkerdTestImports
        : relativePath === preparedTargetMetadataTest ? preparedTargetMetadataTestImports : undefined;
  const finiteContract = finiteContractTestImports.get(relativePath);
  const target = permitted?.get(specifier) ??
    (finiteContract?.specifier === specifier ? finiteContract.target : undefined) ??
    (publicationServerTestImports.get(relativePath) === specifier ? publicationServerOwner : undefined);
  return target !== undefined && promotion?.files.some(file =>
    file.target === target && file.classification === "authored") === true;
}

/** The extracted fixture observer and timing contract need exact erased types.
 * Runtime/value imports and neighboring consumers inherit no permission.
 * @param {import("./check-medusa-currency-promotion.mjs").Promotion | undefined} promotion
 * @param {string} relativePath @param {string} specifier @param {ts.Node | undefined} node */
function admitsSelectedMedusaTestTypeImport(promotion, relativePath, specifier, node) {
  const timing = relativePath === "packages/executor/test/performance/support/scenario.ts"
    && specifier === "../../../../medusa-adapter/test/support/logical-currency-fixture";
  const diagnostic = nativeProductDiagnosticTypeConsumers.has(relativePath)
    && specifier === "@flarex/medusa-adapter/internal/product-attempt";
  if ((!timing && !diagnostic)
    || node === undefined || !ts.isImportDeclaration(node) || node.importClause?.isTypeOnly !== true
    || node.importClause.name !== undefined) return false;
  const bindings = node.importClause.namedBindings;
  const imported = bindings !== undefined && ts.isNamedImports(bindings) && bindings.elements.length === 1
    ? bindings.elements[0] : undefined;
  return imported?.name.text === (timing ? "LogicalCurrencyPreparationTiming" : "PrivateProductAttemptExecution")
    && imported.propertyName === undefined
    && promotion?.packages.some(pkg => pkg.path === "packages/medusa-adapter" && pkg.name === "@flarex/medusa-adapter"
      && (timing || pkg.exports.includes("./internal/product-attempt"))) === true
    && promotion.files.some(file => file.target === (timing
      ? "packages/medusa-adapter/test/support/logical-currency-fixture.ts" : "packages/medusa-adapter/src/product-attempt.ts")
      && file.classification === "authored");
}

/**
 * @typedef {{ readonly relativePath: string, readonly manifest: Readonly<Record<string, unknown>> }} ManifestInput
 * @typedef {{ readonly relativePath: string, readonly text: string }} SourceInput
 * @typedef {{ readonly relativePath: string, readonly target: string }} SymlinkInput
 * @typedef {{
 *   readonly rootManifests: readonly ManifestInput[],
 *   readonly rootSources: readonly SourceInput[],
 *   readonly rootConfigs?: readonly SourceInput[],
 *   readonly rootSymlinks?: readonly SymlinkInput[],
 *   readonly rootToolSources?: readonly SourceInput[],
 *   readonly islandManifests: readonly ManifestInput[],
 *   readonly islandSources: readonly SourceInput[],
 *   readonly islandConfigs?: readonly SourceInput[],
 *   readonly islandSymlinks?: readonly SymlinkInput[],
 *   readonly islandWorkspaceText?: string,
 *   readonly rootWorkspaceText: string,
 *   readonly rootScripts: Readonly<Record<string, unknown>>,
 *   readonly currencyPromotion?: import("./check-medusa-currency-promotion.mjs").Promotion,
 * }} BoundaryInput
 */

/** @param {BoundaryInput} input */
export function analyzeMedusaSourceIslandBoundary(input) {
  /** @type {string[]} */
  const errors = [];
  const promotion = input.currencyPromotion;
  const rootPackageNames = new Set(input.rootManifests.flatMap(({ manifest }) =>
    typeof manifest.name === "string" && !promotion?.packages.some((pkg) => pkg.name === manifest.name && isMedusaPackage(pkg.name)) ? [manifest.name] : []
  ));

  if (workspaceIncludesIsland(input.rootWorkspaceText)) {
    errors.push(
      "pnpm-workspace.yaml must not include the Medusa source island.",
    );
  }
  if (
    workspaceConfigReferences(
      input.rootWorkspaceText,
      (value) =>
        isMedusaPackage(value)
        || normalized(value).includes("@medusajs/")
        || referencesIsland(value)
        || escapesIntoIsland(value, "pnpm-workspace.yaml"),
    )
  ) {
    errors.push(
      "pnpm-workspace.yaml must not resolve Medusa or the Medusa source island.",
    );
  }
  if (
    input.islandWorkspaceText !== undefined
    && islandWorkspaceEscapes(input.islandWorkspaceText)
  ) {
    errors.push(
      "third_party/medusa/upstream/pnpm-workspace.yaml must not include paths outside the Medusa source island.",
    );
  }
  if (
    input.islandWorkspaceText !== undefined
    && workspaceConfigReferences(
      input.islandWorkspaceText,
      (value) =>
        isRootPackageSpecifier(value, rootPackageNames)
        || escapesIsland(
          value,
          "third_party/medusa/upstream/pnpm-workspace.yaml",
        ),
    )
  ) {
    errors.push(
      "third_party/medusa/upstream/pnpm-workspace.yaml must not resolve Flarex or escape the Medusa source island.",
    );
  }

  for (const [name, value] of Object.entries(input.rootScripts)) {
    if (
      !name.startsWith("medusa:")
      && typeof value === "string"
      && (referencesIsland(value) || referencesMedusaCommand(value))
    ) {
      errors.push(
        `package.json: non-Medusa script "${name}" must not enter the Medusa source island.`,
      );
    }
  }
  for (const { relativePath, manifest } of input.rootManifests) {
    if (relativePath === "package.json" || !isRecord(manifest.scripts)) continue;
    for (const [name, value] of Object.entries(manifest.scripts)) {
      if (
        typeof value === "string"
        && (referencesIsland(value) || referencesMedusaCommand(value))
      ) {
        errors.push(
          `${relativePath}: root-workspace script "${name}" must not enter the Medusa source island.`,
        );
      }
    }
  }
  for (const { relativePath, manifest } of input.islandManifests) {
    if (!isRecord(manifest.scripts)) continue;
    for (const [name, value] of Object.entries(manifest.scripts)) {
      if (
        typeof value === "string"
        && islandScriptEscapes(value, relativePath, rootPackageNames)
      ) {
        errors.push(
          `${relativePath}: Medusa script "${name}" must not enter the Flarex root workspace.`,
        );
      }
    }
  }

  analyzeManifests(
    input.rootManifests,
    errors,
    (name, value, relativePath, field) => (isForbiddenRootDependency(name, value) || promotion?.packages.some((pkg) => pkg.name === name) === true)
      && !(["packages/flarex-backend/package.json", "packages/executor/package.json"].includes(relativePath) && field === "devDependencies"
        && name === "@flarex/medusa-adapter" && value === "workspace:*"
        && promotion?.packages.some(pkg => pkg.path === "packages/medusa-adapter" && pkg.name === name) === true)
      && !(value === "workspace:*" && promotion?.packages.some((pkg) =>
        relativePath === `${pkg.path}/package.json` && pkg.dependencies[name] === value)),
    "must not reference Medusa source-island dependency",
    escapesIntoIsland,
    "must not use a path dependency into the Medusa source island",
  );
  analyzeManifests(
    input.islandManifests,
    errors,
    (name, value) =>
      isForbiddenIslandDependency(name, value, rootPackageNames),
    "must not reference Flarex dependency",
    escapesIsland,
    "must not use a path dependency outside the Medusa source island",
  );
  analyzeManifestReferences(
    input.rootManifests,
    errors,
    (value, relativePath) =>
      isForbiddenRootSpecifier(value, relativePath),
    "must not alias the Medusa source island",
  );
  analyzeManifestReferences(
    input.islandManifests,
    errors,
    (value, relativePath) =>
      isForbiddenIslandSpecifier(value, relativePath, rootPackageNames),
    "must not alias Flarex or escape the Medusa source island",
  );
  analyzeResolverReferences(
    input.rootManifests,
    errors,
    (value, relativePath) =>
      isMedusaPackage(value)
      || normalized(value).includes("@medusajs/")
      || referencesIsland(value)
      || escapesIntoIsland(value, relativePath),
    "must not resolve Medusa or the Medusa source island",
  );
  analyzeResolverReferences(
    input.islandManifests,
    errors,
    (value, relativePath) =>
      isRootPackageSpecifier(value, rootPackageNames)
      || escapesIsland(value, relativePath),
    "must not resolve Flarex or escape the Medusa source island",
  );

  analyzeSources(input.rootSources, errors, (specifier, relativePath, node) => {
    if (admitsNativeBusinessOwner(promotion) && nativeBusinessImports.get(relativePath)?.has(specifier)) return undefined;
    if (admitsSelectedMedusaTestTypeImport(promotion, relativePath, specifier, node)) return undefined;
    if (admitsSelectedMixedTestImport(promotion, relativePath, specifier)) return undefined;
    if (relativePath === nativeRetrievalScenario && admitsNativeRetrievalOwner(promotion)
      && nativeRetrievalImports.has(specifier)) return undefined;
    if (admitsMixedNativeReadOwner(promotion)
      && relativePath === mixedNativeReadTest && nativeRetrievalImports.has(specifier)) return undefined;
    if (relativePath === nativeRetrievalRunner && admitsNativeRetrievalRunner(promotion)
      && nativeRunnerImports.has(specifier)) return undefined;
    if ((specifier.toLowerCase().startsWith("file:") || isPortableAbsolutePath(specifier)) && normalized(specifier).toLowerCase().includes("/packages/medusa-")) {
      return `must not bypass Currency exports through "${specifier}"`;
    }
    if (admitsCurrencyImport(promotion, relativePath, specifier)) return undefined;
    if (promotion?.packages.some((pkg) => specifier === pkg.name || specifier.startsWith(`${pkg.name}/`))) {
      return `must not import unadmitted promoted Currency module "${specifier}"`;
    }
    if (specifier.startsWith(".")) {
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(relativePath), normalized(specifier))).toLowerCase();
      const target = promotion?.packages.find((pkg) => resolved.startsWith(`${pkg.path.toLowerCase()}/`));
      if (target && !relativePath.toLowerCase().startsWith(`${target.path.toLowerCase()}/`)) return `must not cross Currency package ownership through "${specifier}"`;
    }
    if (isForbiddenRootSpecifier(specifier, relativePath)) {
      return `must not import Medusa source-island module "${specifier}"`;
    }
    return undefined;
  });
  analyzeRootSourceAliases(input.rootSources, errors, promotion);
  for (const toolSource of input.rootToolSources ?? []) {
    if (
      referencesIsland(toolSource.text)
      || normalized(toolSource.text).includes("@medusajs/")
      || referencesMedusaCommand(toolSource.text)
    ) {
      errors.push(
        `${toolSource.relativePath}: root tooling must not enter the Medusa source island.`,
      );
    }
  }

  for (const config of input.rootConfigs ?? []) {
    if (referencesIsland(config.text)) {
      errors.push(
        `${config.relativePath}: configuration must not alias the Medusa source island.`,
      );
    }
  }

  for (const symlink of input.rootSymlinks ?? []) {
    if (rootSymlinkEntersIsland(symlink)) {
      errors.push(
        `${symlink.relativePath}: symlink must not target the Medusa source island.`,
      );
    }
  }
  for (const config of input.islandConfigs ?? []) {
    if (islandConfigEscapes(config, rootPackageNames)) {
      errors.push(
        `${config.relativePath}: configuration must not alias Flarex or escape the Medusa source island.`,
      );
    }
  }
  for (const symlink of input.islandSymlinks ?? []) {
    if (islandSymlinkEscapes(symlink)) {
      errors.push(
        `${symlink.relativePath}: symlink must not escape the Medusa source island.`,
      );
    }
  }
  analyzeSources(input.islandSources, errors, (specifier, relativePath) => {
    if (isForbiddenIslandSpecifier(specifier, relativePath, rootPackageNames)) {
      return `must not import Flarex or escape the Medusa source island through "${specifier}"`;
    }
    return undefined;
  });

  return { errors };
}

/** @param {string} repoRoot */
export function discoverRootManifests(repoRoot) {
  /** @type {ManifestInput[]} */
  const manifests = [{
    relativePath: "package.json",
    manifest: readJsonRecord(path.join(repoRoot, "package.json")),
  }];
  for (const workspaceDirectory of ["packages", "apps"]) {
    const absoluteDirectory = path.join(repoRoot, workspaceDirectory);
    for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(absoluteDirectory, entry.name, "package.json");
      if (!existsSync(manifestPath)) continue;
      manifests.push({
        relativePath: normalized(path.relative(repoRoot, manifestPath)),
        manifest: readJsonRecord(manifestPath),
      });
    }
  }
  return manifests;
}

/** @param {string} repoRoot */
export function discoverRootSources(repoRoot) {
  return ["packages", "apps"].flatMap((directory) =>
    collectSources(path.join(repoRoot, directory), repoRoot)
  );
}

/** @param {string} repoRoot */
export function discoverRootConfigs(repoRoot) {
  const rootConfigs = readdirSync(repoRoot, { withFileTypes: true })
    .filter((entry) =>
      entry.isFile() && /^tsconfig(?:\.[^.]+)?\.json$/.test(entry.name)
    )
    .map((entry) => {
      const file = path.join(repoRoot, entry.name);
      return {
        relativePath: entry.name,
        text: readFileSync(file, "utf8"),
      };
    });
  return rootConfigs.concat(["packages", "apps"].flatMap((directory) =>
    collectFiles(path.join(repoRoot, directory), (file) =>
      /^tsconfig(?:\.[^.]+)?\.json$/.test(path.basename(file))
    ).map((file) => ({
      relativePath: normalized(path.relative(repoRoot, file)),
      text: readFileSync(file, "utf8"),
    }))
  ));
}

/** @param {string} repoRoot */
export function discoverRootToolSources(repoRoot) {
  const excluded = new Set([
    "scripts/check-medusa-currency-promotion.mjs",
    "scripts/check-medusa-currency-promotion.test.js",
    "scripts/check-medusa-test-port.mjs",
    "scripts/check-medusa-test-port.test.js",
    "scripts/check-medusa-currency-portable.mjs",
    "scripts/check-medusa-source-island-boundary.mjs",
    "scripts/check-medusa-source-island-boundary.test.js",
  ]);
  const toolingFiles = ["scripts", "tools", "integration"].flatMap((directory) =>
    collectFiles(path.join(repoRoot, directory), (file) =>
      isRootToolingTextFile(file)
    )
  );
  for (const entry of readdirSync(repoRoot, { withFileTypes: true })) {
    if (
      entry.isFile()
      && (
        sourceExtensions.has(path.extname(entry.name))
        || entry.name === "test-lanes.json"
      )
    ) {
      toolingFiles.push(path.join(repoRoot, entry.name));
    }
  }
  return toolingFiles
    .map((file) => ({
      relativePath: normalized(path.relative(repoRoot, file)),
      text: readFileSync(file, "utf8"),
    }))
    .filter(({ relativePath }) => !excluded.has(relativePath));
}

/** @param {string} file */
function isRootToolingTextFile(file) {
  return sourceExtensions.has(path.extname(file))
    || [".json", ".jsonc", ".yaml", ".yml", ".toml", ".sh", ".ps1"]
      .includes(path.extname(file));
}

/** @param {string} repoRoot */
export function discoverRootSymlinks(repoRoot) {
  const symlinks = ["packages", "apps", "scripts", "tools", "integration"]
    .flatMap((directory) =>
    collectSymlinks(path.join(repoRoot, directory), repoRoot)
  );
  for (const entry of readdirSync(repoRoot, { withFileTypes: true })) {
    if (!entry.isSymbolicLink()) continue;
    const absolutePath = path.join(repoRoot, entry.name);
    symlinks.push({
      relativePath: normalized(entry.name),
      target: normalized(readlinkSync(absolutePath)),
    });
  }
  return symlinks.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  );
}

/** @param {string} repoRoot */
export function discoverIslandManifests(repoRoot) {
  const upstreamRoot = path.join(repoRoot, "third_party", "medusa", "upstream");
  return admittedIslandPaths(repoRoot)
    .filter((relativePath) => path.posix.basename(relativePath) === "package.json")
    .map((relativePath) => {
      const file = path.join(upstreamRoot, ...relativePath.split("/"));
      return {
      relativePath: normalized(path.relative(repoRoot, file)),
      manifest: readJsonRecord(file),
      };
    });
}

/** @param {string} repoRoot */
export function discoverIslandSources(repoRoot) {
  const upstreamRoot = path.join(repoRoot, "third_party", "medusa", "upstream");
  return admittedIslandPaths(repoRoot)
    .filter((relativePath) => sourceExtensions.has(path.posix.extname(relativePath)))
    .map((relativePath) => {
      const file = path.join(upstreamRoot, ...relativePath.split("/"));
      return {
        relativePath: normalized(path.relative(repoRoot, file)),
        text: readFileSync(file, "utf8"),
      };
    });
}

/** @param {string} repoRoot */
export function discoverIslandConfigs(repoRoot) {
  const upstreamRoot = path.join(repoRoot, "third_party", "medusa", "upstream");
  return admittedIslandPaths(repoRoot)
    .filter((relativePath) =>
      /^tsconfig(?:\.[^.]+)?\.json$/.test(path.posix.basename(relativePath))
    )
    .map((relativePath) => {
      const file = path.join(upstreamRoot, ...relativePath.split("/"));
      return {
        relativePath: normalized(path.relative(repoRoot, file)),
        text: readFileSync(file, "utf8"),
      };
    });
}

/** @param {string} repoRoot */
export function discoverIslandSymlinks(repoRoot) {
  const metadata = readJsonRecord(
    path.join(repoRoot, "third_party", "medusa", "SOURCE.json"),
  );
  const symlinks = metadata.symlinks;
  if (!isRecord(symlinks)) {
    throw new Error("third_party/medusa/SOURCE.json.symlinks must be an object.");
  }
  return Object.entries(symlinks).map(([relativePath, target]) => {
    if (typeof target !== "string") {
      throw new Error(`Invalid Medusa source-island symlink target: ${relativePath}`);
    }
    return {
      relativePath: `third_party/medusa/${normalized(relativePath)}`,
      target: normalized(target),
    };
  });
}

/** @param {string} repoRoot */
function admittedIslandPaths(repoRoot) {
  const manifest = readFileSync(
    path.join(repoRoot, "third_party", "medusa", "SOURCE_SHA256SUMS"),
    "utf8",
  );
  return manifest.split(/\r?\n/).filter(Boolean).map((line) => {
    if (line.length < 67 || line.slice(64, 66) !== "  ") {
      throw new Error(`Invalid Medusa source-manifest entry: ${line}`);
    }
    const relativePath = normalized(line.slice(66));
    if (!relativePath.startsWith("upstream/")) {
      throw new Error(`Medusa source-manifest path must start with upstream/: ${relativePath}`);
    }
    return relativePath.slice("upstream/".length);
  });
}

/**
 * @param {readonly ManifestInput[]} manifests
 * @param {string[]} errors
 * @param {(name: string, value: string, relativePath: string, field: string) => boolean} forbiddenDependency
 * @param {string} dependencyMessage
 * @param {(value: string, relativePath: string) => boolean} forbiddenPath
 * @param {string} pathMessage
 */
function analyzeManifests(
  manifests,
  errors,
  forbiddenDependency,
  dependencyMessage,
  forbiddenPath,
  pathMessage,
) {
  for (const { relativePath, manifest } of manifests) {
    for (const field of dependencyFields) {
      const dependencies = manifest[field];
      if (!isRecord(dependencies)) continue;
      for (const [name, value] of Object.entries(dependencies)) {
        if (typeof value !== "string") continue;
        if (forbiddenDependency(name, value, relativePath, field)) {
          errors.push(
            `${relativePath}: ${field} ${dependencyMessage} "${name}".`,
          );
        } else if (forbiddenPath(value, relativePath)) {
          errors.push(
            `${relativePath}: ${field} ${pathMessage} "${name}".`,
          );
        }
      }
    }
  }
}

const manifestReferenceFields = [
  "imports",
  "exports",
  "browser",
  "main",
  "module",
  "types",
  "typings",
  "bin",
];
const resolverFields = ["pnpm", "resolutions", "overrides"];

/**
 * @param {readonly ManifestInput[]} manifests
 * @param {string[]} errors
 * @param {(value: string, relativePath: string) => boolean} forbidden
 * @param {string} message
 */
function analyzeManifestReferences(manifests, errors, forbidden, message) {
  for (const { relativePath, manifest } of manifests) {
    for (const field of manifestReferenceFields) {
      for (const value of nestedStrings(manifest[field])) {
        if (forbidden(value, relativePath)) {
          errors.push(`${relativePath}: ${field} ${message} through "${value}".`);
        }
      }
    }
  }
}

/**
 * @param {readonly ManifestInput[]} manifests
 * @param {string[]} errors
 * @param {(value: string, relativePath: string) => boolean} forbidden
 * @param {string} message
 */
function analyzeResolverReferences(manifests, errors, forbidden, message) {
  for (const { relativePath, manifest } of manifests) {
    for (const field of resolverFields) {
      if (
        nestedKeysAndStrings(manifest[field]).some((value) =>
          forbidden(value, relativePath)
        )
      ) {
        errors.push(`${relativePath}: ${field} ${message}.`);
      }
    }
  }
}

/** @param {unknown} value @returns {string[]} */
function nestedStrings(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(nestedStrings);
  if (isRecord(value)) return Object.values(value).flatMap(nestedStrings);
  return [];
}

/** @param {unknown} value @returns {string[]} */
function nestedKeysAndStrings(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(nestedKeysAndStrings);
  if (isRecord(value)) {
    return Object.entries(value).flatMap(([key, member]) =>
      [key, ...nestedKeysAndStrings(member)]
    );
  }
  return [];
}

/**
 * @param {readonly SourceInput[]} sources
 * @param {string[]} errors
 * @param {(specifier: string, relativePath: string, node?: ts.Node) => string | undefined} classify
 */
function analyzeSources(sources, errors, classify) {
  for (const source of sources) {
    const sourceFile = ts.createSourceFile(
      source.relativePath,
      source.text,
      ts.ScriptTarget.Latest,
      true,
      scriptKindForPath(source.relativePath),
    );
    const reported = new Set();
    /** @type {Array<{ specifier: string; start: number; end: number }>} */
    const admittedImportLiterals = [];
    visit(sourceFile);
    const preprocessed = ts.preProcessFile(source.text, true, true);
    for (const reference of [
      ...preprocessed.referencedFiles,
      ...preprocessed.typeReferenceDirectives,
      ...preprocessed.libReferenceDirectives,
      ...preprocessed.importedFiles,
    ]) {
      // An AST-dependent erased-import admission applies only to this exact
      // module literal. Other same-line imports still receive their own verdict.
      if (admittedImportLiterals.some(literal => literal.specifier === reference.fileName
        && reference.pos >= literal.start && reference.pos < literal.end)) continue;
      report(reference.fileName, reference.pos);
    }
    for (const comment of source.text.matchAll(/\/\*\*[\s\S]*?\*\//g)) {
      const commentStart = comment.index;
      if (commentStart === undefined) continue;
      for (const reference of comment[0].matchAll(/\bimport\s*\(\s*(["'])([^"']+)\1\s*\)/g)) {
        if (reference.index !== undefined && reference[2] !== undefined) {
          report(reference[2], commentStart + reference.index);
        }
      }
      for (const reference of comment[0].matchAll(/@import[^\r\n]*?\bfrom\s*(["'])([^"']+)\1/g)) {
        if (reference.index !== undefined && reference[2] !== undefined) {
          report(reference[2], commentStart + reference.index);
        }
      }
    }

    /** @param {ts.Node} node */
    function visit(node) {
      const specifier = moduleSpecifierForNode(node);
      if (specifier !== undefined) {
        report(specifier, node.getStart(sourceFile), node);
      }
      ts.forEachChild(node, visit);
    }

    /** @param {string} specifier @param {number} position @param {ts.Node} [node] */
    function report(specifier, position, node) {
      const message = classify(specifier, source.relativePath, node);
      if (message === undefined) {
        if (node !== undefined && ts.isImportDeclaration(node) && node.moduleSpecifier !== undefined
          && classify(specifier, source.relativePath) !== undefined) admittedImportLiterals.push({
          specifier, start: node.moduleSpecifier.getFullStart(), end: node.moduleSpecifier.getEnd(),
        });
        return;
      }
      const line = sourceFile.getLineAndCharacterOfPosition(position).line + 1;
      const key = `${line}\0${specifier}`;
      if (reported.has(key)) return;
      reported.add(key);
      errors.push(`${source.relativePath}:${line} ${message}.`);
    }
  }
}

/** @param {readonly SourceInput[]} sources @param {string[]} errors
 * @param {import("./check-medusa-currency-promotion.mjs").Promotion | undefined} promotion */
function analyzeRootSourceAliases(sources, errors, promotion) {
  for (const source of sources) {
    const sourceFile = ts.createSourceFile(
      source.relativePath,
      source.text,
      ts.ScriptTarget.Latest,
      true,
      scriptKindForPath(source.relativePath),
    );
    visit(sourceFile);

    /** @param {ts.Node} node */
    function visit(node) {
      if (invalidNativeRetrievalLoader(node, source.relativePath)) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        errors.push(`${source.relativePath}:${line} must not compute or alias native control module loading.`);
      }
      if (
        ts.isStringLiteralLike(node)
        && referencesIsland(node.text)
        && !admitsNativeRetrievalPath(promotion, source.relativePath, node)
        && (node.parent === undefined
          || moduleSpecifierForNode(node.parent) !== node.text)
      ) {
        const line = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        ).line + 1;
        errors.push(
          `${source.relativePath}:${line} must not alias the Medusa source island.`,
        );
      }
      ts.forEachChild(node, visit);
    }
  }
}

/** @param {string} name @param {string} value */
function isForbiddenRootDependency(name, value) {
  return isMedusaPackage(name)
    || normalized(value).includes("@medusajs/");
}

/** @param {string} name @param {string} value @param {ReadonlySet<string>} rootPackageNames */
function isForbiddenIslandDependency(name, value, rootPackageNames) {
  return isRootPackageSpecifier(name, rootPackageNames)
    || [...rootPackageNames].some((rootName) =>
      isRootPackageSpecifier(normalized(value), new Set([rootName]))
    );
}

/** @param {string} value @param {string} relativePath */
function escapesIntoIsland(value, relativePath) {
  const target = pathDependencyTarget(value);
  if (target === undefined) return false;
  if (isPortableAbsolutePath(target)) return referencesIsland(target);
  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(normalized(relativePath)), target),
  );
  return isMedusaIslandPath(resolved);
}

/** @param {string} value @param {string} relativePath */
function escapesIsland(value, relativePath) {
  const target = pathDependencyTarget(value);
  if (target === undefined) return false;
  if (isPortableAbsolutePath(target)) return true;
  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(normalized(relativePath)), target),
  );
  return !isMedusaUpstreamPath(resolved);
}

/** @param {string} value */
function pathDependencyTarget(value) {
  const portable = normalized(value);
  for (const prefix of ["file:", "link:"]) {
    if (portable.startsWith(prefix)) return portable.slice(prefix.length);
  }
  if (portable.startsWith("workspace:")) {
    const target = portable.slice("workspace:".length);
    if (
      target.startsWith(".")
      || target.startsWith("/")
      || /^[A-Za-z]:\//.test(target)
    ) {
      return target;
    }
  }
  return undefined;
}

/** @param {string} text */
function referencesIsland(text) {
  return normalized(text).toLowerCase().includes("third_party/medusa");
}

/** @param {string} text */
function referencesMedusaCommand(text) {
  return /(?:^|[\s"';&|])medusa:[A-Za-z0-9:_-]+/.test(text);
}

/** @param {string} text @param {string} relativePath @param {ReadonlySet<string>} rootPackageNames */
function islandScriptEscapes(text, relativePath, rootPackageNames) {
  const portable = normalized(text);
  if (
    isFlarexPackage(portable)
    || [...rootPackageNames].some((name) => portable.includes(name))
    || portable.includes("@flarex/")
  ) {
    return true;
  }
  return portable.split(/[\s"';&|()]+/).some((token) =>
    token.length > 0
    && (
      token.startsWith(".")
      || /^[A-Za-z]:\//.test(token)
      || (token.startsWith("/") && /\/(?:packages|apps)\//.test(token))
    )
    && isForbiddenIslandSpecifier(token, relativePath, rootPackageNames)
  );
}

/** @param {SymlinkInput} symlink */
function rootSymlinkEntersIsland(symlink) {
  if (isPortableAbsolutePath(symlink.target)) {
    return referencesIsland(symlink.target);
  }
  const resolved = path.posix.normalize(
    path.posix.join(
      path.posix.dirname(normalized(symlink.relativePath)),
      normalized(symlink.target),
    ),
  );
  return isMedusaIslandPath(resolved);
}

/** @param {SymlinkInput} symlink */
function islandSymlinkEscapes(symlink) {
  if (isPortableAbsolutePath(symlink.target)) return true;
  const resolved = path.posix.normalize(path.posix.join(
    path.posix.dirname(normalized(symlink.relativePath)),
    normalized(symlink.target),
  ));
  return !isMedusaUpstreamPath(resolved);
}

/** @param {string} specifier @param {string} relativePath */
function isForbiddenRootSpecifier(specifier, relativePath) {
  const portable = normalized(specifier);
  if (isMedusaPackage(portable) || referencesIsland(portable)) {
    return true;
  }
  if (pathDependencyTarget(portable) !== undefined) {
    return escapesIntoIsland(portable, relativePath);
  }
  if (!portable.startsWith(".")) return false;
  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(normalized(relativePath)), portable),
  );
  return isMedusaIslandPath(resolved);
}

/** @param {string} specifier @param {string} relativePath @param {ReadonlySet<string>} rootPackageNames */
function isForbiddenIslandSpecifier(specifier, relativePath, rootPackageNames) {
  const portable = normalized(specifier);
  if (isRootPackageSpecifier(portable, rootPackageNames)) return true;
  if (pathDependencyTarget(portable) !== undefined) {
    return escapesIsland(portable, relativePath);
  }
  if (isPortableAbsolutePath(portable)) return true;
  if (!portable.startsWith(".")) return false;
  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(normalized(relativePath)), portable),
  );
  return !isMedusaUpstreamPath(resolved);
}

/** @param {string} value */
function isMedusaIslandPath(value) {
  const portable = path.posix.normalize(normalized(value)).toLowerCase();
  return portable === "third_party/medusa"
    || portable.startsWith("third_party/medusa/");
}

/** @param {string} value */
function isMedusaUpstreamPath(value) {
  const portable = path.posix.normalize(normalized(value)).toLowerCase();
  return portable === "third_party/medusa/upstream"
    || portable.startsWith(islandPrefix);
}

/** @param {string} value */
function isMedusaPackage(value) {
  return value === "@medusajs" || value.startsWith("@medusajs/");
}

/** @param {string} value */
function isFlarexPackage(value) {
  return value === "@flarex"
    || value.startsWith("@flarex/")
    || value === "flarex"
    || value.startsWith("flarex/")
    || value === "flarex-protocol"
    || value.startsWith("flarex-protocol/")
    || value === "flarex-backend"
    || value.startsWith("flarex-backend/");
}

/** @param {string} value @param {ReadonlySet<string>} rootPackageNames */
function isRootPackageSpecifier(value, rootPackageNames) {
  if (isFlarexPackage(value)) return true;
  return [...rootPackageNames].some((name) =>
    value === name
      || value.startsWith(`${name}/`)
      || value === `npm:${name}`
      || value.startsWith(`npm:${name}@`)
  );
}

/** @param {string} value */
function isPortableAbsolutePath(value) {
  const portable = normalized(value);
  return portable.startsWith("/") || /^[A-Za-z]:\//.test(portable);
}

/** @param {SourceInput} config @param {ReadonlySet<string>} rootPackageNames */
function islandConfigEscapes(config, rootPackageNames) {
  const parsed = ts.parseConfigFileTextToJson(config.relativePath, config.text);
  if (parsed.error !== undefined || !isRecord(parsed.config)) return true;
  return nestedStrings(parsed.config).some((value) =>
    isForbiddenIslandSpecifier(value, config.relativePath, rootPackageNames)
  );
}

/** @param {string} workspaceText */
function workspaceIncludesIsland(workspaceText) {
  /** @type {string[]} */
  const patterns = [];
  let foundPackages = false;
  let insidePackages = false;
  for (const line of workspaceText.split(/\r?\n/)) {
    const withoutComment = line.split("#", 1)[0] ?? "";
    const content = withoutComment.trim();
    if (content.length === 0) continue;
    const isTopLevel = withoutComment.length === withoutComment.trimStart().length;
    if (isTopLevel) {
      if (content === "packages:") {
        foundPackages = true;
        insidePackages = true;
      } else if (content.startsWith("packages:")) {
        return true;
      } else {
        insidePackages = false;
      }
      continue;
    }
    if (!insidePackages) continue;
    if (!content.startsWith("-")) return true;
    const quotedPattern = content.slice(1).trim();
    patterns.push(normalized(
      /^(["']).*\1$/.test(quotedPattern)
        ? quotedPattern.slice(1, -1)
        : quotedPattern,
    ));
  }
  if (!foundPackages) return true;
  return patterns.length !== 2
    || !patterns.includes("packages/*")
    || !patterns.includes("apps/*");
}

/** @param {string} workspaceText */
function islandWorkspaceEscapes(workspaceText) {
  let foundPackages = false;
  let insidePackages = false;
  let packagePatternCount = 0;
  for (const line of workspaceText.split(/\r?\n/)) {
    const withoutComment = line.split("#", 1)[0] ?? "";
    const content = withoutComment.trim();
    if (content.length === 0) continue;
    const isTopLevel = withoutComment.length === withoutComment.trimStart().length;
    if (isTopLevel) {
      if (content === "packages:") {
        foundPackages = true;
        insidePackages = true;
      } else if (content.startsWith("packages:")) {
        return true;
      } else {
        insidePackages = false;
      }
      continue;
    }
    if (!insidePackages) continue;
    if (!content.startsWith("-")) return true;
    const quotedPattern = content.slice(1).trim();
    const pattern = normalized(
      /^(["']).*\1$/.test(quotedPattern)
        ? quotedPattern.slice(1, -1)
        : quotedPattern,
    );
    packagePatternCount += 1;
    if (pattern.startsWith("!") || isPortableAbsolutePath(pattern)) return true;
    const resolved = path.posix.normalize(
      path.posix.join("third_party/medusa/upstream", pattern),
    );
    if (!isMedusaUpstreamPath(resolved)) return true;
  }
  return !foundPackages || packagePatternCount === 0;
}

/** @param {string} workspaceText @param {(value: string) => boolean} forbidden */
function workspaceConfigReferences(workspaceText, forbidden) {
  let insidePackages = false;
  for (const line of workspaceText.split(/\r?\n/)) {
    const content = line.split("#", 1)[0]?.trim() ?? "";
    if (content.length === 0) continue;
    const isTopLevel = line.length === line.trimStart().length;
    if (isTopLevel) {
      insidePackages = content === "packages:";
      if (insidePackages || content.startsWith("packages:")) continue;
    } else if (insidePackages) {
      continue;
    }
    if (
      /[{}\[\]]/.test(content)
      || /(?:^|[\s:])(?:&|\*)[A-Za-z0-9_-]+/.test(content)
      || /:\s*[|>]\s*$/.test(content)
    ) {
      return true;
    }
    const listValue = content.startsWith("-") ? content.slice(1).trim() : content;
    const colon = listValue.indexOf(":");
    const values = colon < 0
      ? [listValue]
      : [listValue.slice(0, colon), listValue.slice(colon + 1)];
    if (values.some((value) => {
      const unquoted = value.trim().replace(/^["']|["'],?$/g, "");
      return unquoted.length > 0 && forbidden(unquoted);
    })) return true;
  }
  return false;
}

/** @param {ts.Node} node */
function moduleSpecifierForNode(node) {
  if (
    (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
    && node.moduleSpecifier !== undefined
    && ts.isStringLiteralLike(node.moduleSpecifier)
  ) {
    return node.moduleSpecifier.text;
  }
  if (
    ts.isImportEqualsDeclaration(node)
    && ts.isExternalModuleReference(node.moduleReference)
    && node.moduleReference.expression !== undefined
    && ts.isStringLiteralLike(node.moduleReference.expression)
  ) {
    return node.moduleReference.expression.text;
  }
  if (
    ts.isImportTypeNode(node)
    && ts.isLiteralTypeNode(node.argument)
    && ts.isStringLiteralLike(node.argument.literal)
  ) {
    return node.argument.literal.text;
  }
  if (!ts.isCallExpression(node) || node.arguments.length === 0) {
    return undefined;
  }
  const argument = node.arguments[0];
  if (argument === undefined || !ts.isStringLiteralLike(argument)) {
    return undefined;
  }
  if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
    return argument.text;
  }
  if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
    return argument.text;
  }
  if (
    ts.isPropertyAccessExpression(node.expression)
    && ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === "require"
    && node.expression.name.text === "resolve"
  ) {
    return argument.text;
  }
  if (
    ts.isPropertyAccessExpression(node.expression)
    && node.expression.name.text === "resolve"
    && ts.isPropertyAccessExpression(node.expression.expression)
    && ts.isIdentifier(node.expression.expression.expression)
    && node.expression.expression.expression.text === "module"
    && node.expression.expression.name.text === "require"
  ) {
    return argument.text;
  }
  if (
    ts.isPropertyAccessExpression(node.expression)
    && ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === "module"
    && node.expression.name.text === "require"
  ) {
    return argument.text;
  }
  return undefined;
}

/** @param {string} directory @param {string} sourceRoot */
function collectSources(directory, sourceRoot) {
  return collectFiles(directory, (file) => sourceExtensions.has(path.extname(file)))
    .map((file) => ({
      relativePath: normalized(path.relative(sourceRoot, file)),
      text: readFileSync(file, "utf8"),
    }));
}

/** @param {string} directory @param {(file: string) => boolean} include */
function collectFiles(directory, include) {
  /** @type {string[]} */
  const files = [];
  walk(directory);
  return files.sort();

  /** @param {string} current */
  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if ([".git", "node_modules"].includes(entry.name)) continue;
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
      } else if (entry.isFile() && include(absolutePath)) {
        files.push(absolutePath);
      }
    }
  }
}

/** @param {string} directory @param {string} sourceRoot */
function collectSymlinks(directory, sourceRoot) {
  /** @type {SymlinkInput[]} */
  const symlinks = [];
  walk(directory);
  return symlinks.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath)
  );

  /** @param {string} current */
  function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if ([".git", "node_modules"].includes(entry.name)) continue;
      const absolutePath = path.join(current, entry.name);
      if (entry.isSymbolicLink() || lstatSync(absolutePath).isSymbolicLink()) {
        symlinks.push({
          relativePath: normalized(path.relative(sourceRoot, absolutePath)),
          target: normalized(readlinkSync(absolutePath)),
        });
      } else if (entry.isDirectory()) {
        walk(absolutePath);
      }
    }
  }
}

/** @param {string} file */
function readJsonRecord(file) {
  /** @type {unknown} */
  const value = JSON.parse(readFileSync(file, "utf8"));
  if (!isRecord(value)) {
    throw new Error(`${file} must contain a JSON object.`);
  }
  return value;
}

/**
 * @param {unknown} value
 * @returns {value is Readonly<Record<string, unknown>>}
 */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {string} file */
function scriptKindForPath(file) {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (file.endsWith(".js") || file.endsWith(".mjs") || file.endsWith(".cjs")) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

/** @param {string} value */
function normalized(value) {
  return value.replaceAll("\\", "/");
}

function isCliEntrypoint() {
  return process.argv[1] !== undefined
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

/** @param {string} repoRoot */
export function verifyMedusaSourceIslandBoundary(repoRoot) {
  const rootPackage = readJsonRecord(path.join(repoRoot, "package.json"));
  const scripts = isRecord(rootPackage.scripts) ? rootPackage.scripts : {};
  const input = {
    currencyPromotion: verifyCurrencyPromotion(repoRoot),
    rootManifests: discoverRootManifests(repoRoot),
    rootSources: discoverRootSources(repoRoot),
    rootConfigs: discoverRootConfigs(repoRoot),
    rootSymlinks: discoverRootSymlinks(repoRoot),
    rootToolSources: discoverRootToolSources(repoRoot),
    islandManifests: discoverIslandManifests(repoRoot),
    islandSources: discoverIslandSources(repoRoot),
    islandConfigs: discoverIslandConfigs(repoRoot),
    islandSymlinks: discoverIslandSymlinks(repoRoot),
    islandWorkspaceText: readFileSync(
      path.join(repoRoot, "third_party", "medusa", "upstream", "pnpm-workspace.yaml"),
      "utf8",
    ),
    rootWorkspaceText: readFileSync(
      path.join(repoRoot, "pnpm-workspace.yaml"),
      "utf8",
    ),
    rootScripts: scripts,
  };
  const result = analyzeMedusaSourceIslandBoundary(input);
  if (result.errors.length > 0) {
    throw new Error(result.errors.join("\n"));
  }
  return input;
}

if (isCliEntrypoint()) {
  const repoRoot = process.cwd();
  const input = verifyMedusaSourceIslandBoundary(repoRoot);
  console.log(
    `Verified Medusa source-island boundary across ${input.rootManifests.length} Flarex manifests, ${input.rootSources.length} Flarex sources, ${input.rootConfigs.length} Flarex TypeScript configs, ${input.rootSymlinks.length} Flarex symlinks, ${input.rootToolSources.length} root tooling sources, ${input.islandManifests.length} Medusa manifests, ${input.islandSources.length} Medusa sources, ${input.islandConfigs.length} Medusa TypeScript configs, and ${input.islandSymlinks.length} Medusa symlinks.`,
  );
}
