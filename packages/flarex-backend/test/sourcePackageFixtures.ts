import type { DeploymentFunctions, PushSourcePackage } from "../src/types";
import { sourceModuleSha256ForTest } from "./sourcePackageHashFixture";

export type SourcePackageForFunctionsOptions = {
  readonly execution?: string;
  readonly schema?: string;
  readonly moduleHash?: string;
  readonly includeModuleSource?: boolean;
};

export function sourcePackageForFunctions(
  functions: DeploymentFunctions,
  options: SourcePackageForFunctionsOptions = {},
): PushSourcePackage {
  const execution = options.execution ?? "_flarex/execution.js";
  const schema = options.schema ?? "_flarex/schema.js";
  const functionModulePaths = [
    ...new Set(functions.functions.map(fn => `${moduleNameFromFunctionPath(fn.path)}.js`)),
  ].sort();
  const source = options.includeModuleSource === false
    ? undefined
    : "export default {};";
  const moduleHash = options.moduleHash ??
    (source === undefined
      ? "0".repeat(64)
      : sourceModuleSha256ForTest(source));
  const modules = [execution, schema, ...functionModulePaths].map(path =>
    sourcePackageModule(path, moduleHash, source),
  );
  return {
    sourceModuleDigestFormat: "sha256-framed-v1",
    modules,
    functions: functionModulePaths,
    schema,
    execution,
  };
}

function sourcePackageModule(
  path: string,
  sha256: string,
  source: string | undefined,
): PushSourcePackage["modules"][number] {
  return {
    path,
    environment: "isolate",
    sha256,
    ...(source === undefined ? {} : { source }),
  };
}

function moduleNameFromFunctionPath(path: string): string {
  const separator = path.indexOf(":");
  return separator === -1 ? path : path.slice(0, separator);
}
