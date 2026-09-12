// @ts-check
import { verifyTestPort } from "./check-medusa-test-port.mjs";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const manifestPath = "roadmaps/flarexdb-framework-integration/preflight/medusa-currency-promotion.json";
const sourcePrefix = "third_party/medusa/upstream/";
const revision = "48d5cc675e4e8bc821e22c20c88a751acc66fb5f";
const owners = new Map([
  ["packages/medusa-currency", "@medusajs/currency"],
  ["packages/medusa-product", "@medusajs/product"],
  ["packages/medusa-sales-channel", "@medusajs/sales-channel"],
  ["packages/medusa-link-modules", "@medusajs/link-modules"],
  ["packages/medusa-core-flows", "@medusajs/core-flows"],
  ["packages/medusa-workflows-sdk", "@medusajs/workflows-sdk"],
  ["packages/medusa-drizzle", "@medusajs/drizzle"],
  ["packages/medusa-types", "@medusajs/types"],
  ["packages/medusa-utils", "@medusajs/utils"],
  ["packages/medusa-framework", "@medusajs/framework"],
  ["packages/medusa-modules-sdk", "@medusajs/modules-sdk"],
  ["packages/medusa-deps", "@medusajs/deps"],
  ["packages/medusa-test-utils", "@medusajs/test-utils"],
  ["packages/medusa-adapter", "@flarex/medusa-adapter"],
]);

/** @typedef {{ target: string, targetSha256: string, source?: string, sourceSha256?: string, classification: string }} PromotionFile */
/** @typedef {{ path: string, name: string, dependencies: Record<string,string>, exports: string[] }} PromotionPackage */
/** @typedef {{ target: string, targetSha256: string, input: string }} BuildFile */
/** @typedef {{ importer: string, specifier: string, target: string, configuration: string }} TestAlias */
/** @typedef {{ files: PromotionFile[], buildFiles: BuildFile[], packages: PromotionPackage[], sourceCommit: string, testAliases: TestAlias[] }} Promotion */
/** @param {unknown} value @returns {value is Record<string, unknown>} */
const record = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
/** @param {unknown} value @returns {value is string} */
const string = (value) => typeof value === "string";
/** @param {unknown} value @returns {asserts value is Promotion} */
function assertPromotion(value) {
  if (!record(value) || value.sourceCommit !== revision || !Array.isArray(value.files) || !Array.isArray(value.packages)
    || !Array.isArray(value.buildFiles) || !value.buildFiles.every((file) => record(file) && string(file.target) && string(file.targetSha256) && string(file.input))
    || !Array.isArray(value.testAliases) || !value.testAliases.every((alias) => record(alias) && string(alias.importer) && string(alias.specifier) && string(alias.target) && string(alias.configuration))
    || !value.files.every((file) => record(file) && string(file.target) && string(file.targetSha256)
      && string(file.classification) && (file.source === undefined || string(file.source))
      && (file.sourceSha256 === undefined || string(file.sourceSha256)))
    || !value.packages.every((pkg) => record(pkg) && string(pkg.path) && string(pkg.name)
      && record(pkg.dependencies) && Object.values(pkg.dependencies).every(string)
      && Array.isArray(pkg.exports) && pkg.exports.every(string))) {
    throw new Error("Invalid Currency promotion manifest");
  }
}
/** @param {Uint8Array} bytes */
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
/** @param {string} relative */
function validPath(relative) {
  return !relative.includes("\\") && !path.posix.isAbsolute(relative) && !relative.includes(":")
    && relative.split("/").every((part) => part !== ".." && part !== "." && part !== "");
}
/** @param {string} root @param {string} relative */
function noSymlinks(root, relative) {
  let current = root;
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error(`Promotion symlink: ${relative}`);
  }
}
/** @param {string} root @param {string} relative @returns {string[]} */
function inventory(root, relative) {
  return readdirSync(path.join(root, relative), { withFileTypes: true }).flatMap((entry) => {
    if (["node_modules", "dist", ".vite"].includes(entry.name)) return [];
    const file = `${relative}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`Promotion symlink: ${file}`);
    return entry.isDirectory() ? inventory(root, file) : [file];
  });
}
/** @param {string} root @param {unknown} supplied @returns {Promotion} */
export function verifyCurrencyPromotion(root, supplied = JSON.parse(readFileSync(path.join(root, manifestPath), "utf8"))) {
  assertPromotion(supplied);
  const promotion = supplied;
  const sums = readFileSync(path.join(root, "third_party/medusa/SOURCE_SHA256SUMS"));
  if (sha256(sums) !== "d20d4f16843cd4844b2f1c4807a5787488e0f08bc068bba9641926984f183017") {
    throw new Error("Changed pinned Medusa source manifest");
  }
  if (promotion.packages.length !== owners.size || new Set(promotion.packages.map((pkg) => pkg.path)).size !== owners.size) {
    throw new Error("Currency promotion must enumerate exactly the approved private packages");
  }
  const files = new Set(promotion.files.map((file) => file.target));
  /** @type {Array<{importer: string, configuration: string, target?: string}>} */
  const expectedAliases = [
    ...["vitest.product-upstream.config.ts", "vitest.product-internal.config.ts"].map(configuration => ({ importer: "packages/medusa-product/integration-tests/__tests__/product.spec.ts", configuration: "packages/medusa-adapter/" + configuration })),
    ...["vitest.product-upstream.config.ts", "vitest.product-internal-categories.config.ts"].map(configuration => ({ importer: "packages/medusa-product/integration-tests/__tests__/product-category.spec.ts", configuration: "packages/medusa-adapter/" + configuration })),
    { importer: "packages/medusa-currency/integration-tests/__tests__/currency-module-service.spec.ts", configuration: "packages/medusa-adapter/vitest.config.ts" },
    { importer: "packages/medusa-sales-channel/integration-tests/__tests__/services/sales-channel-module.spec.ts", configuration: "packages/medusa-adapter/vitest.sales-channel-upstream.config.ts", target: "packages/medusa-adapter/test/support/sales-channel-runner.ts" },
    ...["events.spec.ts", "products.spec.ts", "product-types.spec.ts", "product-tags.spec.ts", "product-collections.spec.ts", "product-options.spec.ts", "product-variants.spec.ts", "product-categories.spec.ts"].map(name => ({ importer: "packages/medusa-product/integration-tests/__tests__/product-module-service/" + name, configuration: "packages/medusa-adapter/vitest.product-upstream.config.ts" })),
    { importer: "packages/medusa-product/integration-tests/__tests__/product-module-service/product-types.spec.ts", configuration: "packages/medusa-adapter/vitest.product-types.config.ts" },
    { importer: "packages/medusa-product/integration-tests/__tests__/product-module-service/product-tags.spec.ts", configuration: "packages/medusa-adapter/vitest.product-tags.config.ts" },
    { importer: "packages/medusa-product/integration-tests/__tests__/product-module-service/product-collections.spec.ts", configuration: "packages/medusa-adapter/vitest.product-collections.config.ts" },
    { importer: "packages/medusa-product/integration-tests/__tests__/product-module-service/product-options.spec.ts", configuration: "packages/medusa-adapter/vitest.product-options.config.ts" },
    { importer: "packages/medusa-product/integration-tests/__tests__/product-module-service/product-variants.spec.ts", configuration: "packages/medusa-adapter/vitest.product-variants.config.ts" },
    { importer: "packages/medusa-product/integration-tests/__tests__/product-module-service/product-categories.spec.ts", configuration: "packages/medusa-adapter/vitest.product-categories.config.ts" },
  ];
  if (promotion.testAliases.length !== expectedAliases.length || expectedAliases.some(expected =>
    promotion.testAliases.filter(alias => alias.importer === expected.importer
      && alias.configuration === expected.configuration && alias.specifier === "@medusajs/test-utils"
      && alias.target === (expected.target ?? "packages/medusa-adapter/test/support/runner.ts")
      && [alias.importer, alias.target, alias.configuration].every(file => files.has(file))).length !== 1)) {
    throw new Error("Unadmitted module test harness alias");
  }
  if (files.size !== promotion.files.length) throw new Error("Duplicate promotion target");
  const sourceHashes = new Map(readFileSync(path.join(root, "third_party/medusa/SOURCE_SHA256SUMS"), "utf8")
    .split(/\r?\n/).filter(Boolean).map((line) => ["third_party/medusa/" + line.slice(66), line.slice(0, 64)]));
  for (const file of promotion.files) {
    if (!["unchanged", "preserved", "unchangedTest", "importRelocation", "selectedExportFacade", "testHarnessPort", "testPort", "testFixturePort", "workflowFork", "linkFork", "authored"].includes(file.classification)) {
      throw new Error(`Unadmitted source transformation: ${file.target}`);
    }
    if (file.classification === "workflowFork" && !(file.target.startsWith("packages/medusa-workflows-sdk/src/") || file.target.startsWith("packages/medusa-core-flows/src/") || file.target === "packages/medusa-adapter/test/workflow-composer-upstream.test.ts")) {
      throw new Error("Workflow fork adaptation outside its approved source closure");
    }
    if (file.classification === "linkFork" && ![
      "packages/medusa-modules-sdk/src/link.ts",
      "packages/medusa-link-modules/src/utils/generate-entity.ts",
      "packages/medusa-link-modules/src/services/dynamic-service-class.ts",
      "packages/medusa-link-modules/src/definitions/product-sales-channel.ts",
    ].includes(file.target)) throw new Error("Link adaptation outside its approved finite source closure");
    const owned = [...owners.keys()].some((owner) => file.target.startsWith(owner + "/"))
      || file.target === "tools/medusa/tsconfig.fork.json";
    if (!validPath(file.target) || !owned) throw new Error(`Unadmitted promotion target: ${file.target}`);
    noSymlinks(root, file.target);
    if (sha256(readFileSync(path.join(root, file.target))) !== file.targetSha256) throw new Error(`Changed promotion target: ${file.target}`);
    if (file.source !== undefined) {
      if (!validPath(file.source) || !file.source.startsWith(sourcePrefix)
        || sourceHashes.get(file.source) !== file.sourceSha256) throw new Error(`Unpinned promotion source: ${file.source}`);
      noSymlinks(root, file.source);
      const hash = sha256(readFileSync(path.join(root, file.source)));
      if (hash !== file.sourceSha256) throw new Error(`Changed promotion source: ${file.source}`);
      if (file.classification === "testPort" || file.classification === "testFixturePort") {
        if (!file.target.endsWith(".ts") || !(file.classification === "testPort" ? file.target.includes("/__tests__/") : file.target.includes("/integration-tests/__fixtures__/"))) throw new Error("Invalid test-port target");
        verifyTestPort(readFileSync(path.join(root, file.source), "utf8"), readFileSync(path.join(root, file.target), "utf8"), {
          currencyTimeout: file.target === "packages/medusa-currency/integration-tests/__tests__/currency-module-service.spec.ts",
          salesChannelTimeout: file.target === "packages/medusa-sales-channel/integration-tests/__tests__/services/sales-channel-module.spec.ts",
          currencyStaticImports: file.target === "packages/medusa-currency/src/__tests__/static-manifest.spec.ts",
        });
      }
      if (["unchanged", "preserved", "unchangedTest"].includes(file.classification) && hash !== file.targetSha256) {
        throw new Error(`Preserved source changed: ${file.target}`);
      }
    } else if (file.classification !== "authored") throw new Error(`Missing source provenance: ${file.target}`);
  }
  for (const pkg of promotion.packages) {
    if (owners.get(pkg.path) !== pkg.name) throw new Error(`Unadmitted promotion package: ${pkg.path}`);
    const manifest = JSON.parse(readFileSync(path.join(root, pkg.path, "package.json"), "utf8"));
    if (manifest.name !== pkg.name || manifest.private !== true
      || (pkg.name.startsWith("@medusajs/") && manifest.version !== "2.13.4")) throw new Error(`Invalid private package: ${pkg.path}`);
    if (!record(manifest.exports) || JSON.stringify(Object.keys(manifest.exports).sort()) !== JSON.stringify([...pkg.exports].sort())) {
      throw new Error(`Changed promotion exports: ${pkg.path}`);
    }
    const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
    if (JSON.stringify(Object.entries(dependencies).sort()) !== JSON.stringify(Object.entries(pkg.dependencies).sort())) {
      throw new Error(`Changed promotion dependencies: ${pkg.path}`);
    }
    for (const [name, version] of Object.entries(pkg.dependencies)) {
      if (name.startsWith("@medusajs/") && (![...owners.values()].includes(name) || version !== "workspace:*")) {
        throw new Error(`Nonlocal Medusa dependency: ${pkg.path} -> ${name}`);
      }
    }
    for (const file of inventory(root, pkg.path)) if (!files.has(file)) throw new Error(`Unlisted promotion file: ${file}`);
    if (pkg.name.startsWith("@medusajs/") && !files.has(`${pkg.path}/LICENSE`)) throw new Error(`Missing MIT notice: ${pkg.path}`);
  }
  const buildFiles = new Set(promotion.buildFiles.map((file) => file.target));
  if (buildFiles.size !== promotion.buildFiles.length) throw new Error("Duplicate build target");
  for (const file of promotion.buildFiles) {
    const expectedInput = file.target.replace("/dist/", "/src/").replace(/(?:\.d\.ts|\.js)(?:\.map)?$/, ".ts");
    if (!validPath(file.target) || !file.target.includes("/dist/") || !files.has(file.input) || file.input !== expectedInput) {
      throw new Error(`Unadmitted build target: ${file.target}`);
    }
    noSymlinks(root, file.target);
    if (existsSync(path.join(root, file.target)) && sha256(readFileSync(path.join(root, file.target))) !== file.targetSha256) {
      throw new Error(`Changed build target: ${file.target}; rebuild the approved packages`);
    }
  }
  for (const pkg of promotion.packages) {
    const output = `${pkg.path}/dist`;
    if (existsSync(path.join(root, output))) for (const file of inventory(root, output)) {
      if (!buildFiles.has(file)) throw new Error(`Unlisted build output: ${file}`);
    }
  }
  return promotion;
}

/** @param {Promotion | undefined} promotion @param {string} file @param {string} specifier */
export function admitsCurrencyImport(promotion, file, specifier) {
  if (!promotion || ![...promotion.files, ...promotion.buildFiles].some((entry) => entry.target === file)) return false;
  if (promotion.testAliases.some((alias) => alias.importer === file && alias.specifier === specifier)) return true;
  // Exact verified wrappers register complete pinned files in their fixture.
  // This is not a runtime export or a general cross-package edge.
  const internalProductTarget = "packages/medusa-product/integration-tests/__tests__/product.spec.ts";
  const internalProductConfig = file === "packages/medusa-adapter/test/product-upstream.test.ts" ? "vitest.product-upstream.config.ts"
    : file === "packages/medusa-adapter/test/product-internal-upstream.test.ts" ? "vitest.product-internal.config.ts" : undefined;
  if (internalProductConfig !== undefined && specifier === "../../medusa-product/integration-tests/__tests__/product.spec"
    && promotion.files.some(entry => entry.target === internalProductTarget && ["unchangedTest", "testPort"].includes(entry.classification))
    && promotion.testAliases.some(alias => alias.importer === internalProductTarget && alias.configuration === "packages/medusa-adapter/" + internalProductConfig)) return true;
  const internalCategoryTarget = "packages/medusa-product/integration-tests/__tests__/product-category.spec.ts";
  const internalCategoryConfig = file === "packages/medusa-adapter/test/product-upstream.test.ts" ? "vitest.product-upstream.config.ts"
    : file === "packages/medusa-adapter/test/product-internal-categories-upstream.test.ts" ? "vitest.product-internal-categories.config.ts" : undefined;
  if (internalCategoryConfig !== undefined && specifier === "../../medusa-product/integration-tests/__tests__/product-category.spec"
    && promotion.files.some(entry => entry.target === internalCategoryTarget && ["unchangedTest", "testPort"].includes(entry.classification))
    && promotion.testAliases.some(alias => alias.importer === internalCategoryTarget && alias.configuration === "packages/medusa-adapter/" + internalCategoryConfig)) return true;
  const wrapper = file === "packages/medusa-adapter/test/product-upstream.test.ts"
    ? { names: ["events", "products", "product-types", "product-tags", "product-collections", "product-options", "product-variants", "product-categories"], configuration: "vitest.product-upstream.config.ts" }
    : file === "packages/medusa-adapter/test/product-types-upstream.test.ts"
      ? { names: ["product-types"], configuration: "vitest.product-types.config.ts" }
      : file === "packages/medusa-adapter/test/product-tags-upstream.test.ts"
        ? { names: ["product-tags"], configuration: "vitest.product-tags.config.ts" }
        : file === "packages/medusa-adapter/test/product-collections-upstream.test.ts"
          ? { names: ["product-collections"], configuration: "vitest.product-collections.config.ts" }
          : file === "packages/medusa-adapter/test/product-options-upstream.test.ts"
            ? { names: ["product-options"], configuration: "vitest.product-options.config.ts" }
            : file === "packages/medusa-adapter/test/product-variants-upstream.test.ts"
              ? { names: ["product-variants"], configuration: "vitest.product-variants.config.ts" }
              : file === "packages/medusa-adapter/test/product-categories-upstream.test.ts"
                ? { names: ["product-categories"], configuration: "vitest.product-categories.config.ts" } : undefined;
  if (wrapper !== undefined) {
    for (const name of wrapper.names) {
      const target = `packages/medusa-product/integration-tests/__tests__/product-module-service/${name}.spec.ts`;
      if (specifier === `../../medusa-product/integration-tests/__tests__/product-module-service/${name}.spec`
        && promotion.files.some((entry) => entry.target === target && ["unchangedTest", "testPort"].includes(entry.classification))
        && promotion.testAliases.some((alias) => alias.importer === target
          && alias.configuration === "packages/medusa-adapter/" + wrapper.configuration)) return true;
    }
  }
  const importer = promotion.packages.find((pkg) => file.startsWith(pkg.path + "/"));
  const target = promotion.packages.find((pkg) => specifier === pkg.name || specifier.startsWith(pkg.name + "/"));
  if (!importer || !target || (target !== importer && importer.dependencies[target.name] !== "workspace:*")) return false;
  return target.exports.includes(specifier === target.name ? "." : "." + specifier.slice(target.name.length));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = verifyCurrencyPromotion(process.cwd());
  console.log(`Verified ${result.files.length} Currency promotion files across ${result.packages.length} private packages.`);
}
