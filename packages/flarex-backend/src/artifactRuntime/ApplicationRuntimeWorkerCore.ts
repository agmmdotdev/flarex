import {
  ApplicationImportForbiddenEffectV1,
  installApplicationImportPolicyV1,
} from "@flarex/analysis/internal/application-import-policy-v1";

export * from "flarex/server";
export * from "flarex/values";

const ARRAY_IS_ARRAY = Array.isArray;
const JSON_PARSE = JSON.parse;
const OBJECT_FREEZE = Object.freeze;
const OBJECT_GET_OWN_PROPERTY_DESCRIPTOR = Object.getOwnPropertyDescriptor;
const OBJECT_GET_PROTOTYPE_OF = Object.getPrototypeOf;
const OBJECT_PROTOTYPE = Object.prototype;
const REFLECT_APPLY = Reflect.apply;
const REFLECT_OWN_KEYS = Reflect.ownKeys;

export interface ApplicationRuntimeFunctionResolutionV1Input {
  readonly executionModules: unknown;
  readonly function: Readonly<{
    readonly path: string;
    readonly moduleName: string;
    readonly exportName: string;
    readonly kind: "query" | "mutation" | "workflowMutation" | "action";
    readonly visibility: "public" | "internal";
    readonly args: unknown;
    readonly returns: unknown;
    readonly partition: unknown;
  }>;
}

export type ApplicationRuntimeFunctionResolutionV1 = Readonly<{
  readonly kind: "resolved";
  readonly path: string;
  readonly functionKind: ApplicationRuntimeFunctionResolutionV1Input["function"]["kind"];
  readonly visibility: ApplicationRuntimeFunctionResolutionV1Input["function"]["visibility"];
}> | Readonly<{
  readonly kind: "rejected";
  readonly reason:
    | "invalidExecutionModule"
    | "missingModule"
    | "missingExport"
    | "invalidRegistration"
    | "wrongKind"
    | "wrongVisibility"
    | "metadataMismatch"
    | "moduleImportFailed"
    | "forbiddenImportEffect";
}>;

export interface ApplicationRuntimeColdResolutionV1Input {
  readonly loadExecution: () => Promise<unknown>;
  readonly function: ApplicationRuntimeFunctionResolutionV1Input["function"];
}

export async function runApplicationRuntimeColdResolutionV1(
  input: ApplicationRuntimeColdResolutionV1Input,
): Promise<ApplicationRuntimeFunctionResolutionV1> {
  const policy = installApplicationImportPolicyV1();
  try {
    let executionModule: unknown;
    try {
      executionModule = await input.loadExecution();
    } catch (cause) {
      return cause instanceof ApplicationImportForbiddenEffectV1 ||
          policy.forbiddenAttempted()
        ? rejected("forbiddenImportEffect")
        : rejected("moduleImportFailed");
    }
    if (policy.forbiddenAttempted()) {
      return rejected("forbiddenImportEffect");
    }
    const moduleRecord = asRecord(executionModule);
    if (moduleRecord === undefined) return rejected("invalidExecutionModule");
    const loadedDefault = ownDataValue(moduleRecord, "default");
    const resolution = loadedDefault.kind === "value"
      ? resolveApplicationRuntimeFunctionV1({
        executionModules: loadedDefault.value,
        function: input.function,
      })
      : rejected("invalidExecutionModule");
    return policy.forbiddenAttempted()
      ? rejected("forbiddenImportEffect")
      : resolution;
  } catch (cause) {
    if (
      cause instanceof ApplicationImportForbiddenEffectV1 ||
      policy.forbiddenAttempted()
    ) return rejected("forbiddenImportEffect");
    throw cause;
  } finally {
    policy.restore();
  }
}

/** Resolves registration authority without invoking application code. */
export function resolveApplicationRuntimeFunctionV1(
  input: ApplicationRuntimeFunctionResolutionV1Input,
): ApplicationRuntimeFunctionResolutionV1 {
  const executionModules = asRecord(input.executionModules);
  if (executionModules === undefined) return rejected("invalidExecutionModule");
  const applicationModule = ownDataValue(
    executionModules,
    input.function.moduleName,
  );
  if (applicationModule.kind !== "value") return rejected("missingModule");
  const applicationModuleRecord = asRecord(applicationModule.value);
  if (applicationModuleRecord === undefined) return rejected("missingModule");
  const registered = ownDataValue(
    applicationModuleRecord,
    input.function.exportName,
  );
  if (registered.kind !== "value") return rejected("missingExport");
  const registration = asRecord(registered.value);
  if (registration === undefined) return rejected("invalidRegistration");
  const marker = ownDataValue(registration, "__flarexFunction");
  const publicMarker = ownDataValue(registration, "isFlarexFunction");
  const handler = ownDataValue(registration, "handler");
  const privateHandler = ownDataValue(registration, "_handler");
  if (
    marker.kind !== "value" || marker.value !== true ||
    publicMarker.kind !== "value" || publicMarker.value !== true ||
    handler.kind !== "value" || typeof handler.value !== "function" ||
    privateHandler.kind !== "value" || privateHandler.value !== handler.value
  ) return rejected("invalidRegistration");
  const kind = ownDataValue(registration, "kind");
  if (kind.kind !== "value" || kind.value !== input.function.kind) {
    return rejected("wrongKind");
  }
  const visibility = ownDataValue(registration, "visibility");
  if (
    visibility.kind !== "value" ||
    visibility.value !== input.function.visibility
  ) return rejected("wrongVisibility");
  try {
    const args = exportedJson(registration, "exportArgs");
    const returns = exportedJson(registration, "exportReturns");
    const partition = exportedJson(registration, "exportPartition");
    if (
      args.kind !== "value" || returns.kind !== "value" ||
      partition.kind !== "value" ||
      !plainDataEqual(args.value, input.function.args) ||
      !plainDataEqual(returns.value, input.function.returns) ||
      !partitionMatches(
        partition.value,
        input.function.partition,
        input.function.args,
      )
    ) return rejected("metadataMismatch");
  } catch {
    return rejected("invalidRegistration");
  }
  return OBJECT_FREEZE({
    kind: "resolved",
    path: input.function.path,
    functionKind: input.function.kind,
    visibility: input.function.visibility,
  });
}

function exportedJson(
  registration: Record<string, unknown>,
  name: "exportArgs" | "exportReturns" | "exportPartition",
): OwnDataValue {
  const exporter = ownDataValue(registration, name);
  if (exporter.kind !== "value" || typeof exporter.value !== "function") {
    return { kind: "missing" };
  }
  const serialized = REFLECT_APPLY(exporter.value, registration, []);
  return typeof serialized === "string"
    ? { kind: "value", value: JSON_PARSE(serialized) as unknown }
    : { kind: "missing" };
}

function partitionMatches(
  observed: unknown,
  expected: unknown,
  expectedArgs: unknown,
): boolean {
  if (plainDataEqual(observed, expected)) return true;
  const observedRecord = asRecord(observed);
  const expectedRecord = asRecord(expected);
  if (observedRecord === undefined || expectedRecord === undefined) {
    return false;
  }
  if (observedRecord.type !== "partitionRoot") return false;
  if (expectedRecord.type === "partitionCreateRoot") {
    return observedRecord.table === expectedRecord.table &&
      observedRecord.partitionField === expectedRecord.partitionField;
  }
  return expectedRecord.type === "partition" &&
    observedRecord.table === expectedRecord.table &&
    observedRecord.partitionField === "_id" &&
    expectedRecord.partitionField === "_id" &&
    expectedRecord.selector === "byId" &&
    typeof expectedRecord.argField === "string" &&
    typeof expectedRecord.table === "string" &&
    hasRequiredIdArgument(
      expectedArgs,
      expectedRecord.argField,
      expectedRecord.table,
    );
}

function hasRequiredIdArgument(
  args: unknown,
  field: string,
  table: string,
): boolean {
  const argsRecord = asRecord(args);
  if (argsRecord?.type !== "object") return false;
  const fields = asRecord(argsRecord.value);
  if (fields === undefined) return false;
  const member = ownDataValue(fields, field);
  if (member.kind !== "value") return false;
  const fieldRecord = asRecord(member.value);
  const fieldType = fieldRecord === undefined
    ? undefined
    : ownDataValue(fieldRecord, "fieldType");
  const id = fieldType?.kind === "value"
    ? asRecord(fieldType.value)
    : undefined;
  return fieldRecord?.optional === false && id?.type === "id" &&
    id.tableName === table;
}

function plainDataEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (
    typeof left !== "object" || left === null ||
    typeof right !== "object" || right === null ||
    ARRAY_IS_ARRAY(left) !== ARRAY_IS_ARRAY(right)
  ) return false;
  const leftRecord = asRecord(left);
  const rightRecord = asRecord(right);
  if (ARRAY_IS_ARRAY(left) && ARRAY_IS_ARRAY(right)) {
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      const leftMember = ownDataValue(left, String(index));
      const rightMember = ownDataValue(right, String(index));
      if (
        leftMember.kind !== "value" || rightMember.kind !== "value" ||
        !plainDataEqual(leftMember.value, rightMember.value)
      ) return false;
    }
    return true;
  }
  if (leftRecord === undefined || rightRecord === undefined) return false;
  const leftKeys = REFLECT_OWN_KEYS(leftRecord);
  const rightKeys = REFLECT_OWN_KEYS(rightRecord);
  if (
    leftKeys.length !== rightKeys.length ||
    leftKeys.some(key => typeof key !== "string") ||
    rightKeys.some(key => typeof key !== "string")
  ) return false;
  const rightSet = new Set(rightKeys);
  for (const key of leftKeys) {
    if (typeof key !== "string" || !rightSet.has(key)) return false;
    const leftMember = ownDataValue(leftRecord, key);
    const rightMember = ownDataValue(rightRecord, key);
    if (
      leftMember.kind !== "value" || rightMember.kind !== "value" ||
      !plainDataEqual(leftMember.value, rightMember.value)
    ) return false;
  }
  return true;
}

function rejected(
  reason: Extract<ApplicationRuntimeFunctionResolutionV1, {
    readonly kind: "rejected";
  }>["reason"],
): ApplicationRuntimeFunctionResolutionV1 {
  return OBJECT_FREEZE({ kind: "rejected", reason });
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || ARRAY_IS_ARRAY(value)) {
    return undefined;
  }
  const prototype = OBJECT_GET_PROTOTYPE_OF(value);
  return prototype === OBJECT_PROTOTYPE || prototype === null
    ? value as Record<string, unknown>
    : undefined;
}

type OwnDataValue = Readonly<{ readonly kind: "missing" }> |
  Readonly<{ readonly kind: "value"; readonly value: unknown }>;

function ownDataValue(value: object, key: string): OwnDataValue {
  const descriptor = OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(value, key);
  return descriptor !== undefined && "value" in descriptor
    ? { kind: "value", value: descriptor.value }
    : { kind: "missing" };
}
