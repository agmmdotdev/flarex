import {
  APPLICATION_ANALYSIS_FRAMEWORK_MODULE_PATHS,
  findApplicationAnalysisFrameworkShimCollision,
} from "@flarex/analysis/internal/application-analysis-module-path-policy";

import type {
  ApplicationAnalysisSourceBundle,
} from "../sourceArtifactV2/ApplicationAnalysisReader";

const APPLICATION_MODULE_PREFIX = "__flarex_application_modules" as const;

export interface ApplicationRuntimeModuleGraph {
  readonly mainModule: string;
  readonly coreModule: string;
  readonly executionModule: string;
  readonly modules: Readonly<Record<string, WorkerLoaderModule | string>>;
}

export function makeApplicationRuntimeModuleGraph(input: {
  readonly source: ApplicationAnalysisSourceBundle;
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
  const trusted = trustedModuleNames(input.source.sourceArtifact.rootSha256);
  const executionModule = applicationModuleName(
    input.source.sourceArtifact.executionModulePath,
  );
  const modules: Record<string, WorkerLoaderModule | string> = Object.create(null);
  modules[trusted.entrypoint] = {
    js: input.entrypointSource(Object.freeze({
      core: relativeImport(trusted.core),
      execution: relativeImport(executionModule),
    })),
  };
  modules[trusted.core] = { js: input.coreSource };
  for (const module of input.source.modules) {
    const name = applicationModuleName(module.path);
    if (Object.hasOwn(modules, name)) {
      throw new Error(`Duplicate application runtime module ${module.path}.`);
    }
    modules[name] = { js: module.source };
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
      const shimName = frameworkShimName(applicationModule.path, frameworkModule);
      if (generatedShims.has(shimName)) continue;
      if (Object.hasOwn(modules, shimName)) {
        throw new Error(`Application runtime framework collision ${shimName}.`);
      }
      generatedShims.add(shimName);
      const coreImport = JSON.stringify(relativeFrameworkImport(
        shimName,
        trusted.core,
      ));
      modules[shimName] = {
        js: [
          `import * as applicationRuntimeCore from ${coreImport};`,
          ...exportNames.map(name =>
            `export const ${name} = applicationRuntimeCore.${name};`
          ),
          "",
        ].join("\n"),
      };
    }
  }
  return Object.freeze({
    mainModule: trusted.entrypoint,
    coreModule: trusted.core,
    executionModule,
    modules: Object.freeze(modules),
  });
}

function trustedModuleNames(rootSha256: string): Readonly<{
  readonly entrypoint: string;
  readonly core: string;
}> {
  const stem = `__flarex_application_runtime_${rootSha256}`;
  return Object.freeze({
    entrypoint: `${stem}_entrypoint.js`,
    core: `${stem}_core.js`,
  });
}

function applicationModuleName(path: string): string {
  return `${APPLICATION_MODULE_PREFIX}/${path}`;
}

function frameworkShimName(
  importingApplicationPath: string,
  frameworkModule: string,
): string {
  const importingModule = applicationModuleName(importingApplicationPath);
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
