import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertValidatorJson } from "flarex/validator-json";
import type { ValidatorJSON } from "flarex/values";
import { build, type Plugin } from "vite";
import { sourceModule, type SourcePackage } from "./sourcePackage.ts";

export type AnalyzedSourcePosition = {
  path: string;
  startLine: number;
  startColumn: number;
};

export type AnalyzedFunction = {
  moduleName: string;
  exportName: string;
  kind: "query" | "mutation" | "workflowMutation" | "action";
  visibility: "public" | "internal";
  args: ValidatorJSON;
  returns: ValidatorJSON | null;
  route?: AnalyzedFunctionRoutePolicy | null;
  position?: AnalyzedSourcePosition;
};

export type AnalyzedFunctionRoutePolicy = { type: "args"; field: string };

export type AnalyzedModule = {
  moduleName: string;
  functions: AnalyzedFunction[];
};

export type AnalyzedSchema = {
  version: number;
  tables: Array<{
    tableId: number;
    name: string;
    validator: ValidatorJSON;
    placement:
      | { kind: "partitionBy"; field: string }
      | { kind: "colocateWith"; table: string; field: string }
      | { kind: "global" };
  }>;
  indexes: Array<{
    indexId: number;
    tableId: number;
    name: string;
    fields: string[];
  }>;
};

export type DeploymentAnalysis = {
  functions: AnalyzedModule[];
  schema: AnalyzedSchema;
};

export type FunctionModule = {
  moduleName: string;
  absolutePath: string;
};

const ENTRY_POINT_EXTENSIONS = new Set([".js", ".ts", ".tsx", ".mts", ".cts", ".jsx"]);

export async function listFunctionModules(functionsDir: string): Promise<FunctionModule[]> {
  const entries = await readdir(functionsDir, { recursive: true, withFileTypes: true }).catch(error => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  const modules: FunctionModule[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const absolutePath = path.join(entry.parentPath, entry.name);
    const relativePath = path.relative(functionsDir, absolutePath);
    if (relativePath.startsWith(`_deps${path.sep}`)) {
      throw new Error(
        `The path "${absolutePath}" is within the reserved "_deps" directory.`,
      );
    }
    if (!isFunctionEntryPoint(relativePath, entry.name)) continue;
    if (
      [".ts", ".tsx"].includes(path.extname(entry.name).toLowerCase()) &&
      !/^\s{0,100}(import|export)/m.test(await readFile(absolutePath, "utf8"))
    ) {
      continue;
    }
    modules.push({
      absolutePath,
      moduleName: relativePath.replaceAll("\\", "/").replace(/\.[^.]+$/, ""),
    });
  }
  return modules.sort((left, right) => left.moduleName.localeCompare(right.moduleName));
}

function isFunctionEntryPoint(relativePath: string, base: string): boolean {
  const extension = path.extname(base).toLowerCase();
  return (
    ENTRY_POINT_EXTENSIONS.has(extension) &&
    !relativePath.startsWith(`_generated${path.sep}`) &&
    !base.startsWith(".") &&
    !base.startsWith("#") &&
    base !== "schema.ts" &&
    base !== "schema.js" &&
    (base.match(/\./g) ?? []).length <= 1 &&
    !relativePath.includes(" ")
  );
}

export async function analyzeFunctionModules(modules: FunctionModule[]): Promise<AnalyzedModule[]> {
  if (modules.length === 0) return [];

  const entryId = "virtual:flarex-analyze-entry";
  const resolvedEntryId = "\0flarex-analyze-entry";
  const analysisPlugin: Plugin = {
    name: "flarex-module-analysis",
    resolveId(id) {
      if (id === entryId) return resolvedEntryId;
      if (id === "flarex" || id.startsWith("flarex/")) {
        return fileURLToPath(import.meta.resolve(id));
      }
      return undefined;
    },
    load(id) {
      if (id !== resolvedEntryId) return undefined;
      const imports = modules
        .map(
          (module, index) =>
            `import * as module${index} from ${JSON.stringify(
              pathToFileURL(module.absolutePath).href,
            )};`,
        )
        .join("\n");
      const moduleEntries = modules
        .map((module, index) => `${JSON.stringify(module.moduleName)}: module${index}`)
        .join(",\n");
      return `${imports}\nexport default {\n${moduleEntries}\n};\n`;
    },
  };

  const output = await build({
    configFile: false,
    logLevel: "silent",
    plugins: [analysisPlugin],
    build: {
      write: false,
      target: "es2022",
      rollupOptions: {
        input: entryId,
        external: ["cloudflare:workers"],
        preserveEntrySignatures: "strict",
        output: { format: "es", entryFileNames: "analysis.js" },
      },
    },
  });
  const chunks = (Array.isArray(output) ? output : [output]).flatMap(result =>
    "output" in result ? result.output : [],
  );
  const chunk = chunks.find(value => value.type === "chunk" && value.isEntry);
  if (!chunk || chunk.type !== "chunk") {
    throw new Error("Flarex module analysis bundle was not emitted.");
  }

  const bundled = await import(
    `data:text/javascript;base64,${Buffer.from(chunk.code, "utf8").toString("base64")}`
  );
  return analyzeModuleExports(bundled.default as Record<string, Record<string, unknown>>);
}

export async function analyzeSourcePackageLocally(
  package_: SourcePackage,
): Promise<DeploymentAnalysis> {
  const execution = sourceModule(package_, package_.execution);
  const bundled = await import(
    `data:text/javascript;base64,${Buffer.from(execution.source, "utf8").toString("base64")}`
  );
  return {
    functions: analyzeModuleExports(
      bundled.default as Record<string, Record<string, unknown>>,
      sourcePositionResolver(package_),
    ),
    schema: await analyzeSchema(package_),
  };
}

async function analyzeSchema(package_: SourcePackage): Promise<AnalyzedSchema> {
  if (package_.schema === undefined) return { version: 1, tables: [], indexes: [] };
  const schemaModule = sourceModule(package_, package_.schema);
  const bundled = await import(
    `data:text/javascript;base64,${Buffer.from(schemaModule.source, "utf8").toString("base64")}`
  );
  const schema = bundled.default as unknown;
  if (!isRecord(schema) || !isRecord(schema.tables)) {
    throw new Error("Schema default export must be a Flarex schema definition.");
  }

  const entries = Object.entries(schema.tables)
    .filter((entry): entry is [string, Record<string, unknown>] =>
      isRecord(entry[1]) && entry[1].kind === "table",
    )
    .sort(([left], [right]) => left.localeCompare(right));
  const tableIds = new Map(entries.map(([name], index) => [name, index + 1] as const));
  let nextIndexId = 1;
  return {
    version: 1,
    tables: entries.map(([name, table]) => ({
      tableId: tableIds.get(name)!,
      name,
      validator: analyzeTableValidator(table.validator, name),
      placement: analyzePlacement(table.placement, name),
    })),
    indexes: entries.flatMap(([tableName, table]) =>
      analyzeIndexes(table.indexes, tableName).map(index => ({
        indexId: nextIndexId++,
        tableId: tableIds.get(tableName)!,
        name: index.name,
        fields: index.fields,
      })),
    ),
  };
}

function analyzeTableValidator(value: unknown, tableName: string): ValidatorJSON {
  if (!isRecord(value) || value.isFlarexValidator !== true || !("json" in value)) {
    throw new Error(`Schema table "${tableName}" has an invalid document validator.`);
  }
  const validator = assertValidatorJson(value.json, `schema.tables.${tableName}.validator`);
  if (validator === null || validator.type !== "object") {
    throw new Error(`Schema table "${tableName}" document validator must be an object validator.`);
  }
  return validator;
}

function analyzePlacement(
  value: unknown,
  tableName: string,
): AnalyzedSchema["tables"][number]["placement"] {
  if (value === undefined) return { kind: "partitionBy", field: "_id" };
  if (!isRecord(value) || typeof value.kind !== "string") {
    throw new Error(`Schema table "${tableName}" has an invalid placement.`);
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
  throw new Error(`Schema table "${tableName}" has an invalid placement.`);
}

function analyzeIndexes(
  value: unknown,
  tableName: string,
): Array<{ name: string; fields: string[] }> {
  if (!Array.isArray(value)) {
    throw new Error(`Schema table "${tableName}" has invalid indexes.`);
  }
  return value.map((index, position) => {
    if (
      !isRecord(index) ||
      typeof index.name !== "string" ||
      !Array.isArray(index.fields) ||
      !index.fields.every(field => typeof field === "string")
    ) {
      throw new Error(`Schema table "${tableName}" has an invalid index at position ${position}.`);
    }
    return { name: index.name, fields: [...index.fields] };
  });
}

function analyzeModuleExports(
  analyzedExports: Record<string, Record<string, unknown>>,
  positionFor?: (moduleName: string, exportName: string) => AnalyzedSourcePosition | undefined,
): AnalyzedModule[] {
  return Object.entries(analyzedExports)
    .map(([moduleName, exports]) => ({
      moduleName,
      functions: Object.entries(exports)
        .map(([exportName, value]) => analyzeExport(moduleName, exportName, value, positionFor))
        .filter((fn): fn is AnalyzedFunction => fn !== null)
        .sort((left, right) => left.exportName.localeCompare(right.exportName)),
    }))
    .sort((left, right) => left.moduleName.localeCompare(right.moduleName));
}

type RuntimeFunction = Record<string, unknown> | ((...args: never[]) => unknown);

function analyzeExport(
  moduleName: string,
  exportName: string,
  value: unknown,
  positionFor?: (moduleName: string, exportName: string) => AnalyzedSourcePosition | undefined,
): AnalyzedFunction | null {
  if (!isRuntimeFunction(value)) return null;

  const kind = functionKind(value);
  if (kind === null) return null;
  const visibility = functionVisibility(value);
  if (visibility === null) return null;

  const identifier = `${moduleName}:${exportName}`;
  assertHandler(value, identifier);
  const position = positionFor?.(moduleName, exportName);
  return {
    moduleName,
    exportName,
    kind,
    visibility,
    args: parseArgsValidator(value, identifier),
    returns: parseValidatorExport(value, "exportReturns", identifier, null, true),
    route: parseRouteExport(value, identifier),
    ...(position === undefined ? {} : { position }),
  };
}

function sourcePositionResolver(
  package_: SourcePackage,
): (moduleName: string, exportName: string) => AnalyzedSourcePosition | undefined {
  const positions = new Map<string, AnalyzedSourcePosition>();
  for (const modulePath of package_.functions) {
    const module = sourceModule(package_, modulePath);
    if (module.sourceMap === undefined) continue;
    const moduleName = module.path.replace(/\.js$/, "");
    const sourceMap = JSON.parse(module.sourceMap) as {
      sources?: string[];
      sourcesContent?: string[];
    };
    const sourceIndex = findSourceIndex(sourceMap.sources ?? [], moduleName);
    if (sourceIndex === undefined) continue;
    const sourcePath = sourceMap.sources?.[sourceIndex];
    const source = sourceMap.sourcesContent?.[sourceIndex];
    if (sourcePath === undefined || source === undefined) continue;
    for (const [exportName, position] of exportedFunctionPositions(sourcePath, source)) {
      positions.set(`${moduleName}:${exportName}`, position);
    }
  }
  return (moduleName, exportName) => positions.get(`${moduleName}:${exportName}`);
}

function findSourceIndex(sources: string[], moduleName: string): number | undefined {
  const candidates = [
    `${moduleName}.ts`,
    `${moduleName}.tsx`,
    `${moduleName}.js`,
    `${moduleName}.jsx`,
    `${moduleName}.mts`,
    `${moduleName}.cts`,
  ];
  const index = sources.findIndex(source => candidates.includes(source));
  return index === -1 ? undefined : index;
}

function exportedFunctionPositions(
  sourcePath: string,
  source: string,
): Array<[string, AnalyzedSourcePosition]> {
  const positions: Array<[string, AnalyzedSourcePosition]> = [];
  const lines = source.split(/\r?\n/);
  lines.forEach((line, index) => {
    const named = /\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*=/.exec(line);
    if (named) {
      positions.push([
        named[1]!,
        { path: sourcePath, startLine: index + 1, startColumn: named.index + 1 },
      ]);
      return;
    }
    const defaultMatch = /\bexport\s+default\b/.exec(line);
    if (defaultMatch) {
      positions.push([
        "default",
        { path: sourcePath, startLine: index + 1, startColumn: defaultMatch.index + 1 },
      ]);
    }
  });
  return positions;
}

function isRuntimeFunction(value: unknown): value is RuntimeFunction {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function functionKind(value: RuntimeFunction): AnalyzedFunction["kind"] | null {
  const kinds = [
    ["isQuery", "query"],
    ["isMutation", "mutation"],
    ["isWorkflowMutation", "workflowMutation"],
    ["isAction", "action"],
  ] as const;
  const marked = kinds.filter(([marker]) => marker in value);
  return marked.length === 1 ? marked[0]![1] : null;
}

function functionVisibility(value: RuntimeFunction): AnalyzedFunction["visibility"] | null {
  const publicFunction = "isPublic" in value;
  const internalFunction = "isInternal" in value;
  if (publicFunction === internalFunction) return null;
  return publicFunction ? "public" : "internal";
}

function assertHandler(value: RuntimeFunction, identifier: string): void {
  const handler = "_handler" in value ? value._handler : undefined;
  if (handler !== undefined) {
    if (typeof handler !== "function") {
      throw new Error(`${identifier}.handler is not a function.`);
    }
    return;
  }
  if (typeof value !== "function") {
    throw new Error(`${identifier} is not a function.`);
  }
}

function parseValidatorExport(
  value: RuntimeFunction,
  exporterName: "exportArgs" | "exportReturns",
  identifier: string,
  defaultValue: ValidatorJSON | null,
  allowNull: boolean,
): ValidatorJSON | null {
  const candidate = value as Record<string, unknown>;
  const exporter = exporterName in candidate ? candidate[exporterName] : undefined;
  if (exporter === undefined) return defaultValue;
  if (typeof exporter !== "function") {
    throw new Error(`${identifier}.${exporterName} is not a function or \`undefined\`.`);
  }

  const serialized = exporter.call(value);
  if (typeof serialized !== "string") {
    throw new Error(
      `Invalid ${exporterName} return value: ${identifier}.${exporterName}() didn't return a string.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new Error(
      `Invalid JSON returned from ${identifier}.${exporterName}(): ${errorMessage(error)}`,
    );
  }

  if (parsed === null && allowNull) return null;
  let validator: ValidatorJSON | null;
  try {
    validator = assertValidatorJson(parsed, `${identifier}.${exporterName}()`);
  } catch (error) {
    throw new Error(
      `Invalid validator returned from ${identifier}.${exporterName}(): ${errorMessage(error)}`,
    );
  }
  if (validator === null) {
    throw new Error(`Invalid validator returned from ${identifier}.${exporterName}(): Validator is required.`);
  }
  if (!allowNull && validator.type !== "object" && validator.type !== "any") {
    throw new Error(
      `Invalid validator returned from ${identifier}.${exporterName}(): ` +
        "Argument validator must be an object validator or v.any().",
    );
  }
  return validator;
}

function parseArgsValidator(value: RuntimeFunction, identifier: string): ValidatorJSON {
  const validator = parseValidatorExport(value, "exportArgs", identifier, { type: "any" }, false);
  if (validator === null) {
    throw new Error(`Invalid validator returned from ${identifier}.exportArgs(): Validator is required.`);
  }
  return validator;
}

function parseRouteExport(value: RuntimeFunction, identifier: string): AnalyzedFunctionRoutePolicy | null {
  const candidate = value as Record<string, unknown>;
  const exporter = "exportRoute" in candidate ? candidate.exportRoute : undefined;
  if (exporter === undefined) return null;
  if (typeof exporter !== "function") {
    throw new Error(`${identifier}.exportRoute is not a function or \`undefined\`.`);
  }

  const serialized = exporter.call(value);
  if (typeof serialized !== "string") {
    throw new Error(
      `Invalid exportRoute return value: ${identifier}.exportRoute() didn't return a string.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (error) {
    throw new Error(
      `Invalid JSON returned from ${identifier}.exportRoute(): ${errorMessage(error)}`,
    );
  }
  return assertRoutePolicy(parsed, `${identifier}.exportRoute()`);
}

function assertRoutePolicy(value: unknown, path: string): AnalyzedFunctionRoutePolicy | null {
  if (value === null) return null;
  if (!isRecord(value)) throw new Error(`${path}: Invalid route policy.`);
  if (value.type === "args" && typeof value.field === "string" && value.field.length > 0) {
    return { type: "args", field: value.field };
  }
  throw new Error(`${path}: Invalid route policy.`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
