import {
  type CanonicalDeclarativeProgramBudgetV1,
  type CanonicalDeclarativeProgramV1,
} from "@flarex/declarative-program/v1";
import {
  admitDeclarativeV2MaterializationBudgetV1,
  materializeDeclarativeV2ArtifactsV1,
  type DeclarativeV2ArtifactIngressPlanV1,
  type DeclarativeV2MaterializationBudgetV1,
  type DeclarativeV2MaterializationV1Error,
  type DeclarativeV2PrebuiltModuleGraphInputV1,
  type DeclarativeV2PrebuiltModuleInputV1,
} from "@flarex/declarative-materializer/v1";
import { Buffer } from "node:buffer";
import { Data, Effect, Result } from "effect";

import {
  canonicalDeclarativeProgramV1FromLoadedSdkDefinitionEffect,
  type CanonicalDeclarativeProgramV1FromSdkError,
  type LoadedSdkDeclarativeProgramV1Input,
} from "./declarativeProgramV1.ts";
import type { SourcePackage } from "./sourcePackage.ts";

const UTF8_ENCODER = new TextEncoder();

export interface LoadedSdkDeclarativePrebuildV1Input {
  readonly sdkDefinition: LoadedSdkDeclarativeProgramV1Input;
  readonly sourcePackage: SourcePackage;
}

export class DeclarativeV2LoadedSdkPrebuildAdapterError
  extends Data.TaggedError("DeclarativeV2LoadedSdkPrebuildAdapterError")<{
    readonly reason:
      | "unsupportedAuthConfig"
      | "invalidSourcePackage"
      | "duplicateFunctionPath"
      | "duplicateModulePath"
      | "budgetExceeded";
    readonly path: string;
    readonly dimension?:
      | "prebuiltModules"
      | "modules"
      | "entryBindings"
      | "sourceBytes"
      | "sourceMapBytes"
      | "bytesMaterialized";
    readonly observed?: number;
    readonly maximum?: number;
  }> {}

export type DeclarativeV2ArtifactsFromLoadedSdkPrebuildV1Error =
  | CanonicalDeclarativeProgramV1FromSdkError
  | DeclarativeV2LoadedSdkPrebuildAdapterError
  | DeclarativeV2MaterializationV1Error;

/**
 * Projects the existing V1 build owner's normalized module output into the
 * host-neutral materializer input. The explicit `.js` binding is owned here
 * because it is a flarex-dev bundling convention, not materializer policy.
 *
 * Schema source is already represented by the admitted canonical program.
 * Schema and auth executable roles remain outside the approved M8 vertical,
 * so this adapter selects only declared function entries and the execution
 * module. Unknown or inconsistent selected entries are rejected by the
 * materializer rather than repaired or silently inferred.
 */
function declarativeV2PrebuiltModuleGraphV1FromSourcePackage(
  program: CanonicalDeclarativeProgramV1,
  sourcePackage: SourcePackage,
  budget: DeclarativeV2MaterializationBudgetV1,
): Result.Result<
  DeclarativeV2PrebuiltModuleGraphInputV1,
  DeclarativeV2LoadedSdkPrebuildAdapterError
> {
  return Result.gen(function* () {
    const modules = yield* captureOwnArray(
      sourcePackage,
      "modules",
      "sourcePackage.modules",
    );
    const functions = yield* captureOwnArray(
      sourcePackage,
      "functions",
      "sourcePackage.functions",
    );
    const executionPath = yield* captureOwnString(
      sourcePackage,
      "execution",
      "sourcePackage.execution",
    );

    if (program.modules.length > budget.maximumEntryBindings) {
      return yield* Result.fail(prebuildBudgetError(
        "entryBindings",
        program.modules.length,
        budget.maximumEntryBindings,
        "program.modules",
      ));
    }
    if (functions.length > budget.maximumModules) {
      return yield* Result.fail(prebuildBudgetError(
        "modules",
        functions.length,
        budget.maximumModules,
        "sourcePackage.functions",
      ));
    }
    const functionPaths = new Set<string>();
    for (let index = 0; index < functions.length; index += 1) {
      const functionPath = yield* captureArrayString(
        functions,
        index,
        `sourcePackage.functions[${index}]`,
      );
      if (functionPaths.has(functionPath)) {
        return yield* Result.fail(
          new DeclarativeV2LoadedSdkPrebuildAdapterError({
            reason: "duplicateFunctionPath",
            path: `sourcePackage.functions[${index}]`,
          }),
        );
      }
      functionPaths.add(functionPath);
    }
    const maximumPrebuiltModules =
      budget.maximumModules === Number.MAX_SAFE_INTEGER
        ? Number.MAX_SAFE_INTEGER
        : budget.maximumModules + 1;
    if (modules.length > maximumPrebuiltModules) {
      return yield* Result.fail(prebuildBudgetError(
        "prebuiltModules",
        modules.length,
        maximumPrebuiltModules,
        "sourcePackage.modules",
      ));
    }

    const capturedModules: Array<Readonly<{
      readonly path: string;
      readonly roles: DeclarativeV2PrebuiltModuleInputV1["roles"];
      readonly source: string;
      readonly sourceMap: string | undefined;
    }>> = [];
    const selectedPaths = new Set<string>();
    let sourceBytes = 0;
    let sourceMapBytes = 0;
    let bytesMaterialized = 0;
    for (let index = 0; index < modules.length; index += 1) {
      const module = yield* captureArrayRecord(
        modules,
        index,
        `sourcePackage.modules[${index}]`,
      );
      const modulePath = yield* captureOwnString(
        module,
        "path",
        `sourcePackage.modules[${index}].path`,
      );
      const roles = sourceModuleRoles(
        modulePath,
        functionPaths,
        executionPath,
      );
      if (roles.length === 0) continue;
      if (selectedPaths.has(modulePath)) {
        return yield* Result.fail(
          new DeclarativeV2LoadedSdkPrebuildAdapterError({
            reason: "duplicateModulePath",
            path: `sourcePackage.modules[${index}].path`,
          }),
        );
      }
      selectedPaths.add(modulePath);
      if (capturedModules.length + 1 > budget.maximumModules) {
        return yield* Result.fail(prebuildBudgetError(
          "modules",
          capturedModules.length + 1,
          budget.maximumModules,
          "sourcePackage.modules",
        ));
      }

      const source = yield* captureOwnString(
        module,
        "source",
        `sourcePackage.modules[${index}].source`,
      );
      const sourceMap = yield* captureOptionalOwnString(
        module,
        "sourceMap",
        `sourcePackage.modules[${index}].sourceMap`,
      );
      const sourceLength = Buffer.byteLength(source, "utf8");
      const sourceMapLength = sourceMap === undefined
        ? 0
        : Buffer.byteLength(sourceMap, "utf8");
      sourceBytes = yield* addBudgetedTotal(
        sourceBytes,
        sourceLength,
        budget.maximumSourceBytes,
        "sourceBytes",
        `sourcePackage.modules[${index}].source`,
      );
      sourceMapBytes = yield* addBudgetedTotal(
        sourceMapBytes,
        sourceMapLength,
        budget.maximumSourceMapBytes,
        "sourceMapBytes",
        `sourcePackage.modules[${index}].sourceMap`,
      );
      bytesMaterialized = yield* addBudgetedTotal(
        bytesMaterialized,
        sourceLength + sourceMapLength,
        budget.maximumBytesMaterialized,
        "bytesMaterialized",
        `sourcePackage.modules[${index}]`,
      );
      capturedModules.push({ path: modulePath, roles, source, sourceMap });
    }

    return {
      modules: capturedModules.map((module) => ({
        path: module.path,
        roles: module.roles,
        sourceBytes: UTF8_ENCODER.encode(module.source),
        sourceMapBytes: module.sourceMap === undefined
          ? null
          : UTF8_ENCODER.encode(module.sourceMap),
      })),
      functionEntries: program.modules.map((module) => ({
        logicalModulePath: module.modulePath,
        artifactModulePath: `${module.modulePath}.js`,
      })),
      executionPath,
      schemaPath: null,
      authPath: null,
    };
  });
}

export const materializeDeclarativeV2ArtifactsFromLoadedSdkPrebuildEffect: (
  input: LoadedSdkDeclarativePrebuildV1Input,
  programBudget: CanonicalDeclarativeProgramBudgetV1,
  materializationBudget: DeclarativeV2MaterializationBudgetV1,
) => Effect.Effect<
  DeclarativeV2ArtifactIngressPlanV1,
  DeclarativeV2ArtifactsFromLoadedSdkPrebuildV1Error
> = Effect.fn(
  "FlarexDev.materializeDeclarativeV2ArtifactsFromLoadedSdkPrebuild",
)(function* (
  input: LoadedSdkDeclarativePrebuildV1Input,
  programBudget: CanonicalDeclarativeProgramBudgetV1,
  materializationBudget: DeclarativeV2MaterializationBudgetV1,
): Effect.fn.Return<
  DeclarativeV2ArtifactIngressPlanV1,
  DeclarativeV2ArtifactsFromLoadedSdkPrebuildV1Error
> {
  const authenticatedMaterializationBudget = yield* Effect.fromResult(
    admitDeclarativeV2MaterializationBudgetV1(materializationBudget),
  );
  const program =
    yield* canonicalDeclarativeProgramV1FromLoadedSdkDefinitionEffect(
      input.sdkDefinition,
      programBudget,
    );
  const authConfig = yield* Effect.fromResult(captureOptionalOwnDataProperty(
    input.sourcePackage,
    "authConfig",
    "sourcePackage.authConfig",
  ));
  if (authConfig !== undefined) {
    return yield* new DeclarativeV2LoadedSdkPrebuildAdapterError({
      reason: "unsupportedAuthConfig",
      path: "sourcePackage.authConfig",
    });
  }
  const authConfigModule = yield* Effect.fromResult(
    captureOptionalOwnDataProperty(
      input.sourcePackage,
      "authConfigModule",
      "sourcePackage.authConfigModule",
    ),
  );
  if (authConfigModule !== undefined) {
    return yield* new DeclarativeV2LoadedSdkPrebuildAdapterError({
      reason: "unsupportedAuthConfig",
      path: "sourcePackage.authConfigModule",
    });
  }
  const graph = yield* Effect.fromResult(
    declarativeV2PrebuiltModuleGraphV1FromSourcePackage(
      program,
      input.sourcePackage,
      authenticatedMaterializationBudget,
    ),
  );
  return yield* Effect.fromResult(materializeDeclarativeV2ArtifactsV1(
    program,
    graph,
    authenticatedMaterializationBudget,
  ));
});

function sourceModuleRoles(
  path: string,
  functionPaths: ReadonlySet<string>,
  executionPath: string,
): DeclarativeV2PrebuiltModuleInputV1["roles"] {
  const roles: Array<
    DeclarativeV2PrebuiltModuleInputV1["roles"][number]
  > = [];
  if (functionPaths.has(path)) roles.push("function");
  if (executionPath === path) roles.push("execution");
  return roles;
}

function addBudgetedTotal(
  current: number,
  amount: number,
  maximum: number,
  dimension:
    | "sourceBytes"
    | "sourceMapBytes"
    | "bytesMaterialized",
  path: string,
): Result.Result<number, DeclarativeV2LoadedSdkPrebuildAdapterError> {
  return amount > maximum - current
    ? Result.fail(prebuildBudgetError(
      dimension,
      current + amount,
      maximum,
      path,
    ))
    : Result.succeed(current + amount);
}

function prebuildBudgetError(
  dimension: NonNullable<
    DeclarativeV2LoadedSdkPrebuildAdapterError["dimension"]
  >,
  observed: number,
  maximum: number,
  path: string,
): DeclarativeV2LoadedSdkPrebuildAdapterError {
  return new DeclarativeV2LoadedSdkPrebuildAdapterError({
    reason: "budgetExceeded",
    dimension,
    observed,
    maximum,
    path,
  });
}

function captureOwnArray(
  owner: unknown,
  key: PropertyKey,
  path: string,
): Result.Result<ReadonlyArray<unknown>, DeclarativeV2LoadedSdkPrebuildAdapterError> {
  return Result.flatMap(
    captureOwnDataProperty(owner, key, path),
    (value) => Array.isArray(value)
      ? Result.succeed(value)
      : Result.fail(invalidSourcePackageError(path)),
  );
}

function captureArrayRecord(
  values: ReadonlyArray<unknown>,
  index: number,
  path: string,
): Result.Result<object, DeclarativeV2LoadedSdkPrebuildAdapterError> {
  return Result.flatMap(
    captureOwnDataProperty(values, index, path),
    (value) =>
      value !== null && typeof value === "object" && !Array.isArray(value)
        ? Result.succeed(value)
        : Result.fail(invalidSourcePackageError(path)),
  );
}

function captureArrayString(
  values: ReadonlyArray<unknown>,
  index: number,
  path: string,
): Result.Result<string, DeclarativeV2LoadedSdkPrebuildAdapterError> {
  return Result.flatMap(
    captureOwnDataProperty(values, index, path),
    (value) => typeof value === "string"
      ? Result.succeed(value)
      : Result.fail(invalidSourcePackageError(path)),
  );
}

function captureOwnString(
  owner: unknown,
  key: PropertyKey,
  path: string,
): Result.Result<string, DeclarativeV2LoadedSdkPrebuildAdapterError> {
  return Result.flatMap(
    captureOwnDataProperty(owner, key, path),
    (value) => typeof value === "string"
      ? Result.succeed(value)
      : Result.fail(invalidSourcePackageError(path)),
  );
}

function captureOptionalOwnString(
  owner: unknown,
  key: PropertyKey,
  path: string,
): Result.Result<
  string | undefined,
  DeclarativeV2LoadedSdkPrebuildAdapterError
> {
  return Result.flatMap(
    captureOptionalOwnDataProperty(owner, key, path),
    (value) => value === undefined || typeof value === "string"
      ? Result.succeed(value)
      : Result.fail(invalidSourcePackageError(path)),
  );
}

function captureOwnDataProperty(
  owner: unknown,
  key: PropertyKey,
  path: string,
): Result.Result<unknown, DeclarativeV2LoadedSdkPrebuildAdapterError> {
  if ((typeof owner !== "object" && typeof owner !== "function") ||
      owner === null) {
    return Result.fail(invalidSourcePackageError(path));
  }
  const descriptor = Object.getOwnPropertyDescriptor(owner, key);
  return descriptor !== undefined && "value" in descriptor
    ? Result.succeed(descriptor.value)
    : Result.fail(invalidSourcePackageError(path));
}

function captureOptionalOwnDataProperty(
  owner: unknown,
  key: PropertyKey,
  path: string,
): Result.Result<unknown, DeclarativeV2LoadedSdkPrebuildAdapterError> {
  if ((typeof owner !== "object" && typeof owner !== "function") ||
      owner === null) {
    return Result.fail(invalidSourcePackageError(path));
  }
  const descriptor = Object.getOwnPropertyDescriptor(owner, key);
  if (descriptor === undefined) return Result.succeed(undefined);
  return "value" in descriptor
    ? Result.succeed(descriptor.value)
    : Result.fail(invalidSourcePackageError(path));
}

function invalidSourcePackageError(
  path: string,
): DeclarativeV2LoadedSdkPrebuildAdapterError {
  return new DeclarativeV2LoadedSdkPrebuildAdapterError({
    reason: "invalidSourcePackage",
    path,
  });
}
