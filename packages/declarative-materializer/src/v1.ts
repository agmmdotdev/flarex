import {
  canonicalDeclarativeFunctionPathV1,
  type CanonicalDeclarativeFunctionV1,
  type CanonicalDeclarativeModulePathV1,
  type CanonicalDeclarativeProgramV1,
} from "@flarex/declarative-program/v1";
import { copyBytes, isUint8Array } from "@flarex/utils/bytes";
import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { Brand, Data, Result } from "effect";
import {
  decodeDeclarativeV2ArtifactModulePathV1,
  type DeclarativeV2ArtifactModulePathV1,
} from "flarex-protocol/internal/declarative-v2-artifact-module-path-v1";
import {
  encodeDeclarativeV2SemanticRecordV1,
  measureDeclarativeV2SemanticRecordBytesV1,
  type DeclarativeV2SemanticRecordV1,
} from "flarex-protocol/internal/declarative-v2-semantic-record-v1";
import {
  isSourceArtifactV2ModuleRolesV1,
  SOURCE_ARTIFACT_V2_ROLE_BITS_V1,
  type SourceArtifactV2ModuleRoleV1,
  type SourceArtifactV2ModuleRolesV1,
} from "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import type { Json } from "flarex-protocol/json";
import type { ValidatorJsonV1 } from "flarex-protocol/validator-json";

export const DECLARATIVE_V2_MATERIALIZER_FORMAT_V1 =
  "flarex.declarative-materializer/v1" as const;
export const DECLARATIVE_V2_MATERIALIZER_SCHEMA_VERSION_V1 =
  DECLARATIVE_V2_MATERIALIZER_FORMAT_V1;

export interface DeclarativeV2MaterializationBudgetInputV1 {
  readonly maximumModules: number;
  readonly maximumEntryBindings: number;
  readonly maximumSourceBytes: number;
  readonly maximumSourceMapBytes: number;
  readonly maximumBytesMaterialized: number;
  readonly maximumSemanticRecords: number;
  readonly maximumSemanticRecordBytes: number;
  readonly maximumSemanticStreamBytes: number;
}

export type DeclarativeV2MaterializationBudgetV1 = Brand.Branded<
  DeclarativeV2MaterializationBudgetInputV1,
  "Flarex/DeclarativeV2MaterializationBudgetV1"
>;

const brandMaterializationBudgetV1 =
  Brand.nominal<DeclarativeV2MaterializationBudgetV1>();
const OWNED_BUDGETS = new WeakMap<
  object,
  DeclarativeV2MaterializationBudgetV1
>();

export type DeclarativeV2MaterializationBudgetDimensionV1 =
  | "modules"
  | "entryBindings"
  | "sourceBytes"
  | "sourceMapBytes"
  | "bytesMaterialized"
  | "semanticRecords"
  | "semanticRecordBytes"
  | "semanticStreamBytes";

export type DeclarativeV2MaterializationV1ErrorReason =
  | "invalidBudget"
  | "invalidInput"
  | "budgetExceeded"
  | "invalidModulePath"
  | "invalidRoles"
  | "unsupportedRole"
  | "invalidSourceBytes"
  | "invalidSourceMapBytes"
  | "duplicateModulePath"
  | "duplicateLogicalBinding"
  | "duplicateArtifactBinding"
  | "unknownLogicalModule"
  | "missingLogicalBinding"
  | "missingArtifactModule"
  | "unexpectedFunctionModule"
  | "functionRoleRequired"
  | "executionRoleRequired"
  | "multipleExecutionModules"
  | "schemaRoleUnsupported"
  | "authRoleUnsupported";

export class DeclarativeV2MaterializationV1Error extends Data.TaggedError(
  "DeclarativeV2MaterializationV1Error",
)<{
  readonly operation: "createBudget" | "materialize";
  readonly reason: DeclarativeV2MaterializationV1ErrorReason;
  readonly path?: string;
  readonly dimension?: DeclarativeV2MaterializationBudgetDimensionV1;
  readonly observed?: number;
  readonly maximum?: number;
}> {}

export interface DeclarativeV2PrebuiltModuleInputV1 {
  readonly path: string;
  readonly roles: ReadonlyArray<SourceArtifactV2ModuleRoleV1>;
  readonly sourceBytes: Uint8Array;
  readonly sourceMapBytes: Uint8Array | null;
}

export interface DeclarativeV2FunctionEntryBindingInputV1 {
  readonly logicalModulePath: string;
  readonly artifactModulePath: string;
}

export interface DeclarativeV2PrebuiltModuleGraphInputV1 {
  readonly modules: ReadonlyArray<DeclarativeV2PrebuiltModuleInputV1>;
  readonly functionEntries:
    ReadonlyArray<DeclarativeV2FunctionEntryBindingInputV1>;
  readonly executionPath: string;
  readonly schemaPath: string | null;
  readonly authPath: string | null;
}

export interface DeclarativeV2MaterializedSourceModuleV1 {
  readonly path: DeclarativeV2ArtifactModulePathV1;
  readonly roles: SourceArtifactV2ModuleRolesV1;
  readonly sourceBytes: Uint8Array;
  readonly sourceMapBytes: Uint8Array | null;
}

export interface DeclarativeV2MaterializedFunctionEntryBindingV1 {
  readonly logicalModulePath: CanonicalDeclarativeModulePathV1;
  readonly artifactModulePath: DeclarativeV2ArtifactModulePathV1;
}

export interface DeclarativeV2MaterializationUsageV1 {
  readonly modules: number;
  readonly entryBindings: number;
  readonly sourceBytes: number;
  readonly sourceMapBytes: number;
  readonly outputBytes: number;
  readonly bytesMaterialized: number;
  readonly semanticRecords: number;
  readonly maximumSemanticRecordBytes: number;
  readonly semanticStreamBytes: number;
}

export interface DeclarativeV2ArtifactIngressPlanV1 {
  readonly format: typeof DECLARATIVE_V2_MATERIALIZER_FORMAT_V1;
  readonly source: Readonly<{
    readonly modules: ReadonlyArray<DeclarativeV2MaterializedSourceModuleV1>;
    readonly functionEntries:
      ReadonlyArray<DeclarativeV2MaterializedFunctionEntryBindingV1>;
    readonly executionPath: DeclarativeV2ArtifactModulePathV1;
    readonly schemaPath: null;
    readonly authPath: null;
  }>;
  readonly semantic: Readonly<{
    readonly bytes: Uint8Array;
    readonly recordCount: number;
    readonly maximumRecordBytes: number;
  }>;
  readonly usage: DeclarativeV2MaterializationUsageV1;
}

type ExactRecord = Readonly<Record<string, unknown>>;

type DenseArrayCapture =
  | Readonly<{
      readonly kind: "success";
      readonly value: ReadonlyArray<unknown>;
    }>
  | Readonly<{ readonly kind: "tooLong"; readonly observed: number }>
  | Readonly<{ readonly kind: "invalid" }>;

interface MutableUsage {
  modules: number;
  entryBindings: number;
  sourceBytes: number;
  sourceMapBytes: number;
  bytesMaterialized: number;
}

interface OwnedGraphModule {
  readonly path: DeclarativeV2ArtifactModulePathV1;
  readonly roles: SourceArtifactV2ModuleRolesV1;
  readonly sourceBytes: Uint8Array;
  readonly sourceMapBytes: Uint8Array | null;
}

interface OwnedEntryBinding {
  readonly logicalModulePath: string;
  readonly artifactModulePath: DeclarativeV2ArtifactModulePathV1;
}

interface OwnedGraph {
  readonly modules: ReadonlyArray<OwnedGraphModule>;
  readonly functionEntries: ReadonlyArray<OwnedEntryBinding>;
  readonly executionPath: DeclarativeV2ArtifactModulePathV1;
}

interface ValidatorOwner {
  readonly identity: string;
  readonly value: ValidatorJsonV1;
}

const TYPED_ARRAY_PROTOTYPE: object = Object.getPrototypeOf(
  Uint8Array.prototype,
);
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteLength",
)?.get;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "buffer",
)?.get;
const ARRAY_BUFFER_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)?.get;
const SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER =
  typeof SharedArrayBuffer === "undefined"
    ? undefined
    : Object.getOwnPropertyDescriptor(
      SharedArrayBuffer.prototype,
      "byteLength",
    )?.get;

function materializationError(
  operation: DeclarativeV2MaterializationV1Error["operation"],
  reason: DeclarativeV2MaterializationV1ErrorReason,
  details: Readonly<{
    readonly path?: string;
    readonly dimension?: DeclarativeV2MaterializationBudgetDimensionV1;
    readonly observed?: number;
    readonly maximum?: number;
  }> = {},
): DeclarativeV2MaterializationV1Error {
  return new DeclarativeV2MaterializationV1Error({
    operation,
    reason,
    ...details,
  });
}

function captureExactRecord(
  value: unknown,
  keys: ReadonlyArray<string>,
): ExactRecord | undefined {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const ownKeys = Reflect.ownKeys(value);
    if (
      ownKeys.length !== keys.length ||
      !ownKeys.every((key) => typeof key === "string" && keys.includes(key))
    ) {
      return undefined;
    }
    const captured: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        return undefined;
      }
      Object.defineProperty(captured, key, {
        enumerable: true,
        value: descriptor.value,
      });
    }
    return Object.freeze(captured);
  } catch {
    return undefined;
  }
}

function captureDenseArray(
  value: unknown,
  maximum: number,
): DenseArrayCapture {
  try {
    if (!Array.isArray(value)) return { kind: "invalid" };
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      lengthDescriptor === undefined ||
      !("value" in lengthDescriptor) ||
      !isNonNegativeSafeInteger(lengthDescriptor.value)
    ) {
      return { kind: "invalid" };
    }
    const length = lengthDescriptor.value;
    if (length > maximum) return { kind: "tooLong", observed: length };
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== length + 1 || !ownKeys.includes("length")) {
      return { kind: "invalid" };
    }
    const captured: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        return { kind: "invalid" };
      }
      captured.push(descriptor.value);
    }
    return { kind: "success", value: Object.freeze(captured) };
  } catch {
    return { kind: "invalid" };
  }
}

function intrinsicByteLength(value: Uint8Array): number | undefined {
  try {
    const observed: unknown = TYPED_ARRAY_BYTE_LENGTH_GETTER?.call(value);
    return typeof observed === "number" ? observed : undefined;
  } catch {
    return undefined;
  }
}

function hasNonSharedArrayBuffer(
  value: Uint8Array,
): boolean {
  try {
    const buffer: unknown = TYPED_ARRAY_BUFFER_GETTER?.call(value);
    if (buffer === undefined) return false;
    if (SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER !== undefined) {
      try {
        SHARED_ARRAY_BUFFER_BYTE_LENGTH_GETTER.call(buffer);
        return false;
      } catch {
        // Continue with the ordinary ArrayBuffer intrinsic verdict.
      }
    }
    const byteLength: unknown = ARRAY_BUFFER_BYTE_LENGTH_GETTER?.call(buffer);
    return typeof byteLength === "number";
  } catch {
    return false;
  }
}

function charge(
  budget: DeclarativeV2MaterializationBudgetV1,
  usage: MutableUsage,
  dimension: keyof MutableUsage,
  amount: number,
  path?: string,
): Result.Result<void, DeclarativeV2MaterializationV1Error> {
  const maximum = dimension === "modules"
    ? budget.maximumModules
    : dimension === "entryBindings"
    ? budget.maximumEntryBindings
    : dimension === "sourceBytes"
    ? budget.maximumSourceBytes
    : dimension === "sourceMapBytes"
    ? budget.maximumSourceMapBytes
    : budget.maximumBytesMaterialized;
  const current = usage[dimension];
  if (amount > maximum - current) {
    return Result.fail(materializationError("materialize", "budgetExceeded", {
      dimension,
      observed: current + amount,
      maximum,
      ...(path === undefined ? {} : { path }),
    }));
  }
  usage[dimension] = current + amount;
  return Result.succeed(undefined);
}

function decodePath(
  value: unknown,
  path: string,
): Result.Result<
  DeclarativeV2ArtifactModulePathV1,
  DeclarativeV2MaterializationV1Error
> {
  return decodeDeclarativeV2ArtifactModulePathV1(value).pipe(
    Result.mapError(() =>
      materializationError("materialize", "invalidModulePath", { path })
    ),
  );
}

function decodeRoles(
  value: unknown,
  path: string,
): Result.Result<
  SourceArtifactV2ModuleRolesV1,
  DeclarativeV2MaterializationV1Error
> {
  const roles = captureDenseArray(value, 4);
  if (roles.kind !== "success" || roles.value.length === 0) {
    return Result.fail(materializationError(
      "materialize",
      "invalidRoles",
      { path },
    ));
  }
  const capturedRoles = roles.value;
  const seen = new Set<SourceArtifactV2ModuleRoleV1>();
  let mask = 0;
  for (let index = 0; index < capturedRoles.length; index += 1) {
    const role = capturedRoles[index];
    if (
      role !== "function" &&
      role !== "execution" &&
      role !== "schema" &&
      role !== "auth"
    ) {
      return Result.fail(materializationError(
        "materialize",
        "invalidRoles",
        { path: `${path}[${index}]` },
      ));
    }
    if (role === "schema" || role === "auth") {
      return Result.fail(materializationError(
        "materialize",
        "unsupportedRole",
        { path: `${path}[${index}]` },
      ));
    }
    if (seen.has(role)) {
      return Result.fail(materializationError(
        "materialize",
        "invalidRoles",
        { path: `${path}[${index}]` },
      ));
    }
    seen.add(role);
    mask |= SOURCE_ARTIFACT_V2_ROLE_BITS_V1[role];
  }
  if (!isSourceArtifactV2ModuleRolesV1(mask)) {
    throw new Error("Validated materializer roles lost their protocol mask.");
  }
  return Result.succeed(mask);
}

function decodeOwnedBytes(
  value: unknown,
  kind: "source" | "sourceMap",
  path: string,
  budget: DeclarativeV2MaterializationBudgetV1,
  usage: MutableUsage,
): Result.Result<Uint8Array, DeclarativeV2MaterializationV1Error> {
  if (!isUint8Array(value)) {
    return Result.fail(materializationError(
      "materialize",
      kind === "source" ? "invalidSourceBytes" : "invalidSourceMapBytes",
      { path },
    ));
  }
  const byteLength = intrinsicByteLength(value);
  if (
    byteLength === undefined ||
    byteLength === 0 ||
    !hasNonSharedArrayBuffer(value)
  ) {
    return Result.fail(materializationError(
      "materialize",
      kind === "source" ? "invalidSourceBytes" : "invalidSourceMapBytes",
      { path },
    ));
  }
  const dimension = kind === "source" ? "sourceBytes" : "sourceMapBytes";
  return Result.gen(function* () {
    yield* charge(budget, usage, dimension, byteLength, path);
    yield* charge(budget, usage, "bytesMaterialized", byteLength, path);
    return copyBytes(value);
  });
}

function decodeGraphModule(
  value: unknown,
  index: number,
  budget: DeclarativeV2MaterializationBudgetV1,
  usage: MutableUsage,
): Result.Result<OwnedGraphModule, DeclarativeV2MaterializationV1Error> {
  const path = `modules[${index}]`;
  const record = captureExactRecord(value, [
    "path",
    "roles",
    "sourceBytes",
    "sourceMapBytes",
  ]);
  if (record === undefined) {
    return Result.fail(materializationError(
      "materialize",
      "invalidInput",
      { path },
    ));
  }
  return Result.gen(function* () {
    const modulePath = yield* decodePath(record.path, `${path}.path`);
    const roles = yield* decodeRoles(record.roles, `${path}.roles`);
    const sourceBytes = yield* decodeOwnedBytes(
      record.sourceBytes,
      "source",
      `${path}.sourceBytes`,
      budget,
      usage,
    );
    const sourceMapBytes = record.sourceMapBytes === null
      ? null
      : yield* decodeOwnedBytes(
        record.sourceMapBytes,
        "sourceMap",
        `${path}.sourceMapBytes`,
        budget,
        usage,
      );
    return Object.freeze({
      path: modulePath,
      roles,
      sourceBytes,
      sourceMapBytes,
    });
  });
}

function decodeEntryBinding(
  value: unknown,
  index: number,
): Result.Result<OwnedEntryBinding, DeclarativeV2MaterializationV1Error> {
  const path = `functionEntries[${index}]`;
  const record = captureExactRecord(value, [
    "logicalModulePath",
    "artifactModulePath",
  ]);
  if (
    record === undefined ||
    typeof record.logicalModulePath !== "string" ||
    record.logicalModulePath.length === 0
  ) {
    return Result.fail(materializationError(
      "materialize",
      "invalidInput",
      { path },
    ));
  }
  const logicalModulePath = record.logicalModulePath;
  return decodePath(
    record.artifactModulePath,
    `${path}.artifactModulePath`,
  ).pipe(
    Result.map((artifactModulePath) => Object.freeze({
      logicalModulePath,
      artifactModulePath,
    })),
  );
}

function decodeGraph(
  value: unknown,
  budget: DeclarativeV2MaterializationBudgetV1,
  usage: MutableUsage,
): Result.Result<OwnedGraph, DeclarativeV2MaterializationV1Error> {
  const record = captureExactRecord(value, [
    "modules",
    "functionEntries",
    "executionPath",
    "schemaPath",
    "authPath",
  ]);
  if (record === undefined) {
    return Result.fail(materializationError(
      "materialize",
      "invalidInput",
    ));
  }
  const modulesCapture = captureDenseArray(
    record.modules,
    budget.maximumModules,
  );
  if (modulesCapture.kind === "tooLong") {
    return Result.fail(materializationError(
      "materialize",
      "budgetExceeded",
      {
        path: "modules",
        dimension: "modules",
        observed: modulesCapture.observed,
        maximum: budget.maximumModules,
      },
    ));
  }
  if (modulesCapture.kind === "invalid") {
    return Result.fail(materializationError(
      "materialize",
      "invalidInput",
      { path: "modules" },
    ));
  }
  const rawModules = modulesCapture.value;
  return Result.gen(function* () {
    yield* charge(budget, usage, "modules", rawModules.length, "modules");
    const modules: OwnedGraphModule[] = [];
    const modulePaths = new Set<string>();
    for (let index = 0; index < rawModules.length; index += 1) {
      const module = yield* decodeGraphModule(
        rawModules[index],
        index,
        budget,
        usage,
      );
      if (modulePaths.has(module.path)) {
        return yield* Result.fail(materializationError(
          "materialize",
          "duplicateModulePath",
          { path: `modules[${index}].path` },
        ));
      }
      modulePaths.add(module.path);
      modules.push(module);
    }
    modules.sort((left, right) => compareUtf16Strings(left.path, right.path));

    const bindingsCapture = captureDenseArray(
      record.functionEntries,
      budget.maximumEntryBindings,
    );
    if (bindingsCapture.kind === "tooLong") {
      return yield* Result.fail(materializationError(
        "materialize",
        "budgetExceeded",
        {
          path: "functionEntries",
          dimension: "entryBindings",
          observed: bindingsCapture.observed,
          maximum: budget.maximumEntryBindings,
        },
      ));
    }
    if (bindingsCapture.kind === "invalid") {
      return yield* Result.fail(materializationError(
        "materialize",
        "invalidInput",
        { path: "functionEntries" },
      ));
    }
    const rawBindings = bindingsCapture.value;
    yield* charge(
      budget,
      usage,
      "entryBindings",
      rawBindings.length,
      "functionEntries",
    );
    const functionEntries: OwnedEntryBinding[] = [];
    const logicalPaths = new Set<string>();
    const artifactPaths = new Set<string>();
    for (let index = 0; index < rawBindings.length; index += 1) {
      const binding = yield* decodeEntryBinding(rawBindings[index], index);
      if (logicalPaths.has(binding.logicalModulePath)) {
        return yield* Result.fail(materializationError(
          "materialize",
          "duplicateLogicalBinding",
          { path: `functionEntries[${index}].logicalModulePath` },
        ));
      }
      if (artifactPaths.has(binding.artifactModulePath)) {
        return yield* Result.fail(materializationError(
          "materialize",
          "duplicateArtifactBinding",
          { path: `functionEntries[${index}].artifactModulePath` },
        ));
      }
      logicalPaths.add(binding.logicalModulePath);
      artifactPaths.add(binding.artifactModulePath);
      functionEntries.push(binding);
    }
    functionEntries.sort((left, right) =>
      compareUtf16Strings(left.logicalModulePath, right.logicalModulePath)
    );
    const executionPath = yield* decodePath(
      record.executionPath,
      "executionPath",
    );
    if (record.schemaPath !== null) {
      return yield* Result.fail(materializationError(
        "materialize",
        "schemaRoleUnsupported",
        { path: "schemaPath" },
      ));
    }
    if (record.authPath !== null) {
      return yield* Result.fail(materializationError(
        "materialize",
        "authRoleUnsupported",
        { path: "authPath" },
      ));
    }
    return Object.freeze({
      modules: Object.freeze(modules),
      functionEntries: Object.freeze(functionEntries),
      executionPath,
    });
  });
}

function validateGraphAgainstProgram(
  program: CanonicalDeclarativeProgramV1,
  graph: OwnedGraph,
): Result.Result<void, DeclarativeV2MaterializationV1Error> {
  const modulesByPath = new Map(
    graph.modules.map((module) => [module.path, module] as const),
  );
  const canonicalModules = new Set<string>(
    program.modules.map((module) => module.modulePath),
  );
  const bindingsByLogical = new Map(
    graph.functionEntries.map((binding) => [
      binding.logicalModulePath,
      binding,
    ] as const),
  );
  const bindingsByArtifact = new Map(
    graph.functionEntries.map((binding) => [
      binding.artifactModulePath,
      binding,
    ] as const),
  );
  for (const binding of graph.functionEntries) {
    if (!canonicalModules.has(binding.logicalModulePath)) {
      return Result.fail(materializationError(
        "materialize",
        "unknownLogicalModule",
        { path: binding.logicalModulePath },
      ));
    }
    const module = modulesByPath.get(binding.artifactModulePath);
    if (module === undefined) {
      return Result.fail(materializationError(
        "materialize",
        "missingArtifactModule",
        { path: binding.artifactModulePath },
      ));
    }
    if ((module.roles & SOURCE_ARTIFACT_V2_ROLE_BITS_V1.function) === 0) {
      return Result.fail(materializationError(
        "materialize",
        "functionRoleRequired",
        { path: binding.artifactModulePath },
      ));
    }
  }
  for (const module of program.modules) {
    if (!bindingsByLogical.has(module.modulePath)) {
      return Result.fail(materializationError(
        "materialize",
        "missingLogicalBinding",
        { path: module.modulePath },
      ));
    }
  }
  let executionModules = 0;
  for (const module of graph.modules) {
    const isFunction =
      (module.roles & SOURCE_ARTIFACT_V2_ROLE_BITS_V1.function) !== 0;
    const isExecution =
      (module.roles & SOURCE_ARTIFACT_V2_ROLE_BITS_V1.execution) !== 0;
    if (isFunction && !bindingsByArtifact.has(module.path)) {
      return Result.fail(materializationError(
        "materialize",
        "unexpectedFunctionModule",
        { path: module.path },
      ));
    }
    if (isExecution) executionModules += 1;
  }
  if (executionModules > 1) {
    return Result.fail(materializationError(
      "materialize",
      "multipleExecutionModules",
    ));
  }
  const execution = modulesByPath.get(graph.executionPath);
  if (
    execution === undefined ||
    (execution.roles & SOURCE_ARTIFACT_V2_ROLE_BITS_V1.execution) === 0
  ) {
    return Result.fail(materializationError(
      "materialize",
      "executionRoleRequired",
      { path: graph.executionPath },
    ));
  }
  return Result.succeed(undefined);
}

function validatorJsonAsJson(value: ValidatorJsonV1): Json {
  return value;
}

function functionArgsOwner(functionPath: string): string {
  return `functionArgs:${functionPath}`;
}

function functionReturnsOwner(functionPath: string): string {
  return `functionReturns:${functionPath}`;
}

function tableDocumentOwner(tableName: string): string {
  return `tableDocument:${tableName}`;
}

function validatorId(ordinal: number): string {
  return `validator:${String(ordinal).padStart(16, "0")}`;
}

function projectedSemanticRecordCount(
  program: CanonicalDeclarativeProgramV1,
  graph: OwnedGraph,
): number {
  let functions = 0;
  let validators = program.schema.tables.length;
  for (const module of program.modules) {
    functions += module.functions.length;
    for (const fn of module.functions) {
      validators += fn.returnsValidator === null ? 1 : 2;
    }
  }
  return 2 +
    graph.modules.length +
    functions +
    program.schema.tables.length +
    program.schema.indexes.length +
    validators +
    functions;
}

function semanticRecords(
  program: CanonicalDeclarativeProgramV1,
  graph: OwnedGraph,
): ReadonlyArray<DeclarativeV2SemanticRecordV1> {
  const bindingByLogical = new Map(
    graph.functionEntries.map((binding) => [
      binding.logicalModulePath,
      binding.artifactModulePath,
    ] as const),
  );
  const functions: Array<Readonly<{
    readonly path: string;
    readonly artifactModulePath: DeclarativeV2ArtifactModulePathV1;
    readonly fn: CanonicalDeclarativeFunctionV1;
  }>> = [];
  const owners: ValidatorOwner[] = [];
  for (const module of program.modules) {
    const artifactModulePath = bindingByLogical.get(module.modulePath);
    if (artifactModulePath === undefined) {
      throw new Error("Validated materializer graph lost a logical binding.");
    }
    for (const fn of module.functions) {
      const path = canonicalDeclarativeFunctionPathV1(
        module.modulePath,
        fn.exportName,
      );
      functions.push({ path, artifactModulePath, fn });
      owners.push({ identity: functionArgsOwner(path), value: fn.argsValidator });
      if (fn.returnsValidator !== null) {
        owners.push({
          identity: functionReturnsOwner(path),
          value: fn.returnsValidator,
        });
      }
    }
  }
  for (const table of program.schema.tables) {
    owners.push({
      identity: tableDocumentOwner(table.logicalName),
      value: table.definition.documentType,
    });
  }
  functions.sort((left, right) => compareUtf16Strings(left.path, right.path));
  owners.sort((left, right) => compareUtf16Strings(
    left.identity,
    right.identity,
  ));
  const ids = new Map(
    owners.map((owner, index) => [
      owner.identity,
      validatorId(index + 1),
    ] as const),
  );
  const requireId = (identity: string): string => {
    const id = ids.get(identity);
    if (id === undefined) {
      throw new Error("Validated materializer graph lost a validator owner.");
    }
    return id;
  };
  return Object.freeze([
    { kind: "header", version: 1 },
    ...graph.modules.map((module) => ({
      kind: "module" as const,
      modulePath: module.path,
    })),
    ...functions.map(({ path, artifactModulePath, fn }) => ({
      kind: "function" as const,
      path,
      modulePath: artifactModulePath,
      exportName: fn.exportName,
      functionKind: fn.kind,
      visibility: fn.visibility,
      argsValidatorId: requireId(functionArgsOwner(path)),
      returnsValidatorId: fn.returnsValidator === null
        ? null
        : requireId(functionReturnsOwner(path)),
      partition: null,
    })),
    {
      kind: "schema",
      schemaVersion: DECLARATIVE_V2_MATERIALIZER_SCHEMA_VERSION_V1,
    },
    ...program.schema.tables.map((table) => ({
      kind: "table" as const,
      name: table.logicalName,
      documentValidatorId: requireId(tableDocumentOwner(table.logicalName)),
    })),
    ...program.schema.indexes.map((index) => ({
      kind: "index" as const,
      tableName: index.tableLogicalName,
      name: index.descriptor,
      fields: index.fields,
    })),
    ...owners.map((owner, index) => ({
      kind: "validator" as const,
      id: validatorId(index + 1),
      value: validatorJsonAsJson(owner.value),
    })),
    ...functions.map(({ path, artifactModulePath, fn }) => ({
      kind: "handler" as const,
      functionPath: path,
      modulePath: artifactModulePath,
      exportName: fn.exportName,
    })),
  ] satisfies ReadonlyArray<DeclarativeV2SemanticRecordV1>);
}

function encodeSemanticStream(
  records: ReadonlyArray<DeclarativeV2SemanticRecordV1>,
  budget: DeclarativeV2MaterializationBudgetV1,
  usage: MutableUsage,
): Result.Result<
  Readonly<{
    readonly bytes: Uint8Array;
    readonly maximumRecordBytes: number;
  }>,
  DeclarativeV2MaterializationV1Error
> {
  if (records.length > budget.maximumSemanticRecords) {
    return Result.fail(materializationError(
      "materialize",
      "budgetExceeded",
      {
        dimension: "semanticRecords",
        observed: records.length,
        maximum: budget.maximumSemanticRecords,
      },
    ));
  }
  return Result.gen(function* () {
    const lines: Uint8Array[] = [];
    let streamBytes = 0;
    let maximumRecordBytes = 0;
    for (let index = 0; index < records.length; index += 1) {
      const measured = measureDeclarativeV2SemanticRecordBytesV1(
        records[index]!,
        budget.maximumSemanticRecordBytes,
      );
      if (measured.kind === "exceeded") {
        return yield* Result.fail(materializationError(
          "materialize",
          "budgetExceeded",
          {
            path: `semantic.records[${index}]`,
            dimension: "semanticRecordBytes",
            observed: measured.observed,
            maximum: budget.maximumSemanticRecordBytes,
          },
        ));
      }
      const lineByteLength = measured.bytes;
      if (
        lineByteLength > budget.maximumSemanticStreamBytes - streamBytes
      ) {
        return yield* Result.fail(materializationError(
          "materialize",
          "budgetExceeded",
          {
            path: `semantic.records[${index}]`,
            dimension: "semanticStreamBytes",
            observed: streamBytes + lineByteLength,
            maximum: budget.maximumSemanticStreamBytes,
          },
        ));
      }
      yield* charge(
        budget,
        usage,
        "bytesMaterialized",
        lineByteLength - 1,
        `semantic.records[${index}].payload`,
      );
      yield* charge(
        budget,
        usage,
        "bytesMaterialized",
        lineByteLength,
        `semantic.records[${index}]`,
      );
      const line = encodeDeclarativeV2SemanticRecordV1(records[index]!);
      if (line.byteLength !== lineByteLength) {
        throw new Error(
          "Declarative V2 semantic record measurement drifted from encoding.",
        );
      }
      lines.push(line);
      streamBytes += lineByteLength;
      maximumRecordBytes = Math.max(maximumRecordBytes, lineByteLength);
    }
    yield* charge(
      budget,
      usage,
      "bytesMaterialized",
      streamBytes,
      "semantic.bytes",
    );
    const bytes = new Uint8Array(streamBytes);
    let offset = 0;
    for (const line of lines) {
      bytes.set(line, offset);
      offset += line.byteLength;
    }
    return Object.freeze({ bytes, maximumRecordBytes });
  });
}

export function makeDeclarativeV2MaterializationBudgetV1(
  value: unknown,
): Result.Result<
  DeclarativeV2MaterializationBudgetV1,
  DeclarativeV2MaterializationV1Error
> {
  const record = captureExactRecord(value, [
    "maximumModules",
    "maximumEntryBindings",
    "maximumSourceBytes",
    "maximumSourceMapBytes",
    "maximumBytesMaterialized",
    "maximumSemanticRecords",
    "maximumSemanticRecordBytes",
    "maximumSemanticStreamBytes",
  ]);
  if (
    record === undefined ||
    !isNonNegativeSafeInteger(record.maximumModules) ||
    !isNonNegativeSafeInteger(record.maximumEntryBindings) ||
    !isNonNegativeSafeInteger(record.maximumSourceBytes) ||
    !isNonNegativeSafeInteger(record.maximumSourceMapBytes) ||
    !isNonNegativeSafeInteger(record.maximumBytesMaterialized) ||
    !isNonNegativeSafeInteger(record.maximumSemanticRecords) ||
    !isNonNegativeSafeInteger(record.maximumSemanticRecordBytes) ||
    !isNonNegativeSafeInteger(record.maximumSemanticStreamBytes)
  ) {
    return Result.fail(materializationError(
      "createBudget",
      "invalidBudget",
    ));
  }
  const budget = brandMaterializationBudgetV1(Object.freeze({
    maximumModules: record.maximumModules,
    maximumEntryBindings: record.maximumEntryBindings,
    maximumSourceBytes: record.maximumSourceBytes,
    maximumSourceMapBytes: record.maximumSourceMapBytes,
    maximumBytesMaterialized: record.maximumBytesMaterialized,
    maximumSemanticRecords: record.maximumSemanticRecords,
    maximumSemanticRecordBytes: record.maximumSemanticRecordBytes,
    maximumSemanticStreamBytes: record.maximumSemanticStreamBytes,
  }));
  OWNED_BUDGETS.set(budget, budget);
  return Result.succeed(budget);
}

export function materializeDeclarativeV2ArtifactsV1(
  program: CanonicalDeclarativeProgramV1,
  graphInput: unknown,
  rawBudget: DeclarativeV2MaterializationBudgetV1,
): Result.Result<
  DeclarativeV2ArtifactIngressPlanV1,
  DeclarativeV2MaterializationV1Error
> {
  return Result.gen(function* () {
    const budget = rawBudget !== null && typeof rawBudget === "object"
      ? OWNED_BUDGETS.get(rawBudget)
      : undefined;
    if (budget === undefined) {
      return yield* Result.fail(materializationError(
        "materialize",
        "invalidBudget",
      ));
    }
    const usage: MutableUsage = {
      modules: 0,
      entryBindings: 0,
      sourceBytes: 0,
      sourceMapBytes: 0,
      bytesMaterialized: 0,
    };
    const graph = yield* decodeGraph(graphInput, budget, usage);
    yield* validateGraphAgainstProgram(program, graph);
    const semanticRecordCount = projectedSemanticRecordCount(program, graph);
    if (semanticRecordCount > budget.maximumSemanticRecords) {
      return yield* Result.fail(materializationError(
        "materialize",
        "budgetExceeded",
        {
          dimension: "semanticRecords",
          observed: semanticRecordCount,
          maximum: budget.maximumSemanticRecords,
        },
      ));
    }
    const records = semanticRecords(program, graph);
    if (records.length !== semanticRecordCount) {
      throw new Error(
        "Declarative V2 semantic record projection lost its preflight count.",
      );
    }
    const semantic = yield* encodeSemanticStream(records, budget, usage);
    const outputBytes =
      usage.sourceBytes + usage.sourceMapBytes + semantic.bytes.byteLength;
    const materializedModules = Object.freeze(graph.modules.map((module) =>
      Object.freeze({
        path: module.path,
        roles: module.roles,
        sourceBytes: module.sourceBytes,
        sourceMapBytes: module.sourceMapBytes,
      })
    ));
    const canonicalModules = new Map<
      string,
      CanonicalDeclarativeProgramV1["modules"][number]
    >(
      program.modules.map((module) => [module.modulePath, module] as const),
    );
    const materializedBindings = Object.freeze(graph.functionEntries.map(
      (binding) => {
        const canonical = canonicalModules.get(binding.logicalModulePath);
        if (canonical === undefined) {
          throw new Error("Validated materializer graph lost a module.");
        }
        return Object.freeze({
          logicalModulePath: canonical.modulePath,
          artifactModulePath: binding.artifactModulePath,
        });
      },
    ));
    const receipt = Object.freeze({
      modules: usage.modules,
      entryBindings: usage.entryBindings,
      sourceBytes: usage.sourceBytes,
      sourceMapBytes: usage.sourceMapBytes,
      outputBytes,
      bytesMaterialized: usage.bytesMaterialized,
      semanticRecords: records.length,
      maximumSemanticRecordBytes: semantic.maximumRecordBytes,
      semanticStreamBytes: semantic.bytes.byteLength,
    } satisfies DeclarativeV2MaterializationUsageV1);
    return Object.freeze({
      format: DECLARATIVE_V2_MATERIALIZER_FORMAT_V1,
      source: Object.freeze({
        modules: materializedModules,
        functionEntries: materializedBindings,
        executionPath: graph.executionPath,
        schemaPath: null,
        authPath: null,
      }),
      semantic: Object.freeze({
        bytes: semantic.bytes,
        recordCount: records.length,
        maximumRecordBytes: semantic.maximumRecordBytes,
      }),
      usage: receipt,
    });
  });
}
