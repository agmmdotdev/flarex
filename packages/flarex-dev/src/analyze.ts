import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Effect } from "effect";
import {
  analyzeExecutionModulesEffect,
  analyzeLoadedSourcePackageEffect,
  type AnalyzedFunction,
  type AnalyzedFunctionPartitionCreateRootPolicy,
  type AnalyzedFunctionPartitionPolicy,
  type AnalyzedFunctionPartitionRootPolicy,
  type AnalyzedModule,
  type AnalyzedSchema,
  type AnalyzedSourcePosition,
  type DeploymentAnalysis,
  type LoadedExecutionModules,
} from "@flarex/analysis";
import { build, type Plugin } from "vite";
import { sourceModule, type SourcePackage } from "./sourcePackage.ts";

export type {
  AnalyzedFunction,
  AnalyzedFunctionPartitionCreateRootPolicy,
  AnalyzedFunctionPartitionPolicy,
  AnalyzedFunctionPartitionRootPolicy,
  AnalyzedModule,
  AnalyzedSchema,
  AnalyzedSourcePosition,
  DeploymentAnalysis,
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
      if (id === "effect" || id.startsWith("effect/")) {
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
  return [...await Effect.runPromise(analyzeExecutionModulesEffect(
    bundled.default as LoadedExecutionModules,
  ))];
}

export async function analyzeSourcePackageLocally(
  package_: SourcePackage,
): Promise<DeploymentAnalysis> {
  const execution = sourceModule(package_, package_.execution);
  const executionModule = await import(
    `data:text/javascript;base64,${Buffer.from(execution.source, "utf8").toString("base64")}`
  );
  const schemaDefinition = await loadSchemaDefinition(package_);
  return await Effect.runPromise(analyzeLoadedSourcePackageEffect({
    executionModules: executionModule.default as LoadedExecutionModules,
    schemaDefinition,
    sourceMaps: sourceMapsByModuleName(package_),
    sourceMapFailure: "fail",
  }));
}

async function loadSchemaDefinition(package_: SourcePackage): Promise<unknown> {
  if (package_.schema === undefined) return undefined;
  const schemaModule = sourceModule(package_, package_.schema);
  const bundled = await import(
    `data:text/javascript;base64,${Buffer.from(schemaModule.source, "utf8").toString("base64")}`
  );
  return bundled.default as unknown;
}

function sourceMapsByModuleName(package_: SourcePackage): Record<string, string> {
  return Object.fromEntries(
    package_.functions.flatMap(modulePath => {
      const module = sourceModule(package_, modulePath);
      if (module.sourceMap === undefined) return [];
      return [[module.path.replace(/\.js$/, ""), module.sourceMap]];
    }),
  );
}
