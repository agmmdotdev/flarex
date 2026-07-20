import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stat } from "node:fs/promises";
import { compareUtf16Strings } from "@flarex/utils/strings";
import {
  decodeAuthConfigPromise,
  type AuthConfig,
} from "flarex-protocol/auth";
import { build, type Plugin } from "vite";
import type { FunctionModule } from "./analyze.ts";

export type SourceModule = {
  path: string;
  source: string;
  sourceMap?: string;
  environment: "isolate";
  sha256: string;
};

export type SourcePackage = {
  modules: SourceModule[];
  functions: string[];
  schema?: string;
  authConfig?: AuthConfig;
  authConfigModule?: string;
  execution: string;
};

export type BundleSourcePackageOptions = {
  appDir: string;
  functionModules: FunctionModule[];
};

export async function bundleSourcePackage(
  options: BundleSourcePackageOptions,
): Promise<SourcePackage> {
  const functions = await Promise.all(
    options.functionModules.map(module =>
      bundleEntry(module.absolutePath, `${module.moduleName}.js`, options.appDir),
    ),
  );
  const schemaPath = await findSchema(options.appDir);
  const schema = schemaPath
    ? await bundleEntry(schemaPath, "_flarex/schema.js", options.appDir)
    : undefined;
  const authConfigPath = await findAuthConfig(options.appDir);
  const authConfigModule = authConfigPath
    ? await bundleEntry(authConfigPath, "_flarex/auth.config.js", options.appDir)
    : undefined;
  const authConfig = authConfigModule === undefined
    ? undefined
    : await loadAuthConfig(authConfigModule);
  const execution = await bundleExecutionEntry(options.functionModules, options.appDir);
  const modules = [
    ...functions,
    ...(schema ? [schema] : []),
    ...(authConfigModule ? [authConfigModule] : []),
    execution,
  ]
    .sort((left, right) => compareUtf16Strings(left.path, right.path));
  return {
    modules,
    functions: functions.map(module => module.path).sort(compareUtf16Strings),
    ...(schema ? { schema: schema.path } : {}),
    ...(authConfig === undefined ? {} : { authConfig }),
    ...(authConfigModule === undefined ? {} : { authConfigModule: authConfigModule.path }),
    execution: execution.path,
  };
}

export function sourceModule(package_: SourcePackage, modulePath: string): SourceModule {
  const module = package_.modules.find(candidate => candidate.path === modulePath);
  if (!module) throw new Error(`Source package module not found: ${modulePath}`);
  return module;
}

async function bundleExecutionEntry(
  modules: FunctionModule[],
  appDir: string,
): Promise<SourceModule> {
  const entryId = "virtual:flarex-execution-entry";
  const resolvedEntryId = "\0flarex-execution-entry";
  const plugin: Plugin = {
    name: "flarex-execution-entry",
    resolveId(id) {
      if (id === entryId) return resolvedEntryId;
      return resolveFlarex(id);
    },
    load(id) {
      if (id !== resolvedEntryId) return undefined;
      const imports = modules
        .map(
          (module, index) =>
            `import * as module${index} from ${JSON.stringify(pathToFileURL(module.absolutePath).href)};`,
        )
        .join("\n");
      const entries = modules
        .map((module, index) => `${JSON.stringify(module.moduleName)}: module${index}`)
        .join(",\n");
      return `${imports}\nexport default {\n${entries}\n};\n`;
    },
  };
  return bundleWithVite(entryId, "_flarex/execution.js", appDir, [plugin]);
}

function bundleEntry(entry: string, outputPath: string, appDir: string): Promise<SourceModule> {
  const plugin: Plugin = {
    name: "flarex-source-package-resolution",
    resolveId: resolveFlarex,
  };
  return bundleWithVite(entry, outputPath, appDir, [plugin]);
}

async function bundleWithVite(
  entry: string,
  outputPath: string,
  appDir: string,
  plugins: Plugin[],
): Promise<SourceModule> {
  const output = await build({
    configFile: false,
    logLevel: "silent",
    root: appDir,
    plugins,
    build: {
      write: false,
      target: "es2022",
      sourcemap: "hidden",
      rolldownOptions: {
        input: entry,
        external: ["cloudflare:workers"],
        preserveEntrySignatures: "strict",
        output: {
          format: "es",
          entryFileNames: outputPath,
          codeSplitting: false,
        },
      },
    },
  });
  const outputs = (Array.isArray(output) ? output : [output]).flatMap(result =>
    "output" in result ? result.output : [],
  );
  const chunk = outputs.find(value => value.type === "chunk" && value.isEntry);
  if (!chunk || chunk.type !== "chunk") {
    throw new Error(`Source bundle was not emitted for ${outputPath}.`);
  }
  const map = outputs.find(
    value => value.type === "asset" && value.fileName === `${chunk.fileName}.map`,
  );
  const sourceMap = map?.type === "asset"
    ? normalizeSourceMap(String(map.source), appDir, outputPath)
    : undefined;
  return {
    path: outputPath,
    source: chunk.code,
    ...(sourceMap ? { sourceMap } : {}),
    environment: "isolate",
    sha256: sourceHash(chunk.code, sourceMap),
  };
}

function resolveFlarex(id: string): string | undefined {
  if (id === "flarex" || id.startsWith("flarex/")) {
    return fileURLToPath(import.meta.resolve(id));
  }
  return undefined;
}

function normalizeSourceMap(raw: string, appDir: string, outputPath: string): string {
  // Deliberate JSON bridge: source maps are normalized before being re-emitted.
  const map = JSON.parse(raw) as {
    sources?: string[];
    sourcesContent?: Array<string | null>;
    sourceRoot?: string;
    [key: string]: unknown;
  };
  delete map.sourceRoot;
  const sources = map.sources ?? [];
  if (map.sourcesContent !== undefined) {
    map.sourcesContent = sources.map((source, index) =>
      isSourceWithinApp(source, appDir, outputPath)
        ? map.sourcesContent?.[index] ?? null
        : null
    );
  }
  map.sources = sources.map(source => normalizeSourcePath(source, appDir));
  return JSON.stringify(map);
}

function isSourceWithinApp(source: string, appDir: string, outputPath: string): boolean {
  if (source.startsWith("\0") || source.startsWith("virtual:")) return false;
  const outputDirectory = path.resolve(appDir, "dist", path.dirname(outputPath));
  const sourcePath = path.resolve(outputDirectory, source);
  const relativeSourcePath = path.relative(path.resolve(appDir), sourcePath);
  return (
    relativeSourcePath === "" ||
    (
      relativeSourcePath !== ".." &&
      !relativeSourcePath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativeSourcePath)
    )
  );
}

function normalizeSourcePath(source: string, appDir: string): string {
  const normalized = source.replaceAll("\\", "/");
  const app = appDir.replaceAll("\\", "/");
  if (normalized.startsWith(`${app}/`)) return normalized.slice(app.length + 1);
  const flarexMarker = "/packages/flarex/";
  const flarexIndex = normalized.lastIndexOf(flarexMarker);
  if (flarexIndex >= 0) return `flarex/${normalized.slice(flarexIndex + flarexMarker.length)}`;
  if (normalized.startsWith("\0") || normalized.startsWith("virtual:")) return normalized;
  return path.posix.basename(normalized);
}

function sourceHash(source: string, sourceMap?: string): string {
  return createHash("sha256")
    .update(source)
    .update("\0")
    .update(sourceMap ?? "")
    .digest("hex");
}

async function findSchema(appDir: string): Promise<string | undefined> {
  for (const name of ["schema.ts", "schema.js"]) {
    const candidate = path.join(appDir, name);
    if (await stat(candidate).then(() => true, () => false)) return candidate;
  }
  return undefined;
}

async function findAuthConfig(appDir: string): Promise<string | undefined> {
  for (const name of ["auth.config.ts", "auth.config.js"]) {
    const candidate = path.join(appDir, name);
    if (await stat(candidate).then(() => true, () => false)) return candidate;
  }
  return undefined;
}

async function loadAuthConfig(module: SourceModule): Promise<AuthConfig> {
  const loaded = await import(
    /* @vite-ignore */
    `data:text/javascript;base64,${Buffer.from(module.source, "utf8").toString("base64")}`
  ) as { default?: unknown };
  return await decodeAuthConfigPromise(loaded.default);
}
