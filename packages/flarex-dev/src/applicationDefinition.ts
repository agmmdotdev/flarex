import {
  action,
  admitApplicationPreparationPolicy,
  defineApplication,
  defineModule,
  defineSchema,
  defineTable,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  prepareApplication,
  query,
  sourceModule,
  v,
  workflowMutation,
  type ApplicationDefinition,
  type ApplicationPreparationError,
  type ApplicationPreparationPolicy,
  type FunctionDefinition,
  type PreparedApplication,
  type TableDefinition,
  type Validator,
  type ValidatorOptionality,
  type ValidatorRecord,
} from "@flarex/application-definition";
import {
  inspectAdmittedApplicationPreparationPolicy,
} from "@flarex/application-definition/internal/preparation";
import {
  analyzeExecutionModulesEffect,
  analyzeSchemaDefinitionEffect,
  type AnalyzerFunctionMetadataError,
  type AnalyzerPartitionError,
  type AnalyzerSchemaError,
  type AnalyzerValidatorError,
  type LoadedExecutionModules,
} from "@flarex/analysis";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Buffer } from "node:buffer";
import { Data, Effect, Result } from "effect";
import type {
  ObjectValidatorJsonV1,
  ValidatorJsonV1,
} from "flarex-protocol/validator-json";

import type { SourcePackage } from "./sourcePackage.ts";

const UTF8 = new TextEncoder();

export interface LoadedSdkApplicationInput {
  readonly schemaDefinition: unknown;
  readonly executionModules: LoadedExecutionModules;
  readonly sourcePackage: SourcePackage;
}

export type LoadedSdkApplicationDefinitionErrorReason =
  | "sdkInspectionFailed"
  | "unsupportedSchemaMember"
  | "unsupportedTablePlacement"
  | "unsupportedFunctionPartition"
  | "unsupportedAuthConfig"
  | "invalidSourcePackage"
  | "duplicateFunctionPath"
  | "duplicateModulePath"
  | "missingFunctionModule"
  | "unexpectedFunctionModule"
  | "budgetExceeded";

export class LoadedSdkApplicationDefinitionError extends Data.TaggedError(
  "LoadedSdkApplicationDefinitionError",
)<{
  readonly reason: LoadedSdkApplicationDefinitionErrorReason;
  readonly path: string;
  readonly dimension?:
    | "modules"
    | "sourceBytes"
    | "sourceMapBytes"
    | "bytesMaterialized";
  readonly observed?: number;
  readonly maximum?: number;
  readonly cause?: unknown;
}> {}

export type PrepareApplicationFromSdkError =
  | AnalyzerSchemaError
  | AnalyzerFunctionMetadataError
  | AnalyzerValidatorError
  | AnalyzerPartitionError
  | LoadedSdkApplicationDefinitionError
  | ApplicationPreparationError;

/**
 * Producer-owned SDK and source-package adapter. File/bundle policy remains in
 * flarex-dev; the resulting inert definition is admitted exactly once through
 * the clean Application Definition API.
 */
export const prepareApplicationFromSdk: (
  input: LoadedSdkApplicationInput,
  policy: ApplicationPreparationPolicy,
) => Effect.Effect<PreparedApplication, PrepareApplicationFromSdkError> =
  Effect.fn("FlarexDev.prepareApplicationFromSdk")(function* (
    input: LoadedSdkApplicationInput,
    policy: ApplicationPreparationPolicy,
  ): Effect.fn.Return<PreparedApplication, PrepareApplicationFromSdkError> {
    const admittedPolicy = yield* Effect.fromResult(
      admitApplicationPreparationPolicy(policy),
    );
    const admittedPolicyValues = inspectAdmittedApplicationPreparationPolicy(
      admittedPolicy,
    );
    const sdkSchemaMembers = yield* inspectSdkSchemaMembers(
      input.schemaDefinition,
    );
    for (const member of sdkSchemaMembers) {
      if (member.kind !== "table") {
        return yield* adapterError(
          "unsupportedSchemaMember",
          `schema.tables.${member.name}`,
        );
      }
    }

    const analyzedSchema = yield* analyzeSchemaDefinitionEffect(
      input.schemaDefinition,
    );
    const tableNamesById = new Map<number, string>();
    for (const table of analyzedSchema.tables) {
      if (table.placement.kind !== "global") {
        return yield* adapterError(
          "unsupportedTablePlacement",
          `schema.tables.${table.name}.placement`,
        );
      }
      tableNamesById.set(table.tableId, table.name);
    }

    const analyzedModules = yield* analyzeExecutionModulesEffect(
      input.executionModules,
    );
    for (const module of analyzedModules) {
      for (const fn of module.functions) {
        if (fn.partition !== undefined && fn.partition !== null) {
          return yield* adapterError(
            "unsupportedFunctionPartition",
            `modules.${module.moduleName}.functions.${fn.exportName}.partition`,
          );
        }
      }
    }

    const authConfig = yield* Effect.fromResult(
      captureOptionalOwnDataProperty(
        input.sourcePackage,
        "authConfig",
        "sourcePackage.authConfig",
      ),
    );
    if (authConfig !== undefined) {
      return yield* adapterError(
        "unsupportedAuthConfig",
        "sourcePackage.authConfig",
      );
    }
    const authConfigModule = yield* Effect.fromResult(
      captureOptionalOwnDataProperty(
        input.sourcePackage,
        "authConfigModule",
        "sourcePackage.authConfigModule",
      ),
    );
    if (authConfigModule !== undefined) {
      return yield* adapterError(
        "unsupportedAuthConfig",
        "sourcePackage.authConfigModule",
      );
    }

    const sources = yield* Effect.fromResult(captureFunctionSources(
      input.sourcePackage,
      analyzedModules.map(module => module.moduleName),
      admittedPolicyValues,
    ));
    const tables: Record<string, TableDefinition> = Object.create(null);
    for (const table of analyzedSchema.tables) {
      if (table.validator.type !== "object") {
        return yield* Effect.die(new Error(
          `Analyzed SDK table ${table.name} lost its object validator invariant.`,
        ));
      }
      tables[table.name] = defineTable(
        validatorRecordFromObjectJson(table.validator),
      );
    }
    for (const index of analyzedSchema.indexes) {
      const tableName = tableNamesById.get(index.tableId);
      const [first, ...rest] = index.fields;
      const table = tableName === undefined ? undefined : tables[tableName];
      if (tableName === undefined || table === undefined || first === undefined) {
        return yield* Effect.die(new Error(
          `Analyzed SDK index ${index.name} lost its table or field invariant.`,
        ));
      }
      tables[tableName] = table.index(index.name, [first, ...rest]);
    }

    const modules = analyzedModules.map(module => {
      const functions: Record<string, FunctionDefinition> = Object.create(null);
      for (const fn of module.functions) {
        functions[fn.exportName] = functionFromSdk(
          fn.kind,
          fn.visibility,
          fn.args,
          fn.returns,
        );
      }
      const source = sources.get(module.moduleName);
      if (source === undefined) {
        throw new Error(
          `Captured SDK source disappeared for ${module.moduleName}.`,
        );
      }
      return defineModule({
        path: module.moduleName,
        source: sourceModule(source),
        functions,
      });
    });
    const definition: ApplicationDefinition = defineApplication({
      schema: defineSchema(tables),
      modules,
    });
    return yield* Effect.fromResult(
      prepareApplication(definition, admittedPolicy),
    );
  });

interface CapturedFunctionSource {
  readonly path: string;
  readonly bytes: Uint8Array;
  readonly sourceMapBytes: Uint8Array | null;
}

function captureFunctionSources(
  sourcePackage: SourcePackage,
  logicalModulePaths: ReadonlyArray<string>,
  policy: Readonly<ApplicationPreparationPolicy>,
): Result.Result<
  ReadonlyMap<string, CapturedFunctionSource>,
  LoadedSdkApplicationDefinitionError
> {
  return Result.gen(function* () {
    const functionPaths = yield* captureOwnArray(
      sourcePackage,
      "functions",
      "sourcePackage.functions",
    );
    if (functionPaths.length > policy.maximumModules) {
      return yield* budgetError(
        "modules",
        functionPaths.length,
        policy.maximumModules,
        "sourcePackage.functions",
      );
    }
    const selectedPaths = new Set<string>();
    for (let index = 0; index < functionPaths.length; index += 1) {
      const path = yield* captureArrayString(
        functionPaths,
        index,
        `sourcePackage.functions[${index}]`,
      );
      if (selectedPaths.has(path)) {
        return yield* Result.fail(new LoadedSdkApplicationDefinitionError({
          reason: "duplicateFunctionPath",
          path: `sourcePackage.functions[${index}]`,
        }));
      }
      selectedPaths.add(path);
    }

    const expectedByArtifact = new Map<string, string>(
      logicalModulePaths.map(path => [`${path}.js`, path] as const),
    );
    for (const path of selectedPaths) {
      if (!expectedByArtifact.has(path)) {
        return yield* Result.fail(new LoadedSdkApplicationDefinitionError({
          reason: "unexpectedFunctionModule",
          path,
        }));
      }
    }
    for (const artifactPath of expectedByArtifact.keys()) {
      if (!selectedPaths.has(artifactPath)) {
        return yield* Result.fail(new LoadedSdkApplicationDefinitionError({
          reason: "missingFunctionModule",
          path: artifactPath,
        }));
      }
    }

    const moduleValues = yield* captureOwnArray(
      sourcePackage,
      "modules",
      "sourcePackage.modules",
    );
    const moduleContainerMaximum = policy.maximumModules + 2;
    if (moduleValues.length > moduleContainerMaximum) {
      return yield* budgetError(
        "modules",
        moduleValues.length,
        moduleContainerMaximum,
        "sourcePackage.modules",
      );
    }
    const modulesByPath = new Map<string, object>();
    for (let index = 0; index < moduleValues.length; index += 1) {
      const module = yield* captureArrayRecord(
        moduleValues,
        index,
        `sourcePackage.modules[${index}]`,
      );
      const path = yield* captureOwnString(
        module,
        "path",
        `sourcePackage.modules[${index}].path`,
      );
      if (!selectedPaths.has(path)) continue;
      if (modulesByPath.has(path)) {
        return yield* Result.fail(new LoadedSdkApplicationDefinitionError({
          reason: "duplicateModulePath",
          path: `sourcePackage.modules[${index}].path`,
        }));
      }
      modulesByPath.set(path, module);
    }

    const capturedText = new Map<string, Readonly<{
      readonly path: string;
      readonly source: string;
      readonly sourceMap: string | undefined;
    }>>();
    let sourceBytes = 0;
    let sourceMapBytes = 0;
    let bytesMaterialized = 0;
    for (const [artifactPath, logicalPath] of expectedByArtifact) {
      const module = modulesByPath.get(artifactPath);
      if (module === undefined) {
        return yield* Result.fail(new LoadedSdkApplicationDefinitionError({
          reason: "missingFunctionModule",
          path: artifactPath,
        }));
      }
      const source = yield* captureOwnString(
        module,
        "source",
        `sourcePackage.modules.${artifactPath}.source`,
      );
      const sourceMap = yield* captureOptionalOwnString(
        module,
        "sourceMap",
        `sourcePackage.modules.${artifactPath}.sourceMap`,
      );
      const sourceByteLength = Buffer.byteLength(source, "utf8");
      const sourceMapByteLength = sourceMap === undefined
        ? 0
        : Buffer.byteLength(sourceMap, "utf8");
      sourceBytes = yield* addBudgetedTotal(
        sourceBytes,
        sourceByteLength,
        policy.maximumSourceBytes,
        "sourceBytes",
        `sourcePackage.modules.${artifactPath}.source`,
      );
      sourceMapBytes = yield* addBudgetedTotal(
        sourceMapBytes,
        sourceMapByteLength,
        policy.maximumSourceMapBytes,
        "sourceMapBytes",
        `sourcePackage.modules.${artifactPath}.sourceMap`,
      );
      bytesMaterialized = yield* addBudgetedTotal(
        bytesMaterialized,
        sourceByteLength + sourceMapByteLength,
        policy.maximumBytesMaterialized,
        "bytesMaterialized",
        `sourcePackage.modules.${artifactPath}`,
      );
      capturedText.set(logicalPath, {
        path: artifactPath,
        source,
        sourceMap,
      });
    }
    const captured = new Map<string, CapturedFunctionSource>();
    for (const [logicalPath, source] of capturedText) {
      captured.set(logicalPath, {
        path: source.path,
        bytes: UTF8.encode(source.source),
        sourceMapBytes: source.sourceMap === undefined
          ? null
          : UTF8.encode(source.sourceMap),
      });
    }
    return captured;
  });
}

function functionFromSdk(
  kind: "query" | "mutation" | "workflowMutation" | "action",
  visibility: "public" | "internal",
  argsJson: ValidatorJsonV1,
  returnsJson: ValidatorJsonV1 | null,
): FunctionDefinition {
  const args = functionArgsFromJson(argsJson);
  const returns = returnsJson === null
    ? null
    : requiredValidatorFromJson(returnsJson);
  switch (`${visibility}:${kind}`) {
    case "public:query":
      return returns === null ? query({ args }) : query({ args, returns });
    case "internal:query":
      return returns === null
        ? internalQuery({ args })
        : internalQuery({ args, returns });
    case "public:mutation":
      return returns === null
        ? mutation({ args })
        : mutation({ args, returns });
    case "internal:mutation":
      return returns === null
        ? internalMutation({ args })
        : internalMutation({ args, returns });
    case "public:workflowMutation":
      return returns === null
        ? workflowMutation({ args })
        : workflowMutation({ args, returns });
    case "public:action":
      return returns === null ? action({ args }) : action({ args, returns });
    case "internal:action":
      return returns === null
        ? internalAction({ args })
        : internalAction({ args, returns });
    default:
      throw new TypeError(`Unsupported SDK function: ${visibility}:${kind}.`);
  }
}

function functionArgsFromJson(json: ValidatorJsonV1): FunctionDefinition["args"] {
  if (json.type === "any") return v.any();
  if (json.type !== "object") {
    throw new TypeError("SDK function arguments must be object or any.");
  }
  return v.object(validatorRecordFromObjectJson(json));
}

function validatorRecordFromObjectJson(
  json: ObjectValidatorJsonV1,
): ValidatorRecord {
  const fields: Record<
    string,
    Validator<unknown, ValidatorOptionality, string>
  > = Object.create(null);
  for (const [name, field] of Object.entries(json.value)) {
    const required = requiredValidatorFromJson(field.fieldType);
    fields[name] = field.optional ? v.optional(required) : required;
  }
  return fields;
}

function requiredValidatorFromJson(
  json: ValidatorJsonV1,
): Validator<unknown, "required", string> {
  switch (json.type) {
    case "null": return v.null();
    case "number": return v.number();
    case "bigint": return v.bigint();
    case "boolean": return v.boolean();
    case "string": return v.string();
    case "bytes": return v.bytes();
    case "any": return v.any();
    case "id": return v.id(json.tableName);
    case "literal": return v.literal(json.value);
    case "array": return v.array(requiredValidatorFromJson(json.value));
    case "record":
      return v.record(
        requiredValidatorFromJson(json.keys),
        requiredValidatorFromJson(json.values),
      );
    case "object": return v.object(validatorRecordFromObjectJson(json));
    case "union": {
      const [first, ...rest] = json.value;
      if (first === undefined) {
        throw new TypeError("SDK validator union must not be empty.");
      }
      return v.union(
        requiredValidatorFromJson(first),
        ...rest.map(requiredValidatorFromJson),
      );
    }
  }
}

const inspectSdkSchemaMembers = Effect.fn(
  "FlarexDev.inspectSdkSchemaMembers",
)(function* (
  value: unknown,
): Effect.fn.Return<
  ReadonlyArray<Readonly<{ readonly name: string; readonly kind: unknown }>>,
  LoadedSdkApplicationDefinitionError
> {
  return yield* Effect.try({
    try: () => {
      if (!isNonArrayRecord(value)) return [];
      const tables = value.tables;
      if (!isNonArrayRecord(tables)) return [];
      return Object.entries(tables).map(([name, member]) => {
        if (!isNonArrayRecord(member)) return { name, kind: undefined };
        const descriptor = Object.getOwnPropertyDescriptor(member, "kind");
        if (descriptor !== undefined && !("value" in descriptor)) {
          throw new TypeError(
            `SDK schema member "${name}" kind must be an own data property.`,
          );
        }
        return { name, kind: descriptor?.value };
      });
    },
    catch: cause => new LoadedSdkApplicationDefinitionError({
      reason: "sdkInspectionFailed",
      path: "schema.tables",
      cause,
    }),
  });
});

function captureOwnArray(
  owner: unknown,
  key: PropertyKey,
  path: string,
): Result.Result<ReadonlyArray<unknown>, LoadedSdkApplicationDefinitionError> {
  return Result.flatMap(captureOwnDataProperty(owner, key, path), value =>
    Array.isArray(value)
      ? Result.succeed(value)
      : Result.fail(invalidSourcePackageError(path))
  );
}

function captureArrayRecord(
  values: ReadonlyArray<unknown>,
  index: number,
  path: string,
): Result.Result<object, LoadedSdkApplicationDefinitionError> {
  return Result.flatMap(captureOwnDataProperty(values, index, path), value =>
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? Result.succeed(value)
      : Result.fail(invalidSourcePackageError(path))
  );
}

function captureArrayString(
  values: ReadonlyArray<unknown>,
  index: number,
  path: string,
): Result.Result<string, LoadedSdkApplicationDefinitionError> {
  return Result.flatMap(captureOwnDataProperty(values, index, path), value =>
    typeof value === "string"
      ? Result.succeed(value)
      : Result.fail(invalidSourcePackageError(path))
  );
}

function captureOwnString(
  owner: unknown,
  key: PropertyKey,
  path: string,
): Result.Result<string, LoadedSdkApplicationDefinitionError> {
  return Result.flatMap(captureOwnDataProperty(owner, key, path), value =>
    typeof value === "string"
      ? Result.succeed(value)
      : Result.fail(invalidSourcePackageError(path))
  );
}

function captureOptionalOwnString(
  owner: unknown,
  key: PropertyKey,
  path: string,
): Result.Result<string | undefined, LoadedSdkApplicationDefinitionError> {
  return Result.flatMap(
    captureOptionalOwnDataProperty(owner, key, path),
    value => value === undefined || typeof value === "string"
      ? Result.succeed(value)
      : Result.fail(invalidSourcePackageError(path)),
  );
}

function captureOwnDataProperty(
  owner: unknown,
  key: PropertyKey,
  path: string,
): Result.Result<unknown, LoadedSdkApplicationDefinitionError> {
  if ((typeof owner !== "object" && typeof owner !== "function") || owner === null) {
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
): Result.Result<unknown, LoadedSdkApplicationDefinitionError> {
  if ((typeof owner !== "object" && typeof owner !== "function") || owner === null) {
    return Result.fail(invalidSourcePackageError(path));
  }
  const descriptor = Object.getOwnPropertyDescriptor(owner, key);
  if (descriptor === undefined) return Result.succeed(undefined);
  return "value" in descriptor
    ? Result.succeed(descriptor.value)
    : Result.fail(invalidSourcePackageError(path));
}

function addBudgetedTotal(
  current: number,
  amount: number,
  maximum: number,
  dimension: "sourceBytes" | "sourceMapBytes" | "bytesMaterialized",
  path: string,
): Result.Result<number, LoadedSdkApplicationDefinitionError> {
  return amount > maximum - current
    ? budgetError(dimension, current + amount, maximum, path)
    : Result.succeed(current + amount);
}

function budgetError(
  dimension: "modules" | "sourceBytes" | "sourceMapBytes" | "bytesMaterialized",
  observed: number,
  maximum: number,
  path: string,
): Result.Result<never, LoadedSdkApplicationDefinitionError> {
  return Result.fail(new LoadedSdkApplicationDefinitionError({
    reason: "budgetExceeded",
    dimension,
    observed,
    maximum,
    path,
  }));
}

function invalidSourcePackageError(
  path: string,
): LoadedSdkApplicationDefinitionError {
  return new LoadedSdkApplicationDefinitionError({
    reason: "invalidSourcePackage",
    path,
  });
}

function adapterError(
  reason: LoadedSdkApplicationDefinitionErrorReason,
  path: string,
): LoadedSdkApplicationDefinitionError {
  return new LoadedSdkApplicationDefinitionError({ reason, path });
}
