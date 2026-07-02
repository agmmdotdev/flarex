import { Data, Effect } from "effect";
import { Miniflare } from "miniflare";
import type { ExecutionArtifactRef } from "flarex/artifacts";
import type { DeploymentAnalysis } from "./analyze.ts";
import { readDevResponseJsonOrNullEffect } from "./responseJson.ts";
import type { SourcePackage } from "./sourcePackage.ts";

export type { ExecutionArtifactRef } from "flarex/artifacts";

export type AnalyzerDiagnostic = {
  level: "log" | "warn" | "error";
  message: string;
};

export type ExecutionArtifactAnalysis = {
  analysis: DeploymentAnalysis;
  diagnostics: AnalyzerDiagnostic[];
};

export class ExecutionArtifactAnalysisError extends Error {
  readonly diagnostics: AnalyzerDiagnostic[];

  constructor(message: string, diagnostics: AnalyzerDiagnostic[] = []) {
    super(message);
    this.name = "ExecutionArtifactAnalysisError";
    this.diagnostics = diagnostics;
  }
}

type ExecutionArtifactHttpResponse = Pick<Response, "json" | "ok" | "status">;

type ExecutionArtifactResponseOperation = "analysis" | "invoke";

export class ExecutionArtifactResponseError extends Data.TaggedError("ExecutionArtifactResponseError")<{
  readonly operation: ExecutionArtifactResponseOperation;
  readonly status: number;
  readonly message: string;
  readonly diagnostics: AnalyzerDiagnostic[];
  readonly body: unknown;
}> {}

export interface ExecutionArtifactAdapter {
  analyze(sourcePackage: SourcePackage): Promise<DeploymentAnalysis>;
  analyzeWithDiagnostics?(sourcePackage: SourcePackage): Promise<ExecutionArtifactAnalysis>;
}

export type ExecutionArtifactInvokeRequest = {
  deploymentId: string;
  path: string;
  args: unknown;
  partitionKey?: string;
  idempotencyKey?: string;
};

export interface ExecutionArtifactRuntime {
  invoke(ref: ExecutionArtifactRef, request: ExecutionArtifactInvokeRequest): Promise<unknown>;
}

type ArtifactFetcher = {
  fetch(request: Request): Promise<Response>;
};

export class LocalMiniflareExecutionArtifactAdapter implements ExecutionArtifactAdapter {
  async analyze(sourcePackage: SourcePackage): Promise<DeploymentAnalysis> {
    return (await this.analyzeWithDiagnostics(sourcePackage)).analysis;
  }

  async analyzeWithDiagnostics(sourcePackage: SourcePackage): Promise<ExecutionArtifactAnalysis> {
    const artifact = new Miniflare({
      modules: [
        {
          type: "ESModule",
          path: "worker.js",
          contents: analysisWorkerSource(sourcePackage),
        },
        ...sourcePackage.modules.map(module => ({
          type: "ESModule" as const,
          path: module.path,
          contents: module.source,
        })),
      ],
      compatibilityDate: "2026-06-14",
    });
    try {
      const response = await artifact.dispatchFetch("http://flarex-artifact/analyze", {
        method: "POST",
      });
      // Deliberate runtime bridge: local artifact analysis API is Promise-based.
      const { body, diagnostics } = await Effect.runPromise(
        decodeExecutionArtifactAnalysisBody(response).pipe(
          Effect.mapError(executionArtifactResponseErrorToAnalysisError),
        ),
      );
      if (typeof body !== "object" || body === null || !("analysis" in body)) {
        throw new ExecutionArtifactAnalysisError("Execution artifact analysis returned an invalid response.", diagnostics);
      }
      return {
        analysis: (body as { analysis: DeploymentAnalysis }).analysis,
        diagnostics,
      };
    } finally {
      await artifact.dispose();
    }
  }
}

export class LocalMiniflareExecutionArtifactRuntime implements ExecutionArtifactRuntime {
  private readonly artifact: ArtifactFetcher;

  constructor(artifact: ArtifactFetcher) {
    this.artifact = artifact;
  }

  async invoke(ref: ExecutionArtifactRef, request: ExecutionArtifactInvokeRequest): Promise<unknown> {
    const response = await this.artifact.fetch(new Request("https://flarex-artifact.internal/__flarex_internal/invoke", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-flarex-artifact-id": ref.artifactId,
        "x-flarex-source-package-hash": ref.sourcePackageHash,
      },
      body: JSON.stringify(request),
    }));
    // Deliberate runtime bridge: local artifact invoke API is Promise-based.
    return Effect.runPromise(
      decodeExecutionArtifactInvokeBody(response).pipe(
        Effect.mapError(executionArtifactResponseErrorToError),
      ),
    );
  }
}

const decodeExecutionArtifactAnalysisBody = Effect.fn("ExecutionArtifact.decodeAnalysisBody")(
  function* (response: ExecutionArtifactHttpResponse) {
    const body = yield* readExecutionArtifactResponseJson(response);
    const diagnostics = diagnosticsFromBody(body);
    if (!response.ok) {
      return yield* Effect.fail(new ExecutionArtifactResponseError({
        operation: "analysis",
        status: response.status,
        message: errorMessageFromBody(body)
          ?? `Execution artifact analysis failed with status ${response.status}`,
        diagnostics,
        body,
      }));
    }
    return { body, diagnostics };
  },
);

const decodeExecutionArtifactInvokeBody = Effect.fn("ExecutionArtifact.decodeInvokeBody")(
  function* (response: ExecutionArtifactHttpResponse) {
    const body = yield* readExecutionArtifactResponseJson(response);
    if (!response.ok) {
      return yield* Effect.fail(new ExecutionArtifactResponseError({
        operation: "invoke",
        status: response.status,
        message: errorMessageFromBody(body)
          ?? `Execution artifact invoke failed with status ${response.status}`,
        diagnostics: [],
        body,
      }));
    }
    return body;
  },
);

function readExecutionArtifactResponseJson(
  response: ExecutionArtifactHttpResponse,
): Effect.Effect<unknown> {
  return readDevResponseJsonOrNullEffect(response);
}

function diagnosticsFromBody(body: unknown): AnalyzerDiagnostic[] {
  return normalizeAnalyzerDiagnostics(
    typeof body === "object" && body !== null && "diagnostics" in body
      ? (body as { diagnostics: unknown }).diagnostics
      : undefined,
  );
}

function errorMessageFromBody(body: unknown): string | undefined {
  return typeof body === "object" && body !== null && "error" in body
    ? String((body as { error: unknown }).error)
    : undefined;
}

function executionArtifactResponseErrorToAnalysisError(
  error: ExecutionArtifactResponseError,
): ExecutionArtifactAnalysisError {
  return new ExecutionArtifactAnalysisError(error.message, error.diagnostics);
}

function executionArtifactResponseErrorToError(error: ExecutionArtifactResponseError): Error {
  return new Error(error.message);
}

export function normalizeAnalyzerDiagnostics(value: unknown): AnalyzerDiagnostic[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-100).flatMap(diagnostic => {
    if (typeof diagnostic !== "object" || diagnostic === null || Array.isArray(diagnostic)) {
      return [];
    }
    const level = (diagnostic as Partial<AnalyzerDiagnostic>).level;
    const message = (diagnostic as Partial<AnalyzerDiagnostic>).message;
    if ((level !== "log" && level !== "warn" && level !== "error") || typeof message !== "string") {
      return [];
    }
    return [{ level, message }];
  });
}

function analysisWorkerSource(sourcePackage: SourcePackage): string {
  const executionImport = `./${sourcePackage.execution}`;
  const schemaImport = sourcePackage.schema === undefined ? null : `./${sourcePackage.schema}`;
  const sourceMaps = Object.fromEntries(
    sourcePackage.functions.flatMap(modulePath => {
      const module = sourcePackage.modules.find(candidate => candidate.path === modulePath);
      if (module?.sourceMap === undefined) return [];
      return [[module.path.replace(/\.js$/, ""), module.sourceMap]];
    }),
  );

  return `// Generated by flarex-dev for local execution-artifact analysis.
const executionImport = ${JSON.stringify(executionImport)};
const schemaImport = ${schemaImport === null ? "null" : JSON.stringify(schemaImport)};
const functionSourceMaps = ${JSON.stringify(sourceMaps)};

async function analyze() {
  const diagnostics = [];
  const restoreAnalysisPrelude = installAnalysisPrelude(diagnostics);
  try {
    const executionModule = await import(executionImport);
    const schemaModule = schemaImport === null
      ? { default: { tables: {} } }
      : await import(schemaImport);
    const schema = analyzeSchema(schemaModule.default);
    const functions = analyzeModuleExports(executionModule.default, sourcePositionResolver());
    validateFunctionPartitions(functions, schema);
    return {
      analysis: {
        functions,
        schema,
      },
      diagnostics,
    };
  } catch (error) {
    if (isRecord(error)) {
      error.diagnostics = diagnostics;
    }
    throw error;
  } finally {
    restoreAnalysisPrelude();
  }
}

function installAnalysisPrelude(diagnostics) {
  const restoreConsole = installConsoleCapture(diagnostics);
  const restoreGlobals = installImportPhaseGlobals(diagnostics);
  return () => {
    restoreGlobals();
    restoreConsole();
  };
}

function installConsoleCapture(diagnostics) {
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };
  const write = (level, args) => {
    diagnostics.push({ level, message: args.map(formatConsoleArg).join(" ") });
    if (diagnostics.length > 100) diagnostics.shift();
    const originalMethod = original[level];
    if (typeof originalMethod === "function") {
      originalMethod.apply(console, args);
    }
  };
  try {
    console.log = (...args) => write("log", args);
    console.warn = (...args) => write("warn", args);
    console.error = (...args) => write("error", args);
  } catch {
    return () => {};
  }
  return () => {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
  };
}

function installImportPhaseGlobals(diagnostics) {
  const restore = [];
  installDeterministicDate(restore);
  installDeterministicRandom(restore);
  installRejectedGlobal(restore, diagnostics, globalThis, "fetch", "fetch is not supported during Flarex analysis import.");
  installRejectedCrypto(restore, diagnostics);
  installRejectedPerformance(restore, diagnostics);
  return () => {
    for (let index = restore.length - 1; index >= 0; index--) {
      restore[index]();
    }
  };
}

function installDeterministicDate(restore) {
  const OriginalDate = Date;
  const fixedUnixTimeMs = 1700000000000;
  class FlarexAnalysisDate extends OriginalDate {
    constructor(...args) {
      if (args.length === 0) {
        super(fixedUnixTimeMs);
      } else {
        super(...args);
      }
    }
    static now() {
      return fixedUnixTimeMs;
    }
  }
  FlarexAnalysisDate.UTC = OriginalDate.UTC;
  FlarexAnalysisDate.parse = OriginalDate.parse;
  installValue(restore, globalThis, "Date", FlarexAnalysisDate);
}

function installDeterministicRandom(restore) {
  let seed = 0x5eed1234;
  installValue(restore, Math, "random", () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  });
}

function installRejectedCrypto(restore, diagnostics) {
  if (!isRecord(globalThis.crypto)) return;
  installRejectedGlobal(
    restore,
    diagnostics,
    globalThis.crypto,
    "randomUUID",
    "crypto.randomUUID is not supported during Flarex analysis import.",
  );
  installRejectedGlobal(
    restore,
    diagnostics,
    globalThis.crypto,
    "getRandomValues",
    "crypto.getRandomValues is not supported during Flarex analysis import.",
  );
}

function installRejectedPerformance(restore, diagnostics) {
  if (!isRecord(globalThis.performance)) return;
  installRejectedGlobal(
    restore,
    diagnostics,
    globalThis.performance,
    "now",
    "performance.now is not supported during Flarex analysis import.",
  );
}

function installRejectedGlobal(restore, diagnostics, target, key, message) {
  installValue(restore, target, key, () => {
    diagnostics.push({ level: "error", message });
    if (diagnostics.length > 100) diagnostics.shift();
    throw new Error(message);
  });
}

function installValue(restore, target, key, value) {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  try {
    Object.defineProperty(target, key, {
      configurable: true,
      writable: true,
      value,
    });
  } catch {
    return;
  }
  restore.push(() => {
    if (descriptor === undefined) {
      try {
        delete target[key];
      } catch {}
      return;
    }
    try {
      Object.defineProperty(target, key, descriptor);
    } catch {}
  });
}

function formatConsoleArg(value) {
  if (typeof value === "string") return value;
  try {
    const json = JSON.stringify(value);
    return json === undefined ? String(value) : json;
  } catch {
    return String(value);
  }
}

function errorDiagnostics(error) {
  return isRecord(error) && Array.isArray(error.diagnostics) ? error.diagnostics : [];
}

function analyzeSchema(value) {
  if (!isRecord(value) || !isRecord(value.tables)) {
    throw new Error("Schema default export must be a Flarex schema definition.");
  }
  const entries = Object.entries(value.tables)
    .filter((entry) => isRecord(entry[1]) && entry[1].kind === "table")
    .sort(([left], [right]) => left.localeCompare(right));
  const tableIds = new Map(entries.map(([name], index) => [name, index + 1]));
  let nextIndexId = 1;
  return {
    version: 1,
    tables: entries.map(([name, table]) => ({
      tableId: tableIds.get(name),
      name,
      validator: analyzeTableValidator(table.validator, name),
      placement: analyzePlacement(table.placement, name),
    })),
    indexes: entries.flatMap(([tableName, table]) =>
      analyzeIndexes(table.indexes, tableName).map((index) => ({
        indexId: nextIndexId++,
        tableId: tableIds.get(tableName),
        name: index.name,
        fields: index.fields,
      })),
    ),
  };
}

function analyzeTableValidator(value, tableName) {
  if (!isRecord(value) || value.isFlarexValidator !== true || !("json" in value)) {
    throw new Error(\`Schema table "\${tableName}" has an invalid document validator.\`);
  }
  const validator = assertValidatorJson(value.json, \`schema.tables.\${tableName}.validator\`);
  if (validator === null || validator.type !== "object") {
    throw new Error(\`Schema table "\${tableName}" document validator must be an object validator.\`);
  }
  return validator;
}

function analyzePlacement(value, tableName) {
  if (value === undefined) return { kind: "partitionBy", field: "_id" };
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw new Error(\`Schema table "\${tableName}" has an invalid placement.\`);
  }
  if (value.kind === "global") return { kind: "global" };
  if (value.kind === "partitionBy" && typeof value.field === "string") {
    return { kind: "partitionBy", field: value.field };
  }
  if (
    value.kind === "colocateWith" &&
    typeof value.table === "string" &&
    typeof value.field === "string"
  ) {
    return { kind: "colocateWith", table: value.table, field: value.field };
  }
  throw new Error(\`Schema table "\${tableName}" has an invalid placement.\`);
}

function analyzeIndexes(value, tableName) {
  if (!Array.isArray(value)) {
    throw new Error(\`Schema table "\${tableName}" has invalid indexes.\`);
  }
  return value.map((index, position) => {
    if (
      !isRecord(index) ||
      typeof index.name !== "string" ||
      !Array.isArray(index.fields) ||
      !index.fields.every((field) => typeof field === "string")
    ) {
      throw new Error(\`Schema table "\${tableName}" has an invalid index at position \${position}.\`);
    }
    return { name: index.name, fields: [...index.fields] };
  });
}

function analyzeModuleExports(analyzedExports, positionFor) {
  return Object.entries(analyzedExports)
    .map(([moduleName, exports]) => ({
      moduleName,
      functions: Object.entries(exports)
        .map(([exportName, value]) => analyzeExport(moduleName, exportName, value, positionFor))
        .filter((fn) => fn !== null)
        .sort((left, right) => left.exportName.localeCompare(right.exportName)),
    }))
    .sort((left, right) => left.moduleName.localeCompare(right.moduleName));
}

function analyzeExport(moduleName, exportName, value, positionFor) {
  if (!isRuntimeFunction(value)) return null;
  const kind = functionKind(value);
  if (kind === null) return null;
  const visibility = functionVisibility(value);
  if (visibility === null) return null;
  const identifier = \`\${moduleName}:\${exportName}\`;
  assertHandler(value, identifier);
  const position = positionFor(moduleName, exportName);
  return {
    moduleName,
    exportName,
    kind,
    visibility,
    args: parseArgsValidator(value, identifier),
    returns: parseValidatorExport(value, "exportReturns", identifier, null, true),
    partition: parsePartitionExport(value, identifier),
    ...(position === undefined ? {} : { position }),
  };
}

function validateFunctionPartitions(modules, schema) {
  const tables = new Map(schema.tables.map(table => [table.name, table]));
  for (const module of modules) {
    for (const fn of module.functions) {
      const partition = fn.partition;
      if (partition === undefined || partition === null) continue;
      const path = \`\${module.moduleName}:\${fn.exportName}\`;
      const table = tables.get(partition.table);
      if (table === undefined) {
        throw new Error(\`\${path}.partition: Unknown partition table \${partition.table}.\`);
      }
      if (table.placement.kind !== "partitionBy") {
        throw new Error(\`\${path}.partition: Table \${partition.table} is not partitioned.\`);
      }
      if (partition.type === "partitionRoot") {
        fn.partition = lowerRootPartition(fn, partition, table, path);
        continue;
      }
      if (partition.type === "partitionCreateRoot") {
        if (table.placement.field !== partition.partitionField) {
          throw new Error(
            \`\${path}.partition: create-root policy targets \${partition.partitionField}, but \${partition.table} is partitioned by \${table.placement.field}.\`,
          );
        }
        continue;
      }
      if (table.placement.field !== partition.partitionField) {
        throw new Error(
          \`\${path}.partition: Selector \${partition.selector} targets \${partition.partitionField}, but \${partition.table} is partitioned by \${table.placement.field}.\`,
        );
      }
      const expectedSelector = selectorNameForPartitionField(table.placement.field);
      if (partition.selector !== expectedSelector) {
        throw new Error(
          \`\${path}.partition: Expected selector \${expectedSelector} for \${partition.table} partition field \${JSON.stringify(table.placement.field)}.\`,
        );
      }
      if (!validatorHasRequiredField(fn.args, partition.argField)) {
        throw new Error(\`\${path}.partition: args.\${partition.argField} is not a required argument.\`);
      }
    }
  }
}

function lowerRootPartition(fn, partition, table, path) {
  if (table.placement.kind !== "partitionBy") {
    throw new Error(\`\${path}.partition: Table \${partition.table} is not partitioned.\`);
  }
  if (table.placement.field !== "_id" || partition.partitionField !== "_id") {
    throw new Error(
      \`\${path}.partition: model.\${partition.table} requires \${partition.table} to be partitioned by _id.\`,
    );
  }
  const idArgs = requiredIdArgsForTable(fn.args, partition.table);
  if (idArgs.length === 0) {
    if (fn.kind === "mutation" || fn.kind === "workflowMutation") {
      return {
        type: "partitionCreateRoot",
        table: partition.table,
        partitionField: "_id",
      };
    }
    throw new Error(
      \`\${path}.partition: model.\${partition.table} requires exactly one required v.id(\${JSON.stringify(partition.table)}) argument.\`,
    );
  }
  if (idArgs.length > 1) {
    throw new Error(
      \`\${path}.partition: model.\${partition.table} is ambiguous. Found multiple required \${partition.table} IDs: \${idArgs.join(", ")}.\`,
    );
  }
  const argField = idArgs[0];
  return {
    type: "partition",
    table: partition.table,
    selector: "byId",
    partitionField: "_id",
    argField,
  };
}

function sourcePositionResolver() {
  const positions = new Map();
  for (const [moduleName, rawSourceMap] of Object.entries(functionSourceMaps)) {
    let sourceMap;
    try {
      sourceMap = JSON.parse(rawSourceMap);
    } catch {
      continue;
    }
    const sourceIndex = findSourceIndex(sourceMap.sources ?? [], moduleName);
    if (sourceIndex === undefined) continue;
    const sourcePath = sourceMap.sources?.[sourceIndex];
    const source = sourceMap.sourcesContent?.[sourceIndex];
    if (sourcePath === undefined || source === undefined) continue;
    for (const [exportName, position] of exportedFunctionPositions(sourcePath, source)) {
      positions.set(\`\${moduleName}:\${exportName}\`, position);
    }
  }
  return (moduleName, exportName) => positions.get(\`\${moduleName}:\${exportName}\`);
}

function findSourceIndex(sources, moduleName) {
  const candidates = [
    \`\${moduleName}.ts\`,
    \`\${moduleName}.tsx\`,
    \`\${moduleName}.js\`,
    \`\${moduleName}.jsx\`,
    \`\${moduleName}.mts\`,
    \`\${moduleName}.cts\`,
  ];
  const index = sources.findIndex((source) => candidates.includes(source));
  return index === -1 ? undefined : index;
}

function exportedFunctionPositions(sourcePath, source) {
  const positions = [];
  source.split(/\\r?\\n/).forEach((line, index) => {
    const named = /\\bexport\\s+const\\s+([A-Za-z_$][\\w$]*)\\s*=/.exec(line);
    if (named !== null) {
      positions.push([
        named[1],
        { path: sourcePath, startLine: index + 1, startColumn: named.index + 1 },
      ]);
      return;
    }
    const defaultMatch = /\\bexport\\s+default\\b/.exec(line);
    if (defaultMatch !== null) {
      positions.push([
        "default",
        { path: sourcePath, startLine: index + 1, startColumn: defaultMatch.index + 1 },
      ]);
    }
  });
  return positions;
}

function isRuntimeFunction(value) {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function functionKind(value) {
  const kinds = [
    ["isQuery", "query"],
    ["isMutation", "mutation"],
    ["isWorkflowMutation", "workflowMutation"],
    ["isAction", "action"],
  ];
  const marked = kinds.filter(([marker]) => marker in value);
  return marked.length === 1 ? marked[0][1] : null;
}

function functionVisibility(value) {
  const publicFunction = "isPublic" in value;
  const internalFunction = "isInternal" in value;
  if (publicFunction === internalFunction) return null;
  return publicFunction ? "public" : "internal";
}

function assertHandler(value, identifier) {
  const handler = "_handler" in value ? value._handler : undefined;
  if (handler !== undefined) {
    if (typeof handler !== "function") {
      throw new Error(\`\${identifier}.handler is not a function.\`);
    }
    return;
  }
  if (typeof value !== "function") {
    throw new Error(\`\${identifier} is not a function.\`);
  }
}

function parseValidatorExport(value, exporterName, identifier, defaultValue, allowNull) {
  const exporter = exporterName in value ? value[exporterName] : undefined;
  if (exporter === undefined) return defaultValue;
  if (typeof exporter !== "function") {
    throw new Error(\`\${identifier}.\${exporterName} is not a function or \\\`undefined\\\`.\`);
  }
  const serialized = exporter.call(value);
  if (typeof serialized !== "string") {
    throw new Error(
      \`Invalid \${exporterName} return value: \${identifier}.\${exporterName}() didn't return a string.\`,
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new Error(
      \`Invalid JSON returned from \${identifier}.\${exporterName}(): \${errorMessage(error)}\`,
    );
  }
  if (parsed === null && allowNull) return null;
  let validator;
  try {
    validator = assertValidatorJson(parsed, \`\${identifier}.\${exporterName}()\`);
  } catch (error) {
    throw new Error(
      \`Invalid validator returned from \${identifier}.\${exporterName}(): \${errorMessage(error)}\`,
    );
  }
  if (validator === null) {
    throw new Error(\`Invalid validator returned from \${identifier}.\${exporterName}(): Validator is required.\`);
  }
  if (!allowNull && validator.type !== "object" && validator.type !== "any") {
    throw new Error(
      \`Invalid validator returned from \${identifier}.\${exporterName}(): \` +
        "Argument validator must be an object validator or v.any().",
    );
  }
  return validator;
}

function parseArgsValidator(value, identifier) {
  const validator = parseValidatorExport(value, "exportArgs", identifier, { type: "any" }, false);
  if (validator === null) {
    throw new Error(\`Invalid validator returned from \${identifier}.exportArgs(): Validator is required.\`);
  }
  return validator;
}

function parsePartitionExport(value, identifier) {
  const exporter = "exportPartition" in value ? value.exportPartition : undefined;
  if (exporter === undefined) return null;
  if (typeof exporter !== "function") {
    throw new Error(\`\${identifier}.exportPartition is not a function or \\\`undefined\\\`.\`);
  }

  const serialized = exporter.call(value);
  if (typeof serialized !== "string") {
    throw new Error(
      \`Invalid exportPartition return value: \${identifier}.exportPartition() didn't return a string.\`,
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new Error(
      \`Invalid JSON returned from \${identifier}.exportPartition(): \${errorMessage(error)}\`,
    );
  }
  return assertPartitionPolicy(parsed, \`\${identifier}.exportPartition()\`);
}

function assertPartitionPolicy(value, path) {
  if (value === null) return null;
  if (!isRecord(value)) throw new Error(\`\${path}: Invalid partition policy.\`);
  if (
    value.type === "partitionRoot" &&
    typeof value.table === "string" &&
    value.table.length > 0 &&
    typeof value.partitionField === "string" &&
    value.partitionField.length > 0
  ) {
    return {
      type: "partitionRoot",
      table: value.table,
      partitionField: value.partitionField,
    };
  }
  if (
    value.type === "partition" &&
    typeof value.table === "string" &&
    value.table.length > 0 &&
    typeof value.selector === "string" &&
    value.selector.length > 0 &&
    typeof value.partitionField === "string" &&
    value.partitionField.length > 0 &&
    typeof value.argField === "string" &&
    value.argField.length > 0
  ) {
    return {
      type: "partition",
      table: value.table,
      selector: value.selector,
      partitionField: value.partitionField,
      argField: value.argField,
    };
  }
  throw new Error(\`\${path}: Invalid partition policy.\`);
}

function selectorNameForPartitionField(field) {
  if (field === "_id") return "byId";
  const suffix = field
    .split(/[^A-Za-z0-9]+/)
    .filter(part => part.length > 0)
    .map(capitalize)
    .join("");
  return suffix.length === 0 ? "byPartition" : \`by\${suffix}\`;
}

function capitalize(value) {
  return value.length === 0 ? value : \`\${value[0].toUpperCase()}\${value.slice(1)}\`;
}

function validatorHasRequiredField(validator, field) {
  return (
    validator.type === "object" &&
    Object.prototype.hasOwnProperty.call(validator.value, field) &&
    validator.value[field]?.optional === false
  );
}

function requiredIdArgsForTable(validator, tableName) {
  if (validator.type !== "object") return [];
  return Object.entries(validator.value)
    .filter(([, field]) =>
      field.optional === false &&
      field.fieldType.type === "id" &&
      field.fieldType.tableName === tableName,
    )
    .map(([fieldName]) => fieldName)
    .sort();
}

function assertValidatorJson(value, path = "$validator") {
  if (value === null) return null;
  assertObject(value, "Expected validator object.", path);
  const type = value.type;
  if (typeof type !== "string") {
    throw new Error(\`\${path}.type: Validator type must be a string.\`);
  }
  switch (type) {
    case "null":
    case "number":
    case "bigint":
    case "boolean":
    case "string":
    case "bytes":
    case "any":
      return { type };
    case "id": {
      const tableName = value.tableName;
      if (typeof tableName !== "string" || tableName.length === 0) {
        throw new Error(\`\${path}.tableName: ID validator tableName must be a non-empty string.\`);
      }
      return { type, tableName };
    }
    case "literal": {
      const literal = value.value;
      if (
        typeof literal !== "string" &&
        typeof literal !== "number" &&
        typeof literal !== "boolean"
      ) {
        throw new Error(\`\${path}.value: Literal validator value must be string, number, or boolean.\`);
      }
      return { type, value: literal };
    }
    case "array":
      return { type, value: requiredValidator(value.value, \`\${path}.value\`) };
    case "object": {
      assertObject(value.value, "Object validator value must be an object.", \`\${path}.value\`);
      const fields = {};
      for (const [name, rawField] of Object.entries(value.value)) {
        assertObject(rawField, "Object validator field must be an object.", \`\${path}.value.\${name}\`);
        if (typeof rawField.optional !== "boolean") {
          throw new Error(
            \`\${path}.value.\${name}.optional: Object validator optional flag must be a boolean.\`,
          );
        }
        fields[name] = {
          fieldType: requiredValidator(rawField.fieldType, \`\${path}.value.\${name}.fieldType\`),
          optional: rawField.optional,
        };
      }
      return { type, value: fields };
    }
    case "record":
      return {
        type,
        keys: requiredValidator(value.keys, \`\${path}.keys\`),
        values: requiredValidator(value.values, \`\${path}.values\`),
      };
    case "union": {
      if (!Array.isArray(value.value)) {
        throw new Error(\`\${path}.value: Union validator value must be an array.\`);
      }
      return {
        type,
        value: value.value.map((member, index) =>
          requiredValidator(member, \`\${path}.value[\${index}]\`),
        ),
      };
    }
    default:
      throw new Error(\`\${path}.type: Unknown validator type \${type}.\`);
  }
}

function requiredValidator(value, path) {
  const validator = assertValidatorJson(value, path);
  if (validator === null) throw new Error(\`\${path}: Validator is required.\`);
  return validator;
}

function assertObject(value, message, path) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(\`\${path}: \${message}\`);
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== "/analyze" || request.method !== "POST") {
      return Response.json({ error: "Not found." }, { status: 404 });
    }
    try {
      return Response.json(await analyze());
    } catch (error) {
      return Response.json({ error: errorMessage(error), diagnostics: errorDiagnostics(error) }, { status: 400 });
    }
  },
};
`;
}
