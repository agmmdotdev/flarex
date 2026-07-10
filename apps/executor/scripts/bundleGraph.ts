interface BundleImport {
  readonly path: string;
  readonly original?: string;
}

interface BundleInput {
  readonly path: string;
  readonly imports: readonly BundleImport[];
}

interface BundleOutput {
  readonly path: string;
  readonly entryPoint?: string;
}

interface BundleGraph {
  readonly inputs: readonly BundleInput[];
  readonly outputs: readonly BundleOutput[];
}

export interface ExecutorBundleVerificationResult {
  readonly inputCount: number;
  readonly outputCount: number;
}

const requiredInputs = [
  "src/worker.ts",
  "packages/executor/src/index.ts",
  "packages/executor-http/src/routes.ts",
  "packages/persistence-postgres/src/postgresClient.ts",
] as const;

const bannedFragments = [
  "@electric-sql/pglite",
  "@electric-sql+pglite",
  "drizzle-orm/pglite",
  "node-postgres/migrator",
  "pglite/migrator",
  "packages/persistence-postgres/drizzle/",
  "packages/persistence-postgres/drizzle.config.ts",
] as const;

const bannedSourceSuffixes = [
  "packages/persistence-postgres/src/pglite.ts",
  "packages/persistence-postgres/src/postgres.ts",
] as const;

export function verifyExecutorBundleMeta(
  value: unknown,
): ExecutorBundleVerificationResult {
  const graph = decodeBundleGraph(value);
  const inputPaths = graph.inputs.map((input) => input.path);
  const graphPaths = graph.inputs.flatMap((input) => [
    input.path,
    ...input.imports.flatMap((imported) => [
      imported.path,
      ...(imported.original === undefined ? [] : [imported.original]),
    ]),
  ]);

  const missingInputs = requiredInputs.filter(
    (required) => !inputPaths.some((path) => matchesRequiredInput(path, required)),
  );
  if (missingInputs.length > 0) {
    throw new Error(
      `Executor bundle is missing required runtime inputs: ${missingInputs.join(", ")}`,
    );
  }
  if (!inputPaths.some(isNodePostgresInput)) {
    throw new Error("Executor bundle does not contain the node-postgres client.");
  }

  const violations = graphPaths.filter(isBannedGraphPath);
  for (const input of graph.inputs) {
    if (!input.path.includes("packages/persistence-postgres/")) continue;
    for (const imported of input.imports) {
      const specifiers = [
        imported.path,
        ...(imported.original === undefined ? [] : [imported.original]),
      ];
      for (const specifier of specifiers) {
        if (isFilesystemBuiltin(specifier)) {
          violations.push(`${input.path} -> ${specifier}`);
        }
      }
    }
  }
  if (violations.length > 0) {
    throw new Error(
      `Executor bundle contains prohibited persistence inputs:\n${[...new Set(violations)].join("\n")}`,
    );
  }
  if (!graph.outputs.some(isWorkerBundleOutput)) {
    throw new Error(
      "Executor dry-run did not emit a JavaScript bundle from src/worker.ts.",
    );
  }

  return {
    inputCount: graph.inputs.length,
    outputCount: graph.outputs.length,
  } satisfies ExecutorBundleVerificationResult;
}

function decodeBundleGraph(value: unknown): BundleGraph {
  const root = requireRecord(value, "Wrangler metafile");
  const inputsRecord = requireRecord(root.inputs, "Wrangler metafile inputs");
  const outputsRecord = requireRecord(root.outputs, "Wrangler metafile outputs");
  const inputs = Object.entries(inputsRecord).map(([path, input]) => ({
    path: normalizePath(path),
    imports: decodeImports(input, path),
  }));
  return {
    inputs,
    outputs: Object.entries(outputsRecord).map(([path, output]) => ({
      path: normalizePath(path),
      ...decodeEntryPoint(output, path),
    })),
  } satisfies BundleGraph;
}

function decodeImports(
  value: unknown,
  inputPath: string,
): readonly BundleImport[] {
  const input = requireRecord(value, `Wrangler input ${inputPath}`);
  if (!Array.isArray(input.imports)) {
    throw new Error(`Wrangler input ${inputPath} imports must be an array.`);
  }
  return input.imports.map((entry, index) =>
    decodeImport(entry, `${inputPath} import ${index}`),
  );
}

function decodeImport(value: unknown, description: string): BundleImport {
  const imported = requireRecord(value, description);
  if (typeof imported.path !== "string") {
    throw new Error(`${description} path must be a string.`);
  }
  if (imported.original !== undefined && typeof imported.original !== "string") {
    throw new Error(`${description} original must be a string when present.`);
  }
  return {
    path: normalizePath(imported.path),
    ...(imported.original === undefined
      ? {}
      : { original: normalizePath(imported.original) }),
  } satisfies BundleImport;
}

function decodeEntryPoint(
  value: unknown,
  outputPath: string,
): Pick<BundleOutput, "entryPoint"> {
  const output = requireRecord(value, `Wrangler output ${outputPath}`);
  if (output.entryPoint === undefined) return {};
  if (typeof output.entryPoint !== "string") {
    throw new Error(`Wrangler output ${outputPath} entryPoint must be a string.`);
  }
  return { entryPoint: normalizePath(output.entryPoint) };
}

function requireRecord(
  value: unknown,
  description: string,
): Record<string, unknown> {
  if (isRecord(value)) return value;
  throw new Error(`${description} must be an object.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function isNodePostgresInput(path: string): boolean {
  return path.includes("/node_modules/pg/") || path.endsWith("node_modules/pg");
}

function matchesRequiredInput(path: string, required: string): boolean {
  return required === "src/worker.ts"
    ? path === required
    : path.endsWith(required);
}

function isWorkerBundleOutput(output: BundleOutput): boolean {
  return output.path.endsWith(".js") && output.entryPoint === "src/worker.ts";
}

function isBannedGraphPath(path: string): boolean {
  return (
    bannedFragments.some((fragment) => path.includes(fragment)) ||
    bannedSourceSuffixes.some((suffix) => path.endsWith(suffix))
  );
}

function isFilesystemBuiltin(specifier: string): boolean {
  const withoutWrapper = specifier.startsWith("node-built-in-modules:")
    ? specifier.slice("node-built-in-modules:".length)
    : specifier.startsWith("node:")
      ? specifier.slice("node:".length)
      : specifier;
  const root = withoutWrapper.split("/", 1)[0];
  return root === "fs" || root === "path" || root === "url";
}
