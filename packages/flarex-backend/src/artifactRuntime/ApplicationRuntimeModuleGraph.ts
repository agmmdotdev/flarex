import {
  APPLICATION_ANALYSIS_FRAMEWORK_MODULE_PATHS,
  findApplicationAnalysisFrameworkShimCollision,
} from "@flarex/analysis/internal/application-analysis-module-path-policy";

import type {
  ApplicationAnalysisSourceBundle,
} from "../sourceArtifactV2/ApplicationAnalysisReader";

const APPLICATION_MODULE_PREFIX = "__flarex_application_modules" as const;
const LEGACY_TASK_MODULE_PREFIX = "__flarex_legacy_task_modules" as const;

export interface ApplicationRuntimeModuleGraph {
  readonly mainModule: string;
  readonly coreModule: string;
  readonly executionModule: string;
  readonly modules: Readonly<Record<string, WorkerLoaderModule | string>>;
}

interface RuntimeModuleGraphSource {
  readonly identitySha256Hex: string;
  readonly trustedStem: string;
  readonly executionModulePath: string;
  readonly modulePrefix: string;
  readonly modules: ReadonlyArray<Readonly<{
    readonly path: string;
    readonly source: string;
  }>>;
}

export function makeApplicationRuntimeModuleGraph(input: {
  readonly source: ApplicationAnalysisSourceBundle;
  readonly coreSource: string;
  readonly executionModulePath?: string;
  readonly serverExports: ReadonlyArray<string>;
  readonly valuesExports: ReadonlyArray<string>;
  readonly entrypointSource: (imports: Readonly<{
    readonly core: string;
    readonly execution: string;
  }>) => string;
}): ApplicationRuntimeModuleGraph {
  return makeRuntimeModuleGraph({
    source: {
      identitySha256Hex: input.source.sourceArtifact.rootSha256,
      trustedStem: "__flarex_application_runtime",
      executionModulePath:
        input.executionModulePath ?? input.source.sourceArtifact.executionModulePath,
      modulePrefix: APPLICATION_MODULE_PREFIX,
      modules: input.source.modules,
    },
    coreSource: input.coreSource,
    serverExports: input.serverExports,
    valuesExports: input.valuesExports,
    entrypointSource: input.entrypointSource,
  });
}

/**
 * Builds the private Legacy task graph from already authenticated canonical
 * runtime-projection modules. This deliberately accepts no Application source
 * artifact or Application runtime target.
 */
export function makeLegacyTaskRuntimeModuleGraph(input: {
  readonly projectionSha256Hex: string;
  readonly executionModulePath: string;
  readonly modules: ReadonlyArray<Readonly<{
    readonly path: string;
    readonly source: string;
  }>>;
  readonly coreSource: string;
  readonly serverExports: ReadonlyArray<string>;
  readonly valuesExports: ReadonlyArray<string>;
  readonly entrypointSource: (imports: Readonly<{
    readonly core: string;
    readonly execution: string;
  }>) => string;
}): ApplicationRuntimeModuleGraph {
  return makeRuntimeModuleGraph({
    source: {
      identitySha256Hex: input.projectionSha256Hex,
      trustedStem: "__flarex_legacy_task_runtime",
      executionModulePath: input.executionModulePath,
      modulePrefix: LEGACY_TASK_MODULE_PREFIX,
      modules: input.modules,
    },
    coreSource: input.coreSource,
    serverExports: input.serverExports,
    valuesExports: input.valuesExports,
    entrypointSource: input.entrypointSource,
  });
}

function makeRuntimeModuleGraph(input: {
  readonly source: RuntimeModuleGraphSource;
  readonly coreSource: string;
  readonly serverExports: ReadonlyArray<string>;
  readonly valuesExports: ReadonlyArray<string>;
  readonly entrypointSource: (imports: Readonly<{
    readonly core: string;
    readonly execution: string;
  }>) => string;
}): ApplicationRuntimeModuleGraph {
  const collision = findApplicationAnalysisFrameworkShimCollision(
    input.source.modules.map(module => module.path),
  );
  if (collision !== undefined) {
    throw new Error(`Application runtime source collides at ${collision}.`);
  }
  const trusted = trustedModuleNames(
    input.source.trustedStem,
    input.source.identitySha256Hex,
  );
  const executionModule = runtimeModuleName(
    input.source.modulePrefix,
    input.source.executionModulePath,
  );
  const modules: Record<string, WorkerLoaderModule | string> = Object.create(null);
  modules[trusted.entrypoint] = Object.freeze({
    js: input.entrypointSource(Object.freeze({
      core: relativeImport(trusted.core),
      execution: relativeImport(executionModule),
    })),
  });
  modules[trusted.core] = Object.freeze({ js: input.coreSource });
  for (const module of input.source.modules) {
    const name = runtimeModuleName(input.source.modulePrefix, module.path);
    if (Object.hasOwn(modules, name)) {
      throw new Error(`Duplicate application runtime module ${module.path}.`);
    }
    modules[name] = Object.freeze({ js: module.source });
  }
  const supportedFrameworkModules = Object.freeze({
    [APPLICATION_ANALYSIS_FRAMEWORK_MODULE_PATHS[0]]: input.serverExports,
    [APPLICATION_ANALYSIS_FRAMEWORK_MODULE_PATHS[1]]: input.valuesExports,
  });
  const generatedShims = new Set<string>();
  for (const applicationModule of input.source.modules) {
    for (const [frameworkModule, exportNames] of Object.entries(
      supportedFrameworkModules,
    )) {
      const shimName = frameworkShimName(
        input.source.modulePrefix,
        applicationModule.path,
        frameworkModule,
      );
      if (generatedShims.has(shimName)) continue;
      if (Object.hasOwn(modules, shimName)) {
        throw new Error(`Application runtime framework collision ${shimName}.`);
      }
      generatedShims.add(shimName);
      const coreImport = JSON.stringify(relativeFrameworkImport(
        shimName,
        trusted.core,
      ));
      modules[shimName] = Object.freeze({
        js: [
          `import * as applicationRuntimeCore from ${coreImport};`,
          ...exportNames.map(name =>
            `export const ${name} = applicationRuntimeCore.${name};`
          ),
          "",
        ].join("\n"),
      });
    }
  }
  return Object.freeze({
    mainModule: trusted.entrypoint,
    coreModule: trusted.core,
    executionModule,
    modules: Object.freeze(modules),
  });
}

function trustedModuleNames(stemPrefix: string, rootSha256: string): Readonly<{
  readonly entrypoint: string;
  readonly core: string;
}> {
  const stem = `${stemPrefix}_${rootSha256}`;
  return Object.freeze({
    entrypoint: `${stem}_entrypoint.js`,
    core: `${stem}_core.js`,
  });
}

function runtimeModuleName(prefix: string, path: string): string {
  return `${prefix}/${path}`;
}

function frameworkShimName(
  modulePrefix: string,
  importingApplicationPath: string,
  frameworkModule: string,
): string {
  const importingModule = runtimeModuleName(modulePrefix, importingApplicationPath);
  const lastSlash = importingModule.lastIndexOf("/");
  return `${importingModule.slice(0, lastSlash + 1)}${frameworkModule}`;
}

function relativeFrameworkImport(
  frameworkModule: string,
  coreModule: string,
): string {
  const directoryDepth = frameworkModule.split("/").length - 1;
  return `${directoryDepth === 0 ? "./" : "../".repeat(directoryDepth)}${coreModule}`;
}

function relativeImport(path: string): string {
  return path.startsWith("./") ? path : `./${path}`;
}
