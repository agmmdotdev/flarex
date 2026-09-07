// @ts-check
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
  const expectedAliases = [
    { importer: "packages/medusa-currency/integration-tests/__tests__/currency-module-service.spec.ts", configuration: "packages/medusa-adapter/vitest.config.ts" },
    ...["events.spec.ts", "products.spec.ts"].map(name => ({ importer: "packages/medusa-product/integration-tests/__tests__/product-module-service/" + name, configuration: "packages/medusa-adapter/vitest.product-upstream.config.ts" })),
  ];
  if (promotion.testAliases.length !== expectedAliases.length || expectedAliases.some(expected =>
    promotion.testAliases.filter(alias => alias.importer === expected.importer
      && alias.configuration === expected.configuration && alias.specifier === "@medusajs/test-utils"
      && alias.target === "packages/medusa-adapter/test/support/runner.ts"
      && [alias.importer, alias.target, alias.configuration].every(file => files.has(file))).length !== 1)) {
    throw new Error("Unadmitted module test harness alias");
  }
  if (files.size !== promotion.files.length) throw new Error("Duplicate promotion target");
  const sourceHashes = new Map(readFileSync(path.join(root, "third_party/medusa/SOURCE_SHA256SUMS"), "utf8")
    .split(/\r?\n/).filter(Boolean).map((line) => ["third_party/medusa/" + line.slice(66), line.slice(0, 64)]));
  for (const file of promotion.files) {
    if (!["unchanged", "preserved", "unchangedTest", "importRelocation", "selectedExportFacade", "testHarnessPort", "authored"].includes(file.classification)) {
      throw new Error(`Unadmitted source transformation: ${file.target}`);
    }
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
  const importer = promotion.packages.find((pkg) => file.startsWith(pkg.path + "/"));
  const target = promotion.packages.find((pkg) => specifier === pkg.name || specifier.startsWith(pkg.name + "/"));
  if (!importer || !target || (target !== importer && importer.dependencies[target.name] !== "workspace:*")) return false;
  return target.exports.includes(specifier === target.name ? "." : "." + specifier.slice(target.name.length));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = verifyCurrencyPromotion(process.cwd());
  console.log(`Verified ${result.files.length} Currency promotion files across ${result.packages.length} private packages.`);
}
