import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const ENTRY_PATH = path.join(
  PACKAGE_ROOT,
  "src",
  "artifactRuntime",
  "ApplicationWorkerCore.ts",
);
const GENERATED_PATH = path.join(
  PACKAGE_ROOT,
  "src",
  "artifactRuntime",
  "ApplicationWorkerCore.generated.ts",
);
const MAXIMUM_CORE_BYTES = 2 * 1_048_576;

interface CoreBuildReceipt {
  readonly source: string;
  readonly sha256: string;
  readonly sourceBytes: number;
  readonly serverExports: readonly string[];
  readonly valuesExports: readonly string[];
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  const mode = process.argv[2];
  if (mode !== "update" && mode !== "check") {
    throw new Error("Usage: buildApplicationWorkerCore.ts <update|check>");
  }
  const receipt = await buildTwice();
  const rendered = renderGenerated(receipt);
  if (mode === "update") {
    await writeFile(GENERATED_PATH, rendered, "utf8");
  } else if (await readFile(GENERATED_PATH, "utf8") !== rendered) {
    throw new Error("Generated Application Worker core is stale.");
  }
  console.log(
    `Verified Application Worker core ${receipt.sha256} ` +
      `(${receipt.sourceBytes} bytes) from two byte-identical builds.`,
  );
}

async function buildTwice(): Promise<CoreBuildReceipt> {
  const first = await buildOnce();
  const second = await buildOnce();
  if (first.source !== second.source || first.sha256 !== second.sha256) {
    throw new Error("Application Worker core builds are not stable.");
  }
  return first;
}

async function buildOnce(): Promise<CoreBuildReceipt> {
  const serverExports = await runtimeExportNames("flarex/server");
  const valuesExports = await runtimeExportNames("flarex/values");
  const output = await build({
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      target: "es2022",
      minify: "esbuild",
      sourcemap: false,
      lib: {
        entry: ENTRY_PATH,
        formats: ["es"],
        fileName: () => "application-worker-core.js",
      },
      rollupOptions: { treeshake: true },
    },
  });
  if (!Array.isArray(output) || output.length !== 1) {
    throw new Error("Application Worker core build returned an invalid result.");
  }
  const buildResult = output[0];
  if (buildResult === undefined || !Array.isArray(buildResult.output)) {
    throw new Error("Application Worker core build returned no output.");
  }
  if (buildResult.output.length !== 1 || buildResult.output[0]?.type !== "chunk") {
    throw new Error("Application Worker core must emit one JavaScript chunk.");
  }
  const chunk = buildResult.output[0];
  if (chunk === undefined || chunk.type !== "chunk") {
    throw new Error("Application Worker core chunk is missing.");
  }
  if (chunk.imports.length !== 0 || chunk.dynamicImports.length !== 0) {
    throw new Error("Application Worker core retained runtime imports.");
  }
  const missingFrameworkExports = Array.from(new Set([
    ...serverExports,
    ...valuesExports,
  ])).filter(name => !chunk.exports.includes(name));
  if (missingFrameworkExports.length !== 0) {
    throw new Error(
      "Application Worker core omitted framework exports: " +
        missingFrameworkExports.join(", "),
    );
  }
  for (const name of [
    "executeApplicationTransactionWorkerV1",
    "executeApplicationActionWorkerV1",
    "executeApplicationTaskWorkerV1",
  ]) {
    if (!chunk.exports.includes(name)) {
      throw new Error(`Application Worker core omitted ${name}.`);
    }
  }
  const source = chunk.code.replace(/\r\n?/g, "\n");
  const sourceBytes = Buffer.byteLength(source, "utf8");
  if (sourceBytes > MAXIMUM_CORE_BYTES) {
    throw new Error("Application Worker core exceeds its byte limit.");
  }
  return Object.freeze({
    source,
    sourceBytes,
    sha256: createHash("sha256")
      .update("flarex.application-worker-core.v1\0", "ascii")
      .update(source, "utf8")
      .update("\0", "ascii")
      .update(JSON.stringify({ serverExports, valuesExports }), "utf8")
      .digest("hex"),
    serverExports,
    valuesExports,
  });
}

async function runtimeExportNames(
  specifier: "flarex/server" | "flarex/values",
): Promise<readonly string[]> {
  const loaded: unknown = await import(specifier);
  if (typeof loaded !== "object" || loaded === null) {
    throw new Error(`${specifier} did not load as a module namespace.`);
  }
  const names = Object.keys(loaded).sort();
  if (
    names.length === 0 || names.some(name =>
      name === "default" || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)
    )
  ) throw new Error(`${specifier} exposes an unsupported export name.`);
  return Object.freeze(names);
}

function renderGenerated(receipt: CoreBuildReceipt): string {
  const lines = receipt.source.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  return [
    "// Generated by scripts/buildApplicationWorkerCore.ts. Do not edit.",
    "export const APPLICATION_WORKER_CORE_SOURCE = [",
    ...lines.map(line => `  ${JSON.stringify(line)},`),
    '].join("");',
    "",
    "export const APPLICATION_WORKER_CORE_SHA256 =",
    `  ${JSON.stringify(receipt.sha256)};`,
    "",
    "export const APPLICATION_WORKER_CORE_SOURCE_BYTES =",
    `  ${receipt.sourceBytes};`,
    "",
    "export const APPLICATION_WORKER_SERVER_EXPORTS = Object.freeze([",
    ...receipt.serverExports.map(name => `  ${JSON.stringify(name)},`),
    "] as const);",
    "",
    "export const APPLICATION_WORKER_VALUES_EXPORTS = Object.freeze([",
    ...receipt.valuesExports.map(name => `  ${JSON.stringify(name)},`),
    "] as const);",
    "",
  ].join("\n");
}
