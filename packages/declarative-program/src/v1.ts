import { compareUtf16Strings } from "@flarex/utils/strings";
import { Data, Result, Schema } from "effect";
import {
  decodeSchemaManifestAppIndexDeclarationsV1Result,
  decodeSchemaManifestAppTableDeclarationsV1Result,
  MAX_SCHEMA_MANIFEST_APP_INDEX_DECLARED_FIELDS,
  MAX_SCHEMA_MANIFEST_APP_INDEXES,
  MAX_SCHEMA_MANIFEST_APP_INDEXES_PER_TABLE,
  MAX_SCHEMA_MANIFEST_APP_TABLES,
  MAX_SCHEMA_MANIFEST_NESTING_DEPTH,
  type SchemaManifestAppIndexDeclarationInputV1,
  type SchemaManifestAppIndexDeclarationV1,
  type SchemaManifestAppTableDeclarationInputV1,
  type SchemaManifestAppTableDeclarationV1,
} from "flarex-protocol/schema-manifest";
import {
  ValidatorJsonV1,
  type ObjectValidatorJsonV1,
  type ValidatorJsonV1 as ValidatorJsonV1Type,
} from "flarex-protocol/validator-json";

export const CANONICAL_DECLARATIVE_PROGRAM_FORMAT_V1 =
  "flarex.declarative-program/v1" as const;
export const CANONICAL_DECLARATIVE_PROGRAM_VERSION_V1 = 1 as const;

declare const CanonicalDeclarativeModulePathV1Brand: unique symbol;
declare const CanonicalDeclarativeExportNameV1Brand: unique symbol;
declare const CanonicalDeclarativeProgramV1Brand: unique symbol;
declare const CanonicalDeclarativeProgramBudgetV1Brand: unique symbol;

export type CanonicalDeclarativeModulePathV1 = string & {
  readonly [CanonicalDeclarativeModulePathV1Brand]: true;
};

export type CanonicalDeclarativeExportNameV1 = string & {
  readonly [CanonicalDeclarativeExportNameV1Brand]: true;
};

export type CanonicalDeclarativeFunctionKindV1 =
  | "query"
  | "mutation"
  | "workflowMutation"
  | "action";

export type CanonicalDeclarativeFunctionVisibilityV1 =
  | "public"
  | "internal";

export type CanonicalDeclarativeArgsValidatorV1 =
  | ObjectValidatorJsonV1
  | Readonly<{ readonly type: "any" }>;

export interface CanonicalDeclarativeFunctionInputV1 {
  readonly exportName: string;
  readonly kind: CanonicalDeclarativeFunctionKindV1;
  readonly visibility: CanonicalDeclarativeFunctionVisibilityV1;
  readonly argsValidator: unknown;
  readonly returnsValidator: unknown;
}

export interface CanonicalDeclarativeModuleInputV1 {
  readonly modulePath: string;
  readonly functions: ReadonlyArray<CanonicalDeclarativeFunctionInputV1>;
}

export interface CanonicalDeclarativeSchemaInputV1 {
  readonly tables: ReadonlyArray<SchemaManifestAppTableDeclarationInputV1>;
  readonly indexes: ReadonlyArray<SchemaManifestAppIndexDeclarationInputV1>;
}

export interface CanonicalDeclarativeProgramInputV1 {
  readonly format: typeof CANONICAL_DECLARATIVE_PROGRAM_FORMAT_V1;
  readonly version: typeof CANONICAL_DECLARATIVE_PROGRAM_VERSION_V1;
  readonly schema: CanonicalDeclarativeSchemaInputV1;
  readonly modules: ReadonlyArray<CanonicalDeclarativeModuleInputV1>;
}

export interface CanonicalDeclarativeFunctionV1 {
  readonly exportName: CanonicalDeclarativeExportNameV1;
  readonly kind: CanonicalDeclarativeFunctionKindV1;
  readonly visibility: CanonicalDeclarativeFunctionVisibilityV1;
  readonly argsValidator: CanonicalDeclarativeArgsValidatorV1;
  readonly returnsValidator: ValidatorJsonV1Type | null;
}

export interface CanonicalDeclarativeModuleV1 {
  readonly modulePath: CanonicalDeclarativeModulePathV1;
  readonly functions: ReadonlyArray<CanonicalDeclarativeFunctionV1>;
}

export interface CanonicalDeclarativeSchemaV1 {
  readonly tables: ReadonlyArray<SchemaManifestAppTableDeclarationV1>;
  readonly indexes: ReadonlyArray<SchemaManifestAppIndexDeclarationV1>;
}

export type CanonicalDeclarativeProgramV1 = Readonly<{
  readonly format: typeof CANONICAL_DECLARATIVE_PROGRAM_FORMAT_V1;
  readonly version: typeof CANONICAL_DECLARATIVE_PROGRAM_VERSION_V1;
  readonly schema: CanonicalDeclarativeSchemaV1;
  readonly modules: ReadonlyArray<CanonicalDeclarativeModuleV1>;
  readonly [CanonicalDeclarativeProgramV1Brand]: true;
}>;

export interface CanonicalDeclarativeProgramBudgetInputV1 {
  readonly maximumModules: number;
  readonly maximumFunctions: number;
  readonly maximumIdentifierUtf8Bytes: number;
  readonly maximumValidatorNodes: number;
  readonly maximumValidatorDepth: number;
  readonly maximumValidatorStringUtf8Bytes: number;
}

export interface CanonicalDeclarativeProgramBudgetV1 {
  readonly [CanonicalDeclarativeProgramBudgetV1Brand]: true;
  readonly maximumModules: number;
  readonly maximumFunctions: number;
  readonly maximumIdentifierUtf8Bytes: number;
  readonly maximumValidatorNodes: number;
  readonly maximumValidatorDepth: number;
  readonly maximumValidatorStringUtf8Bytes: number;
}

export type CanonicalDeclarativeProgramBudgetDimensionV1 =
  | "modules"
  | "functions"
  | "identifierUtf8Bytes"
  | "validatorNodes"
  | "validatorDepth"
  | "validatorStringUtf8Bytes";

export type CanonicalDeclarativeProgramV1ErrorReason =
  | "invalidBudget"
  | "invalidInput"
  | "invalidFormat"
  | "invalidModulePath"
  | "invalidExportName"
  | "invalidFunctionKind"
  | "invalidVisibility"
  | "invalidValidator"
  | "invalidSchema"
  | "duplicateModulePath"
  | "duplicateFunctionPath"
  | "unknownIndexTable"
  | "budgetExceeded";

export class CanonicalDeclarativeProgramV1Error extends Data.TaggedError(
  "CanonicalDeclarativeProgramV1Error",
)<{
  readonly operation: "createBudget" | "decodeProgram";
  readonly reason: CanonicalDeclarativeProgramV1ErrorReason;
  readonly path?: string;
  readonly dimension?: CanonicalDeclarativeProgramBudgetDimensionV1;
  readonly observed?: number;
  readonly maximum?: number;
  readonly cause?: unknown;
}> {}

const TEXT_ENCODER = new TextEncoder();
const OWNED_BUDGETS = new WeakMap<object, CanonicalDeclarativeProgramBudgetV1>();
const decodeValidatorJsonV1Result = Schema.decodeUnknownResult(ValidatorJsonV1);

interface DecodeUsage {
  functions: number;
  identifierUtf8Bytes: number;
  validatorNodes: number;
  validatorStringUtf8Bytes: number;
}

interface DecodeContext {
  readonly budget: CanonicalDeclarativeProgramBudgetV1;
  readonly usage: DecodeUsage;
}

type ExactRecord = Readonly<Record<string, unknown>>;
type DenseArrayFailure =
  | Readonly<{ readonly reason: "invalid" }>
  | Readonly<{ readonly reason: "budget"; readonly observed: number }>;

type CanonicalDeclarativeProgramV1ErrorDetails = Readonly<{
  readonly path?: string;
  readonly dimension?: CanonicalDeclarativeProgramBudgetDimensionV1;
  readonly observed?: number;
  readonly maximum?: number;
  readonly cause?: unknown;
}>;

function programError(
  operation: CanonicalDeclarativeProgramV1Error["operation"],
  reason: CanonicalDeclarativeProgramV1ErrorReason,
  details: CanonicalDeclarativeProgramV1ErrorDetails = {},
): CanonicalDeclarativeProgramV1Error {
  return new CanonicalDeclarativeProgramV1Error({
    operation,
    reason,
    ...details,
  });
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value >= 0;
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
    if (prototype !== Object.prototype && prototype !== null) {
      return undefined;
    }
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

function captureOpenRecord(value: unknown): ExactRecord | undefined {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return undefined;
    }
    const ownKeys = Reflect.ownKeys(value);
    if (!ownKeys.every((key) => typeof key === "string")) {
      return undefined;
    }
    const captured: Record<string, unknown> = Object.create(null);
    for (const key of ownKeys) {
      if (typeof key !== "string") return undefined;
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
): Result.Result<ReadonlyArray<unknown>, DenseArrayFailure> {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
      return Result.fail({ reason: "invalid" });
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (
      lengthDescriptor === undefined ||
      !("value" in lengthDescriptor) ||
      typeof lengthDescriptor.value !== "number"
    ) {
      return Result.fail({ reason: "invalid" });
    }
    const length = lengthDescriptor.value;
    if (length > maximum) {
      return Result.fail({ reason: "budget", observed: length });
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.length !== length + 1) {
      return Result.fail({ reason: "invalid" });
    }
    const output: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const key = String(index);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined ||
        !descriptor.enumerable ||
        !("value" in descriptor)
      ) {
        return Result.fail({ reason: "invalid" });
      }
      output.push(descriptor.value);
    }
    if (
      ownKeys.some((key) =>
        typeof key !== "string" ||
        (key !== "length" && !/^(0|[1-9][0-9]*)$/.test(key))
      )
    ) {
      return Result.fail({ reason: "invalid" });
    }
    return Result.succeed(output);
  } catch {
    return Result.fail({ reason: "invalid" });
  }
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

function chargeUtf8(
  context: DecodeContext,
  kind: "identifierUtf8Bytes" | "validatorStringUtf8Bytes",
  value: string,
  path: string,
): Result.Result<void, CanonicalDeclarativeProgramV1Error> {
  if (hasUnpairedSurrogate(value)) {
    return Result.fail(programError("decodeProgram", "invalidInput", { path }));
  }
  const observed = context.usage[kind] + TEXT_ENCODER.encode(value).byteLength;
  const maximum = kind === "identifierUtf8Bytes"
    ? context.budget.maximumIdentifierUtf8Bytes
    : context.budget.maximumValidatorStringUtf8Bytes;
  if (observed > maximum) {
    return Result.fail(programError("decodeProgram", "budgetExceeded", {
      path,
      dimension: kind,
      observed,
      maximum,
    }));
  }
  context.usage[kind] = observed;
  return Result.succeed(undefined);
}

function chargeValidatorNode(
  context: DecodeContext,
  depth: number,
  path: string,
): Result.Result<void, CanonicalDeclarativeProgramV1Error> {
  if (depth > context.budget.maximumValidatorDepth) {
    return Result.fail(programError("decodeProgram", "budgetExceeded", {
      path,
      dimension: "validatorDepth",
      observed: depth,
      maximum: context.budget.maximumValidatorDepth,
    }));
  }
  const observed = context.usage.validatorNodes + 1;
  if (observed > context.budget.maximumValidatorNodes) {
    return Result.fail(programError("decodeProgram", "budgetExceeded", {
      path,
      dimension: "validatorNodes",
      observed,
      maximum: context.budget.maximumValidatorNodes,
    }));
  }
  context.usage.validatorNodes = observed;
  return Result.succeed(undefined);
}

function isCanonicalModulePath(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    hasUnpairedSurrogate(value) ||
    value.includes("\\") ||
    value.includes(":") ||
    value.includes("\0") ||
    value.startsWith("/") ||
    value.endsWith("/")
  ) {
    return false;
  }
  const segments = value.split("/");
  return segments.every((segment) =>
    segment.length > 0 &&
    segment !== "." &&
    segment !== ".." &&
    !segment.startsWith(".") &&
    !segment.startsWith("#") &&
    !/[\u0000-\u001f\u007f]/.test(segment)
  );
}

function isCanonicalExportName(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    !hasUnpairedSurrogate(value) &&
    !value.includes(":") &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function isFunctionKind(
  value: unknown,
): value is CanonicalDeclarativeFunctionKindV1 {
  return value === "query" ||
    value === "mutation" ||
    value === "workflowMutation" ||
    value === "action";
}

function isFunctionVisibility(
  value: unknown,
): value is CanonicalDeclarativeFunctionVisibilityV1 {
  return value === "public" || value === "internal";
}

function decodeValidator(
  value: unknown,
  context: DecodeContext,
  depth: number,
  path: string,
): Result.Result<ValidatorJsonV1Type, CanonicalDeclarativeProgramV1Error> {
  return decodeValidatorCandidate(value, context, depth, path).pipe(
    Result.flatMap((candidate) =>
      decodeValidatorJsonV1Result(candidate).pipe(
        Result.mapError((cause) =>
          programError("decodeProgram", "invalidValidator", { path, cause })
        ),
      )
    ),
  );
}

function decodeValidatorCandidate(
  value: unknown,
  context: DecodeContext,
  depth: number,
  path: string,
): Result.Result<ValidatorJsonV1Type, CanonicalDeclarativeProgramV1Error> {
  return Result.gen(function* () {
    yield* chargeValidatorNode(context, depth, path);
    const typeRecord = captureOpenRecord(value);
    if (typeRecord === undefined || typeof typeRecord.type !== "string") {
      return yield* Result.fail(
        programError("decodeProgram", "invalidValidator", { path }),
      );
    }

    let candidate: ValidatorJsonV1Type;
    switch (typeRecord.type) {
      case "null":
      case "number":
      case "bigint":
      case "boolean":
      case "string":
      case "bytes":
      case "any": {
        const record = captureExactRecord(value, ["type"]);
        if (record === undefined) {
          return yield* Result.fail(
            programError("decodeProgram", "invalidValidator", { path }),
          );
        }
        candidate = { type: typeRecord.type };
        break;
      }
      case "id": {
        const record = captureExactRecord(value, ["type", "tableName"]);
        if (
          record === undefined ||
          typeof record.tableName !== "string" ||
          record.tableName.length === 0
        ) {
          return yield* Result.fail(
            programError("decodeProgram", "invalidValidator", { path }),
          );
        }
        yield* chargeUtf8(
          context,
          "identifierUtf8Bytes",
          record.tableName,
          `${path}.tableName`,
        );
        candidate = { type: "id", tableName: record.tableName };
        break;
      }
      case "literal": {
        const record = captureExactRecord(value, ["type", "value"]);
        if (
          record === undefined ||
          !(
            typeof record.value === "string" ||
            typeof record.value === "number" ||
            typeof record.value === "boolean"
          ) ||
          (typeof record.value === "number" &&
            (!Number.isFinite(record.value) || Object.is(record.value, -0)))
        ) {
          return yield* Result.fail(
            programError("decodeProgram", "invalidValidator", { path }),
          );
        }
        if (typeof record.value === "string") {
          yield* chargeUtf8(
            context,
            "validatorStringUtf8Bytes",
            record.value,
            `${path}.value`,
          );
        }
        candidate = { type: "literal", value: record.value };
        break;
      }
      case "array": {
        const record = captureExactRecord(value, ["type", "value"]);
        if (record === undefined) {
          return yield* Result.fail(
            programError("decodeProgram", "invalidValidator", { path }),
          );
        }
        candidate = {
          type: "array",
          value: yield* decodeValidatorCandidate(
            record.value,
            context,
            depth + 1,
            `${path}.value`,
          ),
        };
        break;
      }
      case "record": {
        const record = captureExactRecord(value, ["type", "keys", "values"]);
        if (record === undefined) {
          return yield* Result.fail(
            programError("decodeProgram", "invalidValidator", { path }),
          );
        }
        candidate = {
          type: "record",
          keys: yield* decodeValidatorCandidate(
            record.keys,
            context,
            depth + 1,
            `${path}.keys`,
          ),
          values: yield* decodeValidatorCandidate(
            record.values,
            context,
            depth + 1,
            `${path}.values`,
          ),
        };
        break;
      }
      case "union": {
        const record = captureExactRecord(value, ["type", "value"]);
        if (record === undefined) {
          return yield* Result.fail(
            programError("decodeProgram", "invalidValidator", { path }),
          );
        }
        const members = yield* captureDenseArray(
          record.value,
          context.budget.maximumValidatorNodes - context.usage.validatorNodes,
        ).pipe(
          Result.mapError((failure) =>
            programError(
              "decodeProgram",
              failure.reason === "budget"
                ? "budgetExceeded"
                : "invalidValidator",
              failure.reason === "budget"
                ? {
                  path: `${path}.value`,
                  dimension: "validatorNodes",
                  observed:
                    context.usage.validatorNodes + failure.observed,
                  maximum: context.budget.maximumValidatorNodes,
                }
                : { path: `${path}.value` },
            )
          ),
        );
        const decodedMembers: ValidatorJsonV1Type[] = [];
        for (let index = 0; index < members.length; index += 1) {
          decodedMembers.push(yield* decodeValidatorCandidate(
            members[index],
            context,
            depth + 1,
            `${path}.value[${index}]`,
          ));
        }
        candidate = { type: "union", value: decodedMembers };
        break;
      }
      case "object": {
        const record = captureExactRecord(value, ["type", "value"]);
        const fields = record === undefined
          ? undefined
          : captureOpenRecord(record.value);
        if (record === undefined || fields === undefined) {
          return yield* Result.fail(
            programError("decodeProgram", "invalidValidator", { path }),
          );
        }
        const decodedFields: Record<
          string,
          { readonly fieldType: ValidatorJsonV1Type; readonly optional: boolean }
        > = Object.create(null);
        const fieldNames = Object.keys(fields).sort(compareUtf16Strings);
        for (const fieldName of fieldNames) {
          yield* chargeUtf8(
            context,
            "identifierUtf8Bytes",
            fieldName,
            `${path}.value`,
          );
          const field = captureExactRecord(
            fields[fieldName],
            ["fieldType", "optional"],
          );
          if (field === undefined || typeof field.optional !== "boolean") {
            return yield* Result.fail(
              programError("decodeProgram", "invalidValidator", {
                path: `${path}.value.${fieldName}`,
              }),
            );
          }
          Object.defineProperty(decodedFields, fieldName, {
            enumerable: true,
            value: {
              fieldType: yield* decodeValidatorCandidate(
                field.fieldType,
                context,
                depth + 1,
                `${path}.value.${fieldName}.fieldType`,
              ),
              optional: field.optional,
            },
          });
        }
        candidate = { type: "object", value: decodedFields };
        break;
      }
      default:
        return yield* Result.fail(
          programError("decodeProgram", "invalidValidator", { path }),
        );
    }

    return candidate;
  });
}

function snapshotValidator(
  validator: ObjectValidatorJsonV1,
): ObjectValidatorJsonV1;
function snapshotValidator(
  validator: CanonicalDeclarativeArgsValidatorV1,
): CanonicalDeclarativeArgsValidatorV1;
function snapshotValidator(
  validator: ValidatorJsonV1Type,
): ValidatorJsonV1Type;
function snapshotValidator(
  validator: ValidatorJsonV1Type,
): ValidatorJsonV1Type {
  switch (validator.type) {
    case "null":
    case "number":
    case "bigint":
    case "boolean":
    case "string":
    case "bytes":
    case "any":
      return Object.freeze({ type: validator.type });
    case "id":
      return Object.freeze({
        type: "id",
        tableName: validator.tableName,
      });
    case "literal":
      return Object.freeze({
        type: "literal",
        value: validator.value,
      });
    case "array":
      return Object.freeze({
        type: "array",
        value: snapshotValidator(validator.value),
      });
    case "record":
      return Object.freeze({
        type: "record",
        keys: snapshotValidator(validator.keys),
        values: snapshotValidator(validator.values),
      });
    case "union":
      return Object.freeze({
        type: "union",
        value: Object.freeze(validator.value.map(snapshotValidator)),
      });
    case "object": {
      const fields: Record<
        string,
        { readonly fieldType: ValidatorJsonV1Type; readonly optional: boolean }
      > = Object.create(null);
      for (
        const [fieldName, field] of Object.entries(validator.value)
          .sort(([left], [right]) => compareUtf16Strings(left, right))
      ) {
        Object.defineProperty(fields, fieldName, {
          enumerable: true,
          value: Object.freeze({
            fieldType: snapshotValidator(field.fieldType),
            optional: field.optional,
          }),
        });
      }
      return Object.freeze({
        type: "object",
        value: Object.freeze(fields),
      });
    }
  }
}

function decodeTable(
  value: unknown,
  context: DecodeContext,
  index: number,
): Result.Result<
  SchemaManifestAppTableDeclarationV1,
  CanonicalDeclarativeProgramV1Error
> {
  return Result.gen(function* () {
    const path = `schema.tables[${index}]`;
    const record = captureExactRecord(value, ["logicalName", "definition"]);
    const definition = record === undefined
      ? undefined
      : captureExactRecord(record.definition, [
        "kind",
        "definitionVersion",
        "documentType",
      ]);
    if (
      record === undefined ||
      definition === undefined ||
      typeof record.logicalName !== "string" ||
      definition.kind !== "appDocument" ||
      definition.definitionVersion !== 1
    ) {
      return yield* Result.fail(
        programError("decodeProgram", "invalidSchema", { path }),
      );
    }
    yield* chargeUtf8(
      context,
      "identifierUtf8Bytes",
      record.logicalName,
      `${path}.logicalName`,
    );
    const documentType = yield* decodeValidator(
      definition.documentType,
      context,
      1,
      `${path}.definition.documentType`,
    );
    if (documentType.type !== "object") {
      return yield* Result.fail(
        programError("decodeProgram", "invalidSchema", {
          path: `${path}.definition.documentType`,
        }),
      );
    }
    const decoded = yield* decodeSchemaManifestAppTableDeclarationsV1Result([{
      logicalName: record.logicalName,
      definition: {
        kind: "appDocument",
        definitionVersion: 1,
        documentType,
      },
    }]).pipe(
      Result.mapError((cause) =>
        programError("decodeProgram", "invalidSchema", { path, cause })
      ),
    );
    const table = decoded[0];
    if (table === undefined) {
      return yield* Result.fail(
        programError("decodeProgram", "invalidSchema", { path }),
      );
    }
    return Object.freeze({
      logicalName: table.logicalName,
      definition: Object.freeze({
        kind: "appDocument",
        definitionVersion: 1,
        documentType: snapshotValidator(table.definition.documentType),
      }),
    });
  });
}

function decodeIndex(
  value: unknown,
  context: DecodeContext,
  index: number,
): Result.Result<
  SchemaManifestAppIndexDeclarationV1,
  CanonicalDeclarativeProgramV1Error
> {
  return Result.gen(function* () {
    const path = `schema.indexes[${index}]`;
    const record = captureExactRecord(value, [
      "tableLogicalName",
      "descriptor",
      "fields",
    ]);
    if (
      record === undefined ||
      typeof record.tableLogicalName !== "string" ||
      typeof record.descriptor !== "string"
    ) {
      return yield* Result.fail(
        programError("decodeProgram", "invalidSchema", { path }),
      );
    }
    yield* chargeUtf8(
      context,
      "identifierUtf8Bytes",
      record.tableLogicalName,
      `${path}.tableLogicalName`,
    );
    yield* chargeUtf8(
      context,
      "identifierUtf8Bytes",
      record.descriptor,
      `${path}.descriptor`,
    );
    const rawFields = yield* captureDenseArray(
      record.fields,
      MAX_SCHEMA_MANIFEST_APP_INDEX_DECLARED_FIELDS,
    ).pipe(
      Result.mapError(() =>
        programError("decodeProgram", "invalidSchema", {
          path: `${path}.fields`,
        })
      ),
    );
    const fields: string[] = [];
    for (let fieldIndex = 0; fieldIndex < rawFields.length; fieldIndex += 1) {
      const field = rawFields[fieldIndex];
      if (typeof field !== "string") {
        return yield* Result.fail(
          programError("decodeProgram", "invalidSchema", {
            path: `${path}.fields[${fieldIndex}]`,
          }),
        );
      }
      yield* chargeUtf8(
        context,
        "identifierUtf8Bytes",
        field,
        `${path}.fields[${fieldIndex}]`,
      );
      fields.push(field);
    }
    const decoded = yield* decodeSchemaManifestAppIndexDeclarationsV1Result([{
      tableLogicalName: record.tableLogicalName,
      descriptor: record.descriptor,
      fields,
    }]).pipe(
      Result.mapError((cause) =>
        programError("decodeProgram", "invalidSchema", { path, cause })
      ),
    );
    const declaration = decoded[0];
    if (declaration === undefined) {
      return yield* Result.fail(
        programError("decodeProgram", "invalidSchema", { path }),
      );
    }
    return Object.freeze({
      tableLogicalName: declaration.tableLogicalName,
      descriptor: declaration.descriptor,
      fields: Object.freeze([...declaration.fields]),
    });
  });
}

function decodeFunction(
  value: unknown,
  context: DecodeContext,
  modulePath: CanonicalDeclarativeModulePathV1,
  index: number,
): Result.Result<
  CanonicalDeclarativeFunctionV1,
  CanonicalDeclarativeProgramV1Error
> {
  return Result.gen(function* () {
    const path = `modules.${modulePath}.functions[${index}]`;
    const record = captureExactRecord(value, [
      "exportName",
      "kind",
      "visibility",
      "argsValidator",
      "returnsValidator",
    ]);
    if (record === undefined) {
      return yield* Result.fail(
        programError("decodeProgram", "invalidInput", { path }),
      );
    }
    if (!isCanonicalExportName(record.exportName)) {
      return yield* Result.fail(
        programError("decodeProgram", "invalidExportName", {
          path: `${path}.exportName`,
        }),
      );
    }
    yield* chargeUtf8(
      context,
      "identifierUtf8Bytes",
      record.exportName,
      `${path}.exportName`,
    );
    if (!isFunctionKind(record.kind)) {
      return yield* Result.fail(
        programError("decodeProgram", "invalidFunctionKind", {
          path: `${path}.kind`,
        }),
      );
    }
    if (!isFunctionVisibility(record.visibility)) {
      return yield* Result.fail(
        programError("decodeProgram", "invalidVisibility", {
          path: `${path}.visibility`,
        }),
      );
    }
    const argsValidator = yield* decodeValidator(
      record.argsValidator,
      context,
      1,
      `${path}.argsValidator`,
    );
    if (argsValidator.type !== "object" && argsValidator.type !== "any") {
      return yield* Result.fail(
        programError("decodeProgram", "invalidValidator", {
          path: `${path}.argsValidator`,
        }),
      );
    }
    const returnsValidator = record.returnsValidator === null
      ? null
      : yield* decodeValidator(
        record.returnsValidator,
        context,
        1,
        `${path}.returnsValidator`,
      );
    const ownedArgsValidator: CanonicalDeclarativeArgsValidatorV1 =
      argsValidator.type === "object"
        ? snapshotValidator(argsValidator)
        : Object.freeze({ type: "any" });
    return Object.freeze({
      exportName: record.exportName as CanonicalDeclarativeExportNameV1,
      kind: record.kind,
      visibility: record.visibility,
      argsValidator: ownedArgsValidator,
      returnsValidator:
        returnsValidator === null ? null : snapshotValidator(returnsValidator),
    });
  });
}

function decodeModule(
  value: unknown,
  context: DecodeContext,
  index: number,
  seenModulePaths: Set<string>,
  seenFunctionPaths: Set<string>,
): Result.Result<
  CanonicalDeclarativeModuleV1,
  CanonicalDeclarativeProgramV1Error
> {
  return Result.gen(function* () {
    const path = `modules[${index}]`;
    const record = captureExactRecord(value, ["modulePath", "functions"]);
    if (record === undefined) {
      return yield* Result.fail(
        programError("decodeProgram", "invalidInput", { path }),
      );
    }
    if (!isCanonicalModulePath(record.modulePath)) {
      return yield* Result.fail(
        programError("decodeProgram", "invalidModulePath", {
          path: `${path}.modulePath`,
        }),
      );
    }
    if (seenModulePaths.has(record.modulePath)) {
      return yield* Result.fail(
        programError("decodeProgram", "duplicateModulePath", {
          path: record.modulePath,
        }),
      );
    }
    seenModulePaths.add(record.modulePath);
    yield* chargeUtf8(
      context,
      "identifierUtf8Bytes",
      record.modulePath,
      `${path}.modulePath`,
    );
    const remainingFunctions =
      context.budget.maximumFunctions - context.usage.functions;
    const rawFunctions = yield* captureDenseArray(
      record.functions,
      remainingFunctions,
    ).pipe(
      Result.mapError((failure) =>
        programError(
          "decodeProgram",
          failure.reason === "budget" ? "budgetExceeded" : "invalidInput",
          failure.reason === "budget"
            ? {
              path: `${path}.functions`,
              dimension: "functions",
              observed: context.usage.functions + failure.observed,
              maximum: context.budget.maximumFunctions,
            }
            : { path: `${path}.functions` },
        )
      ),
    );
    context.usage.functions += rawFunctions.length;
    const modulePath =
      record.modulePath as CanonicalDeclarativeModulePathV1;
    const functions: CanonicalDeclarativeFunctionV1[] = [];
    for (let functionIndex = 0; functionIndex < rawFunctions.length; functionIndex += 1) {
      const fn = yield* decodeFunction(
        rawFunctions[functionIndex],
        context,
        modulePath,
        functionIndex,
      );
      const functionPath = canonicalDeclarativeFunctionPathV1(
        modulePath,
        fn.exportName,
      );
      if (seenFunctionPaths.has(functionPath)) {
        return yield* Result.fail(
          programError("decodeProgram", "duplicateFunctionPath", {
            path: functionPath,
          }),
        );
      }
      seenFunctionPaths.add(functionPath);
      functions.push(fn);
    }
    functions.sort((left, right) =>
      compareUtf16Strings(left.exportName, right.exportName)
    );
    return Object.freeze({
      modulePath,
      functions: Object.freeze(functions),
    });
  });
}

export function makeCanonicalDeclarativeProgramBudgetV1(
  value: unknown,
): Result.Result<
  CanonicalDeclarativeProgramBudgetV1,
  CanonicalDeclarativeProgramV1Error
> {
  const record = captureExactRecord(value, [
    "maximumModules",
    "maximumFunctions",
    "maximumIdentifierUtf8Bytes",
    "maximumValidatorNodes",
    "maximumValidatorDepth",
    "maximumValidatorStringUtf8Bytes",
  ]);
  if (
    record === undefined ||
    !isNonNegativeSafeInteger(record.maximumModules) ||
    !isNonNegativeSafeInteger(record.maximumFunctions) ||
    !isNonNegativeSafeInteger(record.maximumIdentifierUtf8Bytes) ||
    !isNonNegativeSafeInteger(record.maximumValidatorNodes) ||
    !isNonNegativeSafeInteger(record.maximumValidatorDepth) ||
    record.maximumValidatorDepth === 0 ||
    record.maximumValidatorDepth > MAX_SCHEMA_MANIFEST_NESTING_DEPTH ||
    !isNonNegativeSafeInteger(record.maximumValidatorStringUtf8Bytes)
  ) {
    return Result.fail(
      programError("createBudget", "invalidBudget"),
    );
  }
  const budget = Object.freeze({
    maximumModules: record.maximumModules,
    maximumFunctions: record.maximumFunctions,
    maximumIdentifierUtf8Bytes: record.maximumIdentifierUtf8Bytes,
    maximumValidatorNodes: record.maximumValidatorNodes,
    maximumValidatorDepth: record.maximumValidatorDepth,
    maximumValidatorStringUtf8Bytes:
      record.maximumValidatorStringUtf8Bytes,
  }) as CanonicalDeclarativeProgramBudgetV1;
  OWNED_BUDGETS.set(budget, budget);
  return Result.succeed(budget);
}

export function canonicalDeclarativeFunctionPathV1(
  modulePath: CanonicalDeclarativeModulePathV1,
  exportName: CanonicalDeclarativeExportNameV1,
): string {
  return exportName === "default"
    ? modulePath
    : `${modulePath}:${exportName}`;
}

export function decodeCanonicalDeclarativeProgramV1(
  value: unknown,
  rawBudget: CanonicalDeclarativeProgramBudgetV1,
): Result.Result<
  CanonicalDeclarativeProgramV1,
  CanonicalDeclarativeProgramV1Error
> {
  return Result.gen(function* () {
    const budget = rawBudget !== null && typeof rawBudget === "object"
      ? OWNED_BUDGETS.get(rawBudget)
      : undefined;
    if (budget === undefined) {
      return yield* Result.fail(
        programError("decodeProgram", "invalidBudget"),
      );
    }
    const record = captureExactRecord(value, [
      "format",
      "version",
      "schema",
      "modules",
    ]);
    if (record === undefined) {
      return yield* Result.fail(
        programError("decodeProgram", "invalidInput"),
      );
    }
    if (
      record.format !== CANONICAL_DECLARATIVE_PROGRAM_FORMAT_V1 ||
      record.version !== CANONICAL_DECLARATIVE_PROGRAM_VERSION_V1
    ) {
      return yield* Result.fail(
        programError("decodeProgram", "invalidFormat"),
      );
    }
    const context: DecodeContext = {
      budget,
      usage: {
        functions: 0,
        identifierUtf8Bytes: 0,
        validatorNodes: 0,
        validatorStringUtf8Bytes: 0,
      },
    };
    const schemaRecord = captureExactRecord(record.schema, [
      "tables",
      "indexes",
    ]);
    if (schemaRecord === undefined) {
      return yield* Result.fail(
        programError("decodeProgram", "invalidSchema", { path: "schema" }),
      );
    }
    const rawTables = yield* captureDenseArray(
      schemaRecord.tables,
      MAX_SCHEMA_MANIFEST_APP_TABLES,
    ).pipe(
      Result.mapError(() =>
        programError("decodeProgram", "invalidSchema", {
          path: "schema.tables",
        })
      ),
    );
    const rawIndexes = yield* captureDenseArray(
      schemaRecord.indexes,
      MAX_SCHEMA_MANIFEST_APP_INDEXES,
    ).pipe(
      Result.mapError(() =>
        programError("decodeProgram", "invalidSchema", {
          path: "schema.indexes",
        })
      ),
    );
    const tables: SchemaManifestAppTableDeclarationV1[] = [];
    const tableNames = new Set<string>();
    for (let index = 0; index < rawTables.length; index += 1) {
      const table = yield* decodeTable(rawTables[index], context, index);
      if (tableNames.has(table.logicalName)) {
        return yield* Result.fail(
          programError("decodeProgram", "invalidSchema", {
            path: `schema.tables[${index}].logicalName`,
          }),
        );
      }
      tableNames.add(table.logicalName);
      tables.push(table);
    }
    yield* decodeSchemaManifestAppTableDeclarationsV1Result(tables).pipe(
      Result.mapError((cause) =>
        programError("decodeProgram", "invalidSchema", {
          path: "schema.tables",
          cause,
        })
      ),
    );
    tables.sort((left, right) =>
      compareUtf16Strings(left.logicalName, right.logicalName)
    );

    const indexes: SchemaManifestAppIndexDeclarationV1[] = [];
    const indexDescriptorsByTable = new Map<string, Set<string>>();
    const indexFieldListsByTable = new Map<string, Set<string>>();
    const indexCountByTable = new Map<string, number>();
    for (let index = 0; index < rawIndexes.length; index += 1) {
      const declaration = yield* decodeIndex(
        rawIndexes[index],
        context,
        index,
      );
      const descriptors = indexDescriptorsByTable.get(
        declaration.tableLogicalName,
      ) ?? new Set<string>();
      if (descriptors.has(declaration.descriptor)) {
        return yield* Result.fail(
          programError("decodeProgram", "invalidSchema", {
            path: `schema.indexes[${index}].descriptor`,
          }),
        );
      }
      descriptors.add(declaration.descriptor);
      indexDescriptorsByTable.set(declaration.tableLogicalName, descriptors);
      const fieldLists = indexFieldListsByTable.get(
        declaration.tableLogicalName,
      ) ?? new Set<string>();
      const fieldListIdentity = JSON.stringify(declaration.fields);
      if (fieldLists.has(fieldListIdentity)) {
        return yield* Result.fail(
          programError("decodeProgram", "invalidSchema", {
            path: `schema.indexes[${index}].fields`,
          }),
        );
      }
      fieldLists.add(fieldListIdentity);
      indexFieldListsByTable.set(declaration.tableLogicalName, fieldLists);
      const nextTableIndexCount =
        (indexCountByTable.get(declaration.tableLogicalName) ?? 0) + 1;
      if (nextTableIndexCount > MAX_SCHEMA_MANIFEST_APP_INDEXES_PER_TABLE) {
        return yield* Result.fail(
          programError("decodeProgram", "invalidSchema", {
            path: `schema.indexes[${index}]`,
          }),
        );
      }
      indexCountByTable.set(
        declaration.tableLogicalName,
        nextTableIndexCount,
      );
      if (!tableNames.has(declaration.tableLogicalName)) {
        return yield* Result.fail(
          programError("decodeProgram", "unknownIndexTable", {
            path: `schema.indexes[${index}].tableLogicalName`,
          }),
        );
      }
      indexes.push(declaration);
    }
    yield* decodeSchemaManifestAppIndexDeclarationsV1Result(indexes).pipe(
      Result.mapError((cause) =>
        programError("decodeProgram", "invalidSchema", {
          path: "schema.indexes",
          cause,
        })
      ),
    );
    indexes.sort((left, right) => {
      const table = compareUtf16Strings(
        left.tableLogicalName,
        right.tableLogicalName,
      );
      return table !== 0
        ? table
        : compareUtf16Strings(left.descriptor, right.descriptor);
    });
    const rawModules = yield* captureDenseArray(
      record.modules,
      budget.maximumModules,
    ).pipe(
      Result.mapError((failure) =>
        programError(
          "decodeProgram",
          failure.reason === "budget" ? "budgetExceeded" : "invalidInput",
          failure.reason === "budget"
            ? {
              path: "modules",
              dimension: "modules",
              observed: failure.observed,
              maximum: budget.maximumModules,
            }
            : { path: "modules" },
        )
      ),
    );
    const modules: CanonicalDeclarativeModuleV1[] = [];
    const modulePaths = new Set<string>();
    const functionPaths = new Set<string>();
    for (let index = 0; index < rawModules.length; index += 1) {
      modules.push(yield* decodeModule(
        rawModules[index],
        context,
        index,
        modulePaths,
        functionPaths,
      ));
    }
    modules.sort((left, right) =>
      compareUtf16Strings(left.modulePath, right.modulePath)
    );

    return Object.freeze({
      format: CANONICAL_DECLARATIVE_PROGRAM_FORMAT_V1,
      version: CANONICAL_DECLARATIVE_PROGRAM_VERSION_V1,
      schema: Object.freeze({
        tables: Object.freeze(tables),
        indexes: Object.freeze(indexes),
      }),
      modules: Object.freeze(modules),
    }) as CanonicalDeclarativeProgramV1;
  });
}

export function makeCanonicalDeclarativeProgramFixtureV1(
  value: unknown,
  budget: CanonicalDeclarativeProgramBudgetV1,
): Result.Result<
  CanonicalDeclarativeProgramV1,
  CanonicalDeclarativeProgramV1Error
> {
  return decodeCanonicalDeclarativeProgramV1(value, budget);
}
