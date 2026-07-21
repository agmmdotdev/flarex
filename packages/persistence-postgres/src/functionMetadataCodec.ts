import {
  bytesEqualFullScan,
  isUint8Array,
} from "@flarex/utils/bytes";
import {
  isNonArrayRecord,
  type UnknownRecord,
} from "@flarex/utils/records";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { Data, Result } from "effect";
import {
  encodeCanonicalJson,
  isJsonArray,
  isJsonObject,
  type CanonicalJsonEncodingInvariantIssue,
  type Json,
  type JsonObject,
} from "flarex-protocol/json";
import {
  FlarexValueCodecV1Error,
  flarexValueToJsonV1,
  jsonToFlarexValueV1,
} from "flarex-protocol/value";
import type { ValidatorJsonV1 } from "flarex-protocol/validator-json";

const FUNCTION_METADATA_FORMAT_V1 = "flarex.function-metadata";
const FUNCTION_METADATA_SET_FORMAT_V1 = "flarex.function-metadata-set";
const FUNCTION_METADATA_CODEC_VERSION_V1 = 1;

const UTF8_ENCODER = new TextEncoder();
const FATAL_UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

type FunctionMetadataKindV1 =
  | "query"
  | "mutation"
  | "action"
  | "workflowMutation";
type FunctionMetadataVisibilityV1 = "public" | "internal";

export interface FunctionMetadataOperationBudgetV1 {
  readonly maximumFunctionsVisited: number;
  readonly maximumValidatorNodesVisited: number;
  readonly maximumCanonicalUtf8BytesMaterialized: number;
}

export interface FunctionMetadataRouteV1 {
  readonly type: "args";
  readonly field: string;
}

export type FunctionMetadataPartitionV1 =
  | {
      readonly type: "partition";
      readonly table: string;
      readonly selector: string;
      readonly partitionField: string;
      readonly argField: string;
    }
  | {
      readonly type: "partitionCreateRoot";
      readonly table: string;
      readonly partitionField: "_id";
    };

export interface FunctionMetadataPositionV1 {
  readonly path: string;
  readonly startLine: number;
  readonly startColumn: number;
}

export interface FunctionMetadataV1 {
  readonly format: typeof FUNCTION_METADATA_FORMAT_V1;
  readonly version: typeof FUNCTION_METADATA_CODEC_VERSION_V1;
  readonly functionPath: string;
  readonly executionModule: string;
  readonly kind: FunctionMetadataKindV1;
  readonly visibility: FunctionMetadataVisibilityV1;
  readonly argsValidator: ValidatorJsonV1;
  readonly returnsValidator: ValidatorJsonV1 | null;
  readonly route: FunctionMetadataRouteV1 | null;
  readonly partition: FunctionMetadataPartitionV1 | null;
  readonly position: FunctionMetadataPositionV1 | null;
}

export interface CanonicalFunctionMetadataV1 {
  readonly ordinal: number;
  readonly metadata: FunctionMetadataV1;
  readonly canonicalText: string;
  readonly canonicalBytes: Uint8Array;
}

export interface CanonicalFunctionMetadataSetV1 {
  readonly format: typeof FUNCTION_METADATA_SET_FORMAT_V1;
  readonly version: typeof FUNCTION_METADATA_CODEC_VERSION_V1;
  readonly functions: ReadonlyArray<CanonicalFunctionMetadataV1>;
  readonly canonicalText: string;
  readonly canonicalBytes: Uint8Array;
  readonly functionsVisited: number;
  readonly validatorNodesVisited: number;
  readonly canonicalUtf8BytesMaterialized: number;
}

export type FunctionMetadataInvalidV1Issue = Readonly<{
  readonly path: string;
  readonly detail: string;
}>;

export class FunctionMetadataInvalidV1Error extends Data.TaggedError(
  "FunctionMetadataInvalidV1Error",
)<{
  readonly issue: FunctionMetadataInvalidV1Issue;
}> {}

export class FunctionMetadataDuplicatePathV1Error extends Data.TaggedError(
  "FunctionMetadataDuplicatePathV1Error",
)<{
  readonly functionPath: string;
  readonly firstIndex: number;
  readonly duplicateIndex: number;
}> {}

export type FunctionMetadataNonCanonicalBytesV1Reason =
  | "invalidBytes"
  | "invalidUtf8"
  | "invalidJson"
  | "invalidShape"
  | "nonCanonical";

export class FunctionMetadataNonCanonicalBytesV1Error extends Data.TaggedError(
  "FunctionMetadataNonCanonicalBytesV1Error",
)<{
  readonly reason: FunctionMetadataNonCanonicalBytesV1Reason;
  readonly detail: string;
}> {}

export type FunctionMetadataOperationBudgetDimensionV1 =
  | "functionsVisited"
  | "validatorNodesVisited"
  | "canonicalUtf8BytesMaterialized";

export class FunctionMetadataOperationBudgetV1Error extends Data.TaggedError(
  "FunctionMetadataOperationBudgetV1Error",
)<{
  readonly dimension: FunctionMetadataOperationBudgetDimensionV1;
  readonly observed: number;
  readonly maximum: number;
}> {}

export type FunctionMetadataCodecV1Error =
  | FunctionMetadataInvalidV1Error
  | FunctionMetadataDuplicatePathV1Error
  | FunctionMetadataNonCanonicalBytesV1Error
  | FunctionMetadataOperationBudgetV1Error;

interface CodecState {
  readonly budget: FunctionMetadataOperationBudgetV1;
  functionsVisited: number;
  validatorNodesVisited: number;
  canonicalUtf8BytesMaterialized: number;
}

interface ParsedFunction {
  readonly sourceIndex: number;
  readonly metadata: FunctionMetadataV1;
  readonly json: JsonObject;
}

interface ParsedValidator {
  readonly validator: ValidatorJsonV1;
  readonly json: Json;
}

interface OwnProperty {
  readonly present: boolean;
  readonly value: unknown;
}

export function decodeFunctionMetadataOperationBudgetV1(
  input: unknown,
): Result.Result<
  FunctionMetadataOperationBudgetV1,
  FunctionMetadataInvalidV1Error
> {
  return Result.gen(function* () {
    const record = yield* requireRecord(input, "$budget");
    const maximumFunctionsVisited = yield* requirePositiveSafeInteger(
      yield* requireOwnValue(record, "maximumFunctionsVisited", "$budget"),
      "$budget.maximumFunctionsVisited",
    );
    const maximumValidatorNodesVisited = yield* requirePositiveSafeInteger(
      yield* requireOwnValue(
        record,
        "maximumValidatorNodesVisited",
        "$budget",
      ),
      "$budget.maximumValidatorNodesVisited",
    );
    const maximumCanonicalUtf8BytesMaterialized =
      yield* requirePositiveSafeInteger(
        yield* requireOwnValue(
          record,
          "maximumCanonicalUtf8BytesMaterialized",
          "$budget",
        ),
        "$budget.maximumCanonicalUtf8BytesMaterialized",
      );
    return Object.freeze({
      maximumFunctionsVisited,
      maximumValidatorNodesVisited,
      maximumCanonicalUtf8BytesMaterialized,
    });
  });
}

export function encodeFunctionMetadataSetV1(
  input: unknown,
  budget: unknown,
): Result.Result<CanonicalFunctionMetadataSetV1, FunctionMetadataCodecV1Error> {
  return Result.gen(function* () {
    const validatedBudget = yield* decodeFunctionMetadataOperationBudgetV1(
      budget,
    );
    const state = createCodecState(validatedBudget);
    const root = yield* requireRecord(input, "$functions");
    const functions = yield* requireArray(
      yield* requireOwnValue(root, "functions", "$functions"),
      "$functions.functions",
    );
    yield* preflightFunctionCount(functions.length, state);

    const seen = new Map<string, number>();
    const parsed: ParsedFunction[] = [];
    for (let index = 0; index < functions.length; index += 1) {
      chargeFunctionVisit(state);
      const candidate = yield* requireDenseArrayItem(
        functions,
        index,
        "$functions.functions",
      );
      const parsedFunction = yield* parseSourceFunction(
        candidate,
        index,
        seen,
        state,
      );
      parsed.push(parsedFunction);
    }

    parsed.sort((left, right) =>
      compareUtf16Strings(
        left.metadata.functionPath,
        right.metadata.functionPath,
      ),
    );
    return yield* materializeSet(parsed, state);
  });
}

export function decodeCanonicalFunctionMetadataSetV1(
  input: unknown,
  budget: unknown,
): Result.Result<CanonicalFunctionMetadataSetV1, FunctionMetadataCodecV1Error> {
  return Result.gen(function* () {
    const validatedBudget = yield* decodeFunctionMetadataOperationBudgetV1(
      budget,
    );
    const state = createCodecState(validatedBudget);
    if (!isUint8Array(input)) {
      return yield* Result.fail(nonCanonical(
        "invalidBytes",
        "stored Function Metadata V1 evidence must be a Uint8Array",
      ));
    }
    const ownedInput = yield* captureBoundedIntrinsicBytes(
      input,
      validatedBudget.maximumCanonicalUtf8BytesMaterialized,
    );
    yield* chargeCanonicalBytes(state, ownedInput.length);
    const text = yield* decodeFatalUtf8(ownedInput);
    const decoded = yield* parseJson(text);
    const root = yield* requireStoredRecord(decoded, "$set");
    yield* requireStoredLiteral(
      root,
      "format",
      FUNCTION_METADATA_SET_FORMAT_V1,
      "$set",
    );
    yield* requireStoredLiteral(
      root,
      "version",
      FUNCTION_METADATA_CODEC_VERSION_V1,
      "$set",
    );
    const functions = yield* requireStoredArray(
      yield* requireStoredOwnValue(root, "functions", "$set"),
      "$set.functions",
    );
    yield* preflightFunctionCount(functions.length, state);

    const parsed: ParsedFunction[] = [];
    const seen = new Map<string, number>();
    for (let index = 0; index < functions.length; index += 1) {
      chargeFunctionVisit(state);
      const candidate = yield* requireStoredDenseArrayItem(
        functions,
        index,
        "$set.functions",
      );
      const parsedFunction = yield* parseStoredFunction(
        candidate,
        index,
        seen,
        state,
      );
      parsed.push(parsedFunction);
    }

    const expectedOrder = [...parsed].sort((left, right) =>
      compareUtf16Strings(
        left.metadata.functionPath,
        right.metadata.functionPath,
      ),
    );
    for (let index = 0; index < parsed.length; index += 1) {
      if (parsed[index]?.metadata.functionPath !== expectedOrder[index]?.metadata.functionPath) {
        return yield* Result.fail(nonCanonical(
          "invalidShape",
          "stored Function Metadata V1 functions are not in canonical path order",
        ));
      }
    }

    const canonical = yield* materializeSet(parsed, state);
    if (!bytesEqualFullScan(ownedInput, canonical.canonicalBytes)) {
      return yield* Result.fail(nonCanonical(
        "nonCanonical",
        "stored Function Metadata V1 bytes do not match canonical re-encoding",
      ));
    }
    return canonical;
  });
}

function parseSourceFunction(
  input: unknown,
  sourceIndex: number,
  seen: Map<string, number>,
  state: CodecState,
): Result.Result<ParsedFunction, FunctionMetadataCodecV1Error> {
  const path = `$functions.functions[${sourceIndex}]`;
  return Result.gen(function* () {
    const record = yield* requireRecord(input, path);
    const functionPath = yield* requireNonemptyString(
      yield* requireOwnValue(record, "path", path),
      `${path}.path`,
    );
    yield* rejectDuplicate(functionPath, sourceIndex, seen);
    const executionModule = yield* executionModuleFromFunctionPath(
      functionPath,
      `${path}.path`,
    );
    const kind = yield* requireFunctionKind(
      yield* requireOwnValue(record, "kind", path),
      `${path}.kind`,
    );
    const visibilityProperty = yield* readOwnProperty(record, "visibility", path);
    const visibility = visibilityProperty.present &&
        visibilityProperty.value !== undefined &&
        visibilityProperty.value !== null
      ? yield* requireFunctionVisibility(
          visibilityProperty.value,
          `${path}.visibility`,
        )
      : "public";
    const argsProperty = yield* readOwnProperty(record, "args", path);
    const argsValidator =
      !argsProperty.present ||
        argsProperty.value === undefined ||
        argsProperty.value === null
        ? anyValidator()
        : yield* parseSourceValidator(
            argsProperty.value,
            `${path}.args`,
            state,
          );
    const returnsProperty = yield* readOwnProperty(record, "returns", path);
    const returnsValidator =
      !returnsProperty.present ||
        returnsProperty.value === undefined ||
        returnsProperty.value === null
        ? null
        : yield* parseSourceValidator(
            returnsProperty.value,
            `${path}.returns`,
            state,
          );
    const routeProperty = yield* readOwnProperty(record, "route", path);
    const route =
      !routeProperty.present ||
        routeProperty.value === undefined ||
        routeProperty.value === null
        ? null
        : yield* parseRoute(routeProperty.value, `${path}.route`);
    const partitionProperty = yield* readOwnProperty(record, "partition", path);
    const partition =
      !partitionProperty.present ||
        partitionProperty.value === undefined ||
        partitionProperty.value === null
        ? null
        : yield* parsePartition(
            partitionProperty.value,
            `${path}.partition`,
          );
    const positionProperty = yield* readOwnProperty(record, "position", path);
    const position = !positionProperty.present ||
        positionProperty.value === undefined
      ? null
      : yield* parsePosition(positionProperty.value, `${path}.position`);

    return buildParsedFunction({
      sourceIndex,
      functionPath,
      executionModule,
      kind,
      visibility,
      argsValidator,
      returnsValidator,
      route,
      partition,
      position,
    });
  });
}

function parseStoredFunction(
  input: unknown,
  sourceIndex: number,
  seen: Map<string, number>,
  state: CodecState,
): Result.Result<ParsedFunction, FunctionMetadataCodecV1Error> {
  const path = `$set.functions[${sourceIndex}]`;
  return Result.gen(function* () {
    const record = yield* requireStoredRecord(input, path);
    yield* requireStoredLiteral(
      record,
      "format",
      FUNCTION_METADATA_FORMAT_V1,
      path,
    );
    yield* requireStoredLiteral(
      record,
      "version",
      FUNCTION_METADATA_CODEC_VERSION_V1,
      path,
    );
    const functionPath = yield* requireStoredNonemptyString(
      yield* requireStoredOwnValue(record, "functionPath", path),
      `${path}.functionPath`,
    );
    yield* rejectDuplicate(functionPath, sourceIndex, seen);
    const executionModule = yield* requireStoredNonemptyString(
      yield* requireStoredOwnValue(record, "executionModule", path),
      `${path}.executionModule`,
    );
    const expectedExecutionModule = yield* executionModuleFromStoredFunctionPath(
      functionPath,
      `${path}.functionPath`,
    );
    if (executionModule !== expectedExecutionModule) {
      return yield* Result.fail(nonCanonical(
        "invalidShape",
        `${path}.executionModule does not match the function path`,
      ));
    }
    const kind = yield* requireStoredFunctionKind(
      yield* requireStoredOwnValue(record, "kind", path),
      `${path}.kind`,
    );
    const visibility = yield* requireStoredFunctionVisibility(
      yield* requireStoredOwnValue(record, "visibility", path),
      `${path}.visibility`,
    );
    const argsValidator = yield* parseStoredValidator(
      yield* requireStoredOwnValue(record, "argsValidator", path),
      `${path}.argsValidator`,
      state,
    );
    const returnsValue = yield* requireStoredOwnValue(
      record,
      "returnsValidator",
      path,
    );
    const returnsValidator = returnsValue === null
      ? null
      : yield* parseStoredValidator(
          returnsValue,
          `${path}.returnsValidator`,
          state,
        );
    const routeValue = yield* requireStoredOwnValue(record, "route", path);
    const route = routeValue === null
      ? null
      : yield* parseStoredRoute(routeValue, `${path}.route`);
    const partitionValue = yield* requireStoredOwnValue(
      record,
      "partition",
      path,
    );
    const partition = partitionValue === null
      ? null
      : yield* parseStoredPartition(partitionValue, `${path}.partition`);
    const positionValue = yield* requireStoredOwnValue(record, "position", path);
    const position = positionValue === null
      ? null
      : yield* parseStoredPosition(positionValue, `${path}.position`);

    return buildParsedFunction({
      sourceIndex,
      functionPath,
      executionModule,
      kind,
      visibility,
      argsValidator,
      returnsValidator,
      route,
      partition,
      position,
    });
  });
}

function buildParsedFunction(input: {
  readonly sourceIndex: number;
  readonly functionPath: string;
  readonly executionModule: string;
  readonly kind: FunctionMetadataKindV1;
  readonly visibility: FunctionMetadataVisibilityV1;
  readonly argsValidator: ParsedValidator;
  readonly returnsValidator: ParsedValidator | null;
  readonly route: FunctionMetadataRouteV1 | null;
  readonly partition: FunctionMetadataPartitionV1 | null;
  readonly position: FunctionMetadataPositionV1 | null;
}): ParsedFunction {
  const metadata = Object.freeze({
    format: FUNCTION_METADATA_FORMAT_V1,
    version: FUNCTION_METADATA_CODEC_VERSION_V1,
    functionPath: input.functionPath,
    executionModule: input.executionModule,
    kind: input.kind,
    visibility: input.visibility,
    argsValidator: input.argsValidator.validator,
    returnsValidator: input.returnsValidator?.validator ?? null,
    route: input.route,
    partition: input.partition,
    position: input.position,
  } satisfies FunctionMetadataV1);
  const json = Object.freeze({
    format: FUNCTION_METADATA_FORMAT_V1,
    version: FUNCTION_METADATA_CODEC_VERSION_V1,
    functionPath: input.functionPath,
    executionModule: input.executionModule,
    kind: input.kind,
    visibility: input.visibility,
    argsValidator: input.argsValidator.json,
    returnsValidator: input.returnsValidator?.json ?? null,
    route: routeToJson(input.route),
    partition: partitionToJson(input.partition),
    position: positionToJson(input.position),
  } satisfies JsonObject);
  return Object.freeze({ sourceIndex: input.sourceIndex, metadata, json });
}

function routeToJson(route: FunctionMetadataRouteV1 | null): Json {
  return route === null
    ? null
    : Object.freeze({ type: route.type, field: route.field });
}

function partitionToJson(partition: FunctionMetadataPartitionV1 | null): Json {
  if (partition === null) return null;
  return partition.type === "partitionCreateRoot"
    ? Object.freeze({
        type: partition.type,
        table: partition.table,
        partitionField: partition.partitionField,
      })
    : Object.freeze({
        type: partition.type,
        table: partition.table,
        selector: partition.selector,
        partitionField: partition.partitionField,
        argField: partition.argField,
      });
}

function positionToJson(position: FunctionMetadataPositionV1 | null): Json {
  return position === null
    ? null
    : Object.freeze({
        path: position.path,
        startLine: position.startLine,
        startColumn: position.startColumn,
      });
}

function parseSourceValidator(
  input: unknown,
  path: string,
  state: CodecState,
): Result.Result<ParsedValidator, FunctionMetadataCodecV1Error> {
  return parseValidator(input, path, state, "source");
}

function parseStoredValidator(
  input: unknown,
  path: string,
  state: CodecState,
): Result.Result<ParsedValidator, FunctionMetadataCodecV1Error> {
  return parseValidator(input, path, state, "stored");
}

function parseValidator(
  input: unknown,
  path: string,
  state: CodecState,
  boundary: "source" | "stored",
): Result.Result<ParsedValidator, FunctionMetadataCodecV1Error> {
  type ValidatorAction = () => Result.Result<
    void,
    FunctionMetadataCodecV1Error
  >;
  type ValidatorInputLoader = () => Result.Result<
    unknown,
    FunctionMetadataCodecV1Error
  >;

  const actions: ValidatorAction[] = [];
  let parsedRoot: ParsedValidator | undefined;

  const scheduleAssignment = (
    assign: (parsed: ParsedValidator) => void,
    parsed: ParsedValidator,
  ): void => {
    actions.push(() => {
      assign(parsed);
      return Result.succeed(undefined);
    });
  };

  const scheduleParseFrom = (
    loadCandidate: ValidatorInputLoader,
    candidatePath: string,
    assign: (parsed: ParsedValidator) => void,
  ): void => {
    actions.push(() => Result.gen(function* () {
      yield* chargeValidatorNode(state);
      const candidate = yield* loadCandidate();
      const record = boundary === "source"
        ? yield* requireRecord(candidate, candidatePath)
        : yield* requireStoredRecord(candidate, candidatePath);
      const typeValue = boundary === "source"
        ? yield* requireOwnValue(record, "type", candidatePath)
        : yield* requireStoredOwnValue(record, "type", candidatePath);
      if (typeof typeValue !== "string") {
        return yield* Result.fail(boundaryError(
          boundary,
          `${candidatePath}.type`,
          "validator type must be a string",
        ));
      }
      if (isSimpleValidatorType(typeValue)) {
        const validator: ValidatorJsonV1 = Object.freeze({ type: typeValue });
        scheduleAssignment(assign, Object.freeze({ validator, json: validator }));
        return;
      }
      switch (typeValue) {
        case "id": {
          const tableName = yield* boundaryNonemptyString(
            boundary,
            yield* boundaryOwnValue(
              boundary,
              record,
              "tableName",
              candidatePath,
            ),
            `${candidatePath}.tableName`,
          );
          const validator = Object.freeze({ type: "id", tableName } as const);
          scheduleAssignment(assign, Object.freeze({ validator, json: validator }));
          return;
        }
        case "literal": {
          const literalInput = yield* boundaryOwnValue(
            boundary,
            record,
            "value",
            candidatePath,
          );
          const literal = boundary === "source"
            ? yield* encodeSourceLiteral(
                literalInput,
                `${candidatePath}.value`,
              )
            : yield* decodeStoredLiteral(
                literalInput,
                `${candidatePath}.value`,
              );
          const validator = Object.freeze({
            type: "literal",
            value: literal.value,
          } as const);
          const json = Object.freeze({
            type: "literal",
            value: literal.json,
          } satisfies JsonObject);
          scheduleAssignment(assign, Object.freeze({ validator, json }));
          return;
        }
        case "array": {
          scheduleParseFrom(
            () => boundaryOwnValue(
              boundary,
              record,
              "value",
              candidatePath,
            ),
            `${candidatePath}.value`,
            (child) => {
              const validator = Object.freeze({
                type: "array",
                value: child.validator,
              } as const);
              const json = Object.freeze({
                type: "array",
                value: child.json,
              });
              scheduleAssignment(assign, Object.freeze({ validator, json }));
            },
          );
          return;
        }
        case "object": {
          const fieldsInput = yield* boundaryOwnValue(
            boundary,
            record,
            "value",
            candidatePath,
          );
          const fieldsRecord = boundary === "source"
            ? yield* requireRecord(fieldsInput, `${candidatePath}.value`)
            : yield* requireStoredRecord(fieldsInput, `${candidatePath}.value`);
          const fieldNames = Object.keys(fieldsRecord);
          const validatorEntries: Array<readonly [
            string,
            { readonly fieldType: ValidatorJsonV1; readonly optional: boolean },
          ]> = [];
          const jsonEntries: Array<readonly [string, Json]> = [];
          const scheduleField = (index: number): void => {
            actions.push(() => {
              const fieldName = fieldNames[index];
              if (fieldName === undefined) {
                const validatorValue = Object.freeze(
                  Object.fromEntries(validatorEntries),
                );
                const jsonValue = Object.freeze(Object.fromEntries(jsonEntries));
                const validator = Object.freeze({
                  type: "object",
                  value: validatorValue,
                } as const);
                const json = Object.freeze({
                  type: "object",
                  value: jsonValue,
                });
                scheduleAssignment(assign, Object.freeze({ validator, json }));
                return Result.succeed(undefined);
              }
              const fieldPath =
                `${candidatePath}.value[${JSON.stringify(fieldName)}]`;
              let optional: boolean | undefined;
              scheduleParseFrom(
                () => Result.gen(function* () {
                  const fieldInput = yield* boundaryOwnValue(
                    boundary,
                    fieldsRecord,
                    fieldName,
                    `${candidatePath}.value`,
                  );
                  const fieldRecord = boundary === "source"
                    ? yield* requireRecord(fieldInput, fieldPath)
                    : yield* requireStoredRecord(fieldInput, fieldPath);
                  optional = yield* boundaryBoolean(
                    boundary,
                    yield* boundaryOwnValue(
                      boundary,
                      fieldRecord,
                      "optional",
                      fieldPath,
                    ),
                    `${fieldPath}.optional`,
                  );
                  return yield* boundaryOwnValue(
                    boundary,
                    fieldRecord,
                    "fieldType",
                    fieldPath,
                  );
                }),
                `${fieldPath}.fieldType`,
                (fieldType) => {
                  if (optional === undefined) {
                    throw new Error(
                      "Function Metadata V1 object field lost optional evidence.",
                    );
                  }
                  validatorEntries.push([fieldName, Object.freeze({
                    fieldType: fieldType.validator,
                    optional,
                  })]);
                  jsonEntries.push([fieldName, Object.freeze({
                    fieldType: fieldType.json,
                    optional,
                  })]);
                  scheduleField(index + 1);
                },
              );
              return Result.succeed(undefined);
            });
          };
          scheduleField(0);
          return;
        }
        case "record": {
          scheduleParseFrom(
            () => boundaryOwnValue(
              boundary,
              record,
              "keys",
              candidatePath,
            ),
            `${candidatePath}.keys`,
            (keys) => {
              scheduleParseFrom(
                () => boundaryOwnValue(
                  boundary,
                  record,
                  "values",
                  candidatePath,
                ),
                `${candidatePath}.values`,
                (values) => {
                  const validator = Object.freeze({
                    type: "record",
                    keys: keys.validator,
                    values: values.validator,
                  } as const);
                  const json = Object.freeze({
                    type: "record",
                    keys: keys.json,
                    values: values.json,
                  });
                  scheduleAssignment(
                    assign,
                    Object.freeze({ validator, json }),
                  );
                },
              );
            },
          );
          return;
        }
        case "union": {
          const membersInput = yield* boundaryOwnValue(
            boundary,
            record,
            "value",
            candidatePath,
          );
          const members = boundary === "source"
            ? yield* requireArray(membersInput, `${candidatePath}.value`)
            : yield* requireStoredArray(membersInput, `${candidatePath}.value`);
          const validators: ValidatorJsonV1[] = [];
          const jsonMembers: Json[] = [];
          const scheduleMember = (index: number): void => {
            actions.push(() => {
              if (index >= members.length) {
                const validator = Object.freeze({
                  type: "union",
                  value: Object.freeze(validators),
                } as const);
                const json = Object.freeze({
                  type: "union",
                  value: Object.freeze(jsonMembers),
                });
                scheduleAssignment(assign, Object.freeze({ validator, json }));
                return Result.succeed(undefined);
              }
              scheduleParseFrom(
                () => boundary === "source"
                  ? requireDenseArrayItem(
                      members,
                      index,
                      `${candidatePath}.value`,
                    )
                  : requireStoredDenseArrayItem(
                      members,
                      index,
                      `${candidatePath}.value`,
                    ),
                `${candidatePath}.value[${index}]`,
                (member) => {
                  validators.push(member.validator);
                  jsonMembers.push(member.json);
                  scheduleMember(index + 1);
                },
              );
              return Result.succeed(undefined);
            });
          };
          scheduleMember(0);
          return;
        }
        default:
          return yield* Result.fail(boundaryError(
            boundary,
            `${candidatePath}.type`,
            `unsupported validator type ${JSON.stringify(typeValue)}`,
          ));
      }
    }));
  };

  const scheduleParse = (
    candidate: unknown,
    candidatePath: string,
    assign: (parsed: ParsedValidator) => void,
  ): void => {
    scheduleParseFrom(
      () => Result.succeed(candidate),
      candidatePath,
      assign,
    );
  };

  scheduleParse(input, path, (parsed) => {
    parsedRoot = parsed;
  });
  while (actions.length > 0) {
    const action = actions.pop();
    if (action === undefined) {
      throw new Error("Function Metadata V1 validator action stack underflowed.");
    }
    const step = action();
    if (Result.isFailure(step)) return Result.fail(step.failure);
  }
  if (parsedRoot === undefined) {
    throw new Error("Function Metadata V1 validator parsing lost its result.");
  }
  return Result.succeed(parsedRoot);
}

function encodeSourceLiteral(
  input: unknown,
  path: string,
): Result.Result<
  { readonly value: string | number | boolean; readonly json: Json },
  FunctionMetadataInvalidV1Error
> {
  if (
    typeof input !== "string" &&
    typeof input !== "number" &&
    typeof input !== "boolean"
  ) {
    return invalid(path, "literal must be a string, number, or boolean");
  }
  try {
    return Result.succeed(Object.freeze({
      value: input,
      json: flarexValueToJsonV1(input),
    }));
  } catch (cause) {
    if (cause instanceof FlarexValueCodecV1Error) {
      return invalid(path, "literal is not representable by Value Codec V1");
    }
    throw cause;
  }
}

function decodeStoredLiteral(
  input: unknown,
  path: string,
): Result.Result<
  { readonly value: string | number | boolean; readonly json: Json },
  FunctionMetadataNonCanonicalBytesV1Error
> {
  try {
    const value = jsonToFlarexValueV1(input);
    if (
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      return Result.fail(nonCanonical(
        "invalidShape",
        `${path} must decode to a string, number, or boolean literal`,
      ));
    }
    return Result.succeed(Object.freeze({
      value,
      json: flarexValueToJsonV1(value),
    }));
  } catch (cause) {
    if (cause instanceof FlarexValueCodecV1Error) {
      return Result.fail(nonCanonical(
        "invalidShape",
        `${path} is not a canonical Value Codec V1 literal primitive`,
      ));
    }
    throw cause;
  }
}

function parseRoute(
  input: unknown,
  path: string,
): Result.Result<FunctionMetadataRouteV1, FunctionMetadataInvalidV1Error> {
  return Result.gen(function* () {
    const record = yield* requireRecord(input, path);
    const type = yield* requireOwnValue(record, "type", path);
    if (type !== "args") return yield* invalid(path, "invalid route policy");
    const field = yield* requireNonemptyString(
      yield* requireOwnValue(record, "field", path),
      `${path}.field`,
    );
    return Object.freeze({ type: "args", field });
  });
}

function parseStoredRoute(
  input: unknown,
  path: string,
): Result.Result<
  FunctionMetadataRouteV1,
  FunctionMetadataNonCanonicalBytesV1Error
> {
  return Result.gen(function* () {
    const record = yield* requireStoredRecord(input, path);
    yield* requireStoredLiteral(record, "type", "args", path);
    const field = yield* requireStoredNonemptyString(
      yield* requireStoredOwnValue(record, "field", path),
      `${path}.field`,
    );
    return Object.freeze({ type: "args", field });
  });
}

function parsePartition(
  input: unknown,
  path: string,
): Result.Result<FunctionMetadataPartitionV1, FunctionMetadataInvalidV1Error> {
  return Result.gen(function* () {
    const record = yield* requireRecord(input, path);
    const type = yield* requireOwnValue(record, "type", path);
    const table = yield* requireNonemptyString(
      yield* requireOwnValue(record, "table", path),
      `${path}.table`,
    );
    if (type === "partitionCreateRoot") {
      const partitionField = yield* requireOwnValue(
        record,
        "partitionField",
        path,
      );
      if (partitionField !== "_id") {
        return yield* invalid(
          `${path}.partitionField`,
          "create-root partition field must be _id",
        );
      }
      return Object.freeze({
        type: "partitionCreateRoot",
        table,
        partitionField: "_id",
      });
    }
    if (type !== "partition") {
      return yield* invalid(`${path}.type`, "invalid partition policy");
    }
    const selector = yield* requireNonemptyString(
      yield* requireOwnValue(record, "selector", path),
      `${path}.selector`,
    );
    const partitionField = yield* requireNonemptyString(
      yield* requireOwnValue(record, "partitionField", path),
      `${path}.partitionField`,
    );
    const argField = yield* requireNonemptyString(
      yield* requireOwnValue(record, "argField", path),
      `${path}.argField`,
    );
    return Object.freeze({
      type: "partition",
      table,
      selector,
      partitionField,
      argField,
    });
  });
}

function parseStoredPartition(
  input: unknown,
  path: string,
): Result.Result<
  FunctionMetadataPartitionV1,
  FunctionMetadataNonCanonicalBytesV1Error
> {
  return Result.gen(function* () {
    const record = yield* requireStoredRecord(input, path);
    const type = yield* requireStoredOwnValue(record, "type", path);
    const table = yield* requireStoredNonemptyString(
      yield* requireStoredOwnValue(record, "table", path),
      `${path}.table`,
    );
    if (type === "partitionCreateRoot") {
      yield* requireStoredLiteral(record, "partitionField", "_id", path);
      return Object.freeze({
        type: "partitionCreateRoot",
        table,
        partitionField: "_id",
      });
    }
    if (type !== "partition") {
      return yield* Result.fail(nonCanonical(
        "invalidShape",
        `${path}.type is not a supported partition policy`,
      ));
    }
    const selector = yield* requireStoredNonemptyString(
      yield* requireStoredOwnValue(record, "selector", path),
      `${path}.selector`,
    );
    const partitionField = yield* requireStoredNonemptyString(
      yield* requireStoredOwnValue(record, "partitionField", path),
      `${path}.partitionField`,
    );
    const argField = yield* requireStoredNonemptyString(
      yield* requireStoredOwnValue(record, "argField", path),
      `${path}.argField`,
    );
    return Object.freeze({
      type: "partition",
      table,
      selector,
      partitionField,
      argField,
    });
  });
}

function parsePosition(
  input: unknown,
  path: string,
): Result.Result<FunctionMetadataPositionV1, FunctionMetadataInvalidV1Error> {
  return Result.gen(function* () {
    const record = yield* requireRecord(input, path);
    const positionPath = yield* requireNonemptyString(
      yield* requireOwnValue(record, "path", path),
      `${path}.path`,
    );
    const startLine = yield* requirePositiveSafeInteger(
      yield* requireOwnValue(record, "startLine", path),
      `${path}.startLine`,
    );
    const startColumn = yield* requirePositiveSafeInteger(
      yield* requireOwnValue(record, "startColumn", path),
      `${path}.startColumn`,
    );
    return Object.freeze({ path: positionPath, startLine, startColumn });
  });
}

function parseStoredPosition(
  input: unknown,
  path: string,
): Result.Result<
  FunctionMetadataPositionV1,
  FunctionMetadataNonCanonicalBytesV1Error
> {
  return Result.gen(function* () {
    const record = yield* requireStoredRecord(input, path);
    const positionPath = yield* requireStoredNonemptyString(
      yield* requireStoredOwnValue(record, "path", path),
      `${path}.path`,
    );
    const startLine = yield* requireStoredPositiveSafeInteger(
      yield* requireStoredOwnValue(record, "startLine", path),
      `${path}.startLine`,
    );
    const startColumn = yield* requireStoredPositiveSafeInteger(
      yield* requireStoredOwnValue(record, "startColumn", path),
      `${path}.startColumn`,
    );
    return Object.freeze({ path: positionPath, startLine, startColumn });
  });
}

function materializeSet(
  parsed: ReadonlyArray<ParsedFunction>,
  state: CodecState,
): Result.Result<CanonicalFunctionMetadataSetV1, FunctionMetadataOperationBudgetV1Error> {
  return Result.gen(function* () {
    const canonicalFunctions: CanonicalFunctionMetadataV1[] = [];
    for (let ordinal = 0; ordinal < parsed.length; ordinal += 1) {
      const current = parsed[ordinal];
      if (current === undefined) throw new Error("Function metadata ordering lost an item.");
      const byteLength = yield* measureCanonicalJsonUtf8Bytes(
        current.json,
        state,
      );
      yield* chargeCanonicalBytes(state, byteLength);
      const canonicalText = encodeCanonicalJsonIteratively(current.json);
      const canonicalBytes = UTF8_ENCODER.encode(canonicalText);
      canonicalFunctions.push(Object.freeze({
        ordinal,
        metadata: current.metadata,
        canonicalText,
        canonicalBytes,
      }));
    }

    const setJson = Object.freeze({
      format: FUNCTION_METADATA_SET_FORMAT_V1,
      functions: Object.freeze(parsed.map((item) => item.json)),
      version: FUNCTION_METADATA_CODEC_VERSION_V1,
    });
    const setByteLength = yield* measureCanonicalJsonUtf8Bytes(setJson, state);
    yield* chargeCanonicalBytes(state, setByteLength);
    const canonicalText = encodeCanonicalJsonIteratively(setJson);
    const canonicalBytes = UTF8_ENCODER.encode(canonicalText);

    return Object.freeze({
      format: FUNCTION_METADATA_SET_FORMAT_V1,
      version: FUNCTION_METADATA_CODEC_VERSION_V1,
      functions: Object.freeze(canonicalFunctions),
      canonicalText,
      canonicalBytes,
      functionsVisited: state.functionsVisited,
      validatorNodesVisited: state.validatorNodesVisited,
      canonicalUtf8BytesMaterialized:
        state.canonicalUtf8BytesMaterialized,
    });
  });
}

function createCodecState(budget: FunctionMetadataOperationBudgetV1): CodecState {
  return {
    budget,
    functionsVisited: 0,
    validatorNodesVisited: 0,
    canonicalUtf8BytesMaterialized: 0,
  };
}

function preflightFunctionCount(
  observed: number,
  state: CodecState,
): Result.Result<void, FunctionMetadataOperationBudgetV1Error> {
  return observed > state.budget.maximumFunctionsVisited
    ? Result.fail(new FunctionMetadataOperationBudgetV1Error({
        dimension: "functionsVisited",
        observed,
        maximum: state.budget.maximumFunctionsVisited,
      }))
    : Result.succeed(undefined);
}

function chargeFunctionVisit(state: CodecState): void {
  state.functionsVisited += 1;
}

function chargeValidatorNode(
  state: CodecState,
): Result.Result<void, FunctionMetadataOperationBudgetV1Error> {
  const observed = state.validatorNodesVisited + 1;
  if (observed > state.budget.maximumValidatorNodesVisited) {
    return Result.fail(new FunctionMetadataOperationBudgetV1Error({
      dimension: "validatorNodesVisited",
      observed,
      maximum: state.budget.maximumValidatorNodesVisited,
    }));
  }
  state.validatorNodesVisited = observed;
  return Result.succeed(undefined);
}

function chargeCanonicalBytes(
  state: CodecState,
  bytes: number,
): Result.Result<void, FunctionMetadataOperationBudgetV1Error> {
  const observed = state.canonicalUtf8BytesMaterialized + bytes;
  if (
    !Number.isSafeInteger(observed) ||
    observed > state.budget.maximumCanonicalUtf8BytesMaterialized
  ) {
    return Result.fail(new FunctionMetadataOperationBudgetV1Error({
      dimension: "canonicalUtf8BytesMaterialized",
      observed,
      maximum: state.budget.maximumCanonicalUtf8BytesMaterialized,
    }));
  }
  state.canonicalUtf8BytesMaterialized = observed;
  return Result.succeed(undefined);
}

function captureBoundedIntrinsicBytes(
  input: Uint8Array,
  maximum: number,
): Result.Result<
  Uint8Array,
  FunctionMetadataNonCanonicalBytesV1Error | FunctionMetadataOperationBudgetV1Error
> {
  let visibleLength = 0;
  try {
    for (const _byte of Uint8Array.prototype.values.call(input)) {
      visibleLength += 1;
      if (visibleLength > maximum) {
        return Result.fail(new FunctionMetadataOperationBudgetV1Error({
          dimension: "canonicalUtf8BytesMaterialized",
          observed: visibleLength,
          maximum,
        }));
      }
    }
    const owned = new Uint8Array(visibleLength);
    Uint8Array.prototype.set.call(owned, input);
    return Result.succeed(owned);
  } catch (cause) {
    if (cause instanceof TypeError) {
      return Result.fail(nonCanonical(
        "invalidBytes",
        "stored Function Metadata V1 evidence is not a readable Uint8Array",
      ));
    }
    throw cause;
  }
}

function measureCanonicalJsonUtf8Bytes(
  value: Json,
  state: CodecState,
): Result.Result<number, FunctionMetadataOperationBudgetV1Error> {
  const remaining =
    state.budget.maximumCanonicalUtf8BytesMaterialized -
    state.canonicalUtf8BytesMaterialized;
  let measured = 0;

  const overflow = (): FunctionMetadataOperationBudgetV1Error =>
    new FunctionMetadataOperationBudgetV1Error({
      dimension: "canonicalUtf8BytesMaterialized",
      observed: state.budget.maximumCanonicalUtf8BytesMaterialized + 1,
      maximum: state.budget.maximumCanonicalUtf8BytesMaterialized,
    });
  const add = (bytes: number): FunctionMetadataOperationBudgetV1Error | null => {
    if (bytes > remaining - measured) return overflow();
    measured += bytes;
    return null;
  };
  const addCanonicalString = (
    input: string,
  ): FunctionMetadataOperationBudgetV1Error | null => {
    let failure = add(2);
    if (failure !== null) return failure;
    for (let index = 0; index < input.length; index += 1) {
      const code = input.charCodeAt(index);
      let bytes: number;
      if (code === 0x22 || code === 0x5c) {
        bytes = 2;
      } else if (code <= 0x1f) {
        bytes =
          code === 0x08 ||
            code === 0x09 ||
            code === 0x0a ||
            code === 0x0c ||
            code === 0x0d
            ? 2
            : 6;
      } else if (code <= 0x7f) {
        bytes = 1;
      } else if (code <= 0x7ff) {
        bytes = 2;
      } else if (code >= 0xd800 && code <= 0xdbff) {
        const next = input.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          bytes = 4;
          index += 1;
        } else {
          bytes = 6;
        }
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        bytes = 6;
      } else {
        bytes = 3;
      }
      failure = add(bytes);
      if (failure !== null) return failure;
    }
    return null;
  };

  const stack: Json[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) {
      throw new Error("Canonical Function Metadata V1 sizing stack underflowed.");
    }
    if (isJsonArray(current)) {
      const punctuationFailure = add(2 + Math.max(0, current.length - 1));
      if (punctuationFailure !== null) return Result.fail(punctuationFailure);
      for (let index = current.length - 1; index >= 0; index -= 1) {
        if (!Object.hasOwn(current, index)) {
          return canonicalJsonInvariantFailure({
            reason: "missingArrayItem",
            index,
          });
        }
        const item = current[index];
        if (item === undefined) {
          return canonicalJsonInvariantFailure({
            reason: "missingArrayItem",
            index,
          });
        }
        stack.push(item);
      }
      continue;
    }
    if (isJsonObject(current)) {
      const keys = Object.keys(current);
      const punctuationFailure = add(2 + Math.max(0, keys.length - 1));
      if (punctuationFailure !== null) return Result.fail(punctuationFailure);
      for (const key of keys) {
        const keyFailure = addCanonicalString(key) ?? add(1);
        if (keyFailure !== null) return Result.fail(keyFailure);
        const item = current[key];
        if (item === undefined) {
          return canonicalJsonInvariantFailure({
            reason: "missingObjectProperty",
            key,
          });
        }
        stack.push(item);
      }
      continue;
    }
    if (typeof current === "string") {
      const stringFailure = addCanonicalString(current);
      if (stringFailure !== null) return Result.fail(stringFailure);
      continue;
    }
    const encoded = encodeCanonicalJson(current, canonicalJsonInvariantFailure);
    const primitiveFailure = add(utf8ByteLength(encoded));
    if (primitiveFailure !== null) return Result.fail(primitiveFailure);
  }
  return Result.succeed(measured);
}

type CanonicalEncodingFrame =
  | Readonly<{ readonly kind: "value"; readonly value: Json }>
  | Readonly<{ readonly kind: "raw"; readonly value: string }>;

function encodeCanonicalJsonIteratively(value: Json): string {
  const pieces: string[] = [];
  const stack: CanonicalEncodingFrame[] = [{ kind: "value", value }];
  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) {
      throw new Error("Canonical Function Metadata V1 encoding stack underflowed.");
    }
    if (frame.kind === "raw") {
      pieces.push(frame.value);
      continue;
    }
    const current = frame.value;
    if (isJsonArray(current)) {
      pieces.push("[");
      stack.push({ kind: "raw", value: "]" });
      for (let index = current.length - 1; index >= 0; index -= 1) {
        if (!Object.hasOwn(current, index)) {
          return canonicalJsonInvariantFailure({
            reason: "missingArrayItem",
            index,
          });
        }
        const item = current[index];
        if (item === undefined) {
          return canonicalJsonInvariantFailure({
            reason: "missingArrayItem",
            index,
          });
        }
        stack.push({ kind: "value", value: item });
        if (index > 0) stack.push({ kind: "raw", value: "," });
      }
      continue;
    }
    if (isJsonObject(current)) {
      pieces.push("{");
      const keys = Object.keys(current).sort(compareUtf16Strings);
      stack.push({ kind: "raw", value: "}" });
      for (let index = keys.length - 1; index >= 0; index -= 1) {
        const key = keys[index];
        if (key === undefined) {
          throw new Error("Canonical Function Metadata V1 key ordering lost an item.");
        }
        const item = current[key];
        if (item === undefined) {
          return canonicalJsonInvariantFailure({
            reason: "missingObjectProperty",
            key,
          });
        }
        stack.push({ kind: "value", value: item });
        stack.push({ kind: "raw", value: ":" });
        stack.push({ kind: "value", value: key });
        if (index > 0) stack.push({ kind: "raw", value: "," });
      }
      continue;
    }
    pieces.push(encodeCanonicalJson(current, canonicalJsonInvariantFailure));
  }
  return pieces.join("");
}

function rejectDuplicate(
  functionPath: string,
  duplicateIndex: number,
  seen: Map<string, number>,
): Result.Result<void, FunctionMetadataDuplicatePathV1Error> {
  const firstIndex = seen.get(functionPath);
  if (firstIndex !== undefined) {
    return Result.fail(new FunctionMetadataDuplicatePathV1Error({
      functionPath,
      firstIndex,
      duplicateIndex,
    }));
  }
  seen.set(functionPath, duplicateIndex);
  return Result.succeed(undefined);
}

function executionModuleFromFunctionPath(
  functionPath: string,
  path: string,
): Result.Result<string, FunctionMetadataInvalidV1Error> {
  const separator = functionPath.indexOf(":");
  const executionModule = separator === -1
    ? functionPath
    : functionPath.slice(0, separator);
  return executionModule.length === 0
    ? invalid(path, "function path must contain a nonempty execution module")
    : Result.succeed(executionModule);
}

function executionModuleFromStoredFunctionPath(
  functionPath: string,
  path: string,
): Result.Result<string, FunctionMetadataNonCanonicalBytesV1Error> {
  const result = executionModuleFromFunctionPath(functionPath, path);
  return Result.isFailure(result)
    ? Result.fail(nonCanonical("invalidShape", result.failure.issue.detail))
    : Result.succeed(result.success);
}

function anyValidator(): ParsedValidator {
  const validator = Object.freeze({ type: "any" } as const);
  return Object.freeze({ validator, json: validator });
}

function requireRecord(
  input: unknown,
  path: string,
): Result.Result<UnknownRecord, FunctionMetadataInvalidV1Error> {
  if (!isNonArrayRecord(input)) {
    return invalid(path, "expected an object");
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    return invalid(path, "expected a plain object");
  }
  if (Object.getOwnPropertySymbols(input).length > 0) {
    return invalid(path, "symbol properties are not supported");
  }
  return Result.succeed(input);
}

function requireStoredRecord(
  input: unknown,
  path: string,
): Result.Result<UnknownRecord, FunctionMetadataNonCanonicalBytesV1Error> {
  const result = requireRecord(input, path);
  return Result.isFailure(result)
    ? Result.fail(nonCanonical("invalidShape", result.failure.issue.detail))
    : Result.succeed(result.success);
}

function requireArray(
  input: unknown,
  path: string,
): Result.Result<ReadonlyArray<unknown>, FunctionMetadataInvalidV1Error> {
  return Array.isArray(input)
    ? Result.succeed(input)
    : invalid(path, "expected an array");
}

function requireStoredArray(
  input: unknown,
  path: string,
): Result.Result<
  ReadonlyArray<unknown>,
  FunctionMetadataNonCanonicalBytesV1Error
> {
  return Array.isArray(input)
    ? Result.succeed(input)
    : Result.fail(nonCanonical("invalidShape", `${path} must be an array`));
}

function requireDenseArrayItem(
  input: ReadonlyArray<unknown>,
  index: number,
  path: string,
): Result.Result<unknown, FunctionMetadataInvalidV1Error> {
  const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
  return descriptor !== undefined && "value" in descriptor
    ? Result.succeed(descriptor.value)
    : invalid(`${path}[${index}]`, "expected a dense data item");
}

function requireStoredDenseArrayItem(
  input: ReadonlyArray<unknown>,
  index: number,
  path: string,
): Result.Result<unknown, FunctionMetadataNonCanonicalBytesV1Error> {
  const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
  return descriptor !== undefined && "value" in descriptor
    ? Result.succeed(descriptor.value)
    : Result.fail(nonCanonical(
        "invalidShape",
        `${path}[${index}] must be a dense data item`,
      ));
}

function readOwnProperty(
  record: UnknownRecord,
  key: string,
  path: string,
): Result.Result<OwnProperty, FunctionMetadataInvalidV1Error> {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined) {
    return Result.succeed(Object.freeze({ present: false, value: undefined }));
  }
  if (!("value" in descriptor)) {
    return invalid(`${path}.${key}`, "accessor properties are not supported");
  }
  return Result.succeed(Object.freeze({ present: true, value: descriptor.value }));
}

function requireOwnValue(
  record: UnknownRecord,
  key: string,
  path: string,
): Result.Result<unknown, FunctionMetadataInvalidV1Error> {
  return readOwnProperty(record, key, path).pipe(
    Result.flatMap((property) => property.present
      ? Result.succeed(property.value)
      : invalid(`${path}.${key}`, "required property is missing")),
  );
}

function requireStoredOwnValue(
  record: UnknownRecord,
  key: string,
  path: string,
): Result.Result<unknown, FunctionMetadataNonCanonicalBytesV1Error> {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (descriptor === undefined || !("value" in descriptor)) {
    return Result.fail(nonCanonical(
      "invalidShape",
      `${path}.${key} must be an own data property`,
    ));
  }
  return Result.succeed(descriptor.value);
}

function boundaryOwnValue(
  boundary: "source" | "stored",
  record: UnknownRecord,
  key: string,
  path: string,
): Result.Result<
  unknown,
  FunctionMetadataInvalidV1Error | FunctionMetadataNonCanonicalBytesV1Error
> {
  return boundary === "source"
    ? requireOwnValue(record, key, path)
    : requireStoredOwnValue(record, key, path);
}

function requireNonemptyString(
  input: unknown,
  path: string,
): Result.Result<string, FunctionMetadataInvalidV1Error> {
  return typeof input === "string" && input.length > 0
    ? Result.succeed(input)
    : invalid(path, "expected a nonempty string");
}

function requireStoredNonemptyString(
  input: unknown,
  path: string,
): Result.Result<string, FunctionMetadataNonCanonicalBytesV1Error> {
  return typeof input === "string" && input.length > 0
    ? Result.succeed(input)
    : Result.fail(nonCanonical("invalidShape", `${path} must be a nonempty string`));
}

function boundaryNonemptyString(
  boundary: "source" | "stored",
  input: unknown,
  path: string,
): Result.Result<
  string,
  FunctionMetadataInvalidV1Error | FunctionMetadataNonCanonicalBytesV1Error
> {
  return boundary === "source"
    ? requireNonemptyString(input, path)
    : requireStoredNonemptyString(input, path);
}

function boundaryBoolean(
  boundary: "source" | "stored",
  input: unknown,
  path: string,
): Result.Result<
  boolean,
  FunctionMetadataInvalidV1Error | FunctionMetadataNonCanonicalBytesV1Error
> {
  if (typeof input === "boolean") return Result.succeed(input);
  return Result.fail(boundaryError(boundary, path, "expected a boolean"));
}

function requirePositiveSafeInteger(
  input: unknown,
  path: string,
): Result.Result<number, FunctionMetadataInvalidV1Error> {
  return typeof input === "number" && Number.isSafeInteger(input) && input > 0
    ? Result.succeed(input)
    : invalid(path, "expected a positive safe integer");
}

function requireStoredPositiveSafeInteger(
  input: unknown,
  path: string,
): Result.Result<number, FunctionMetadataNonCanonicalBytesV1Error> {
  return typeof input === "number" && Number.isSafeInteger(input) && input > 0
    ? Result.succeed(input)
    : Result.fail(nonCanonical(
        "invalidShape",
        `${path} must be a positive safe integer`,
      ));
}

function isFunctionMetadataKind(
  input: unknown,
): input is FunctionMetadataKindV1 {
  return input === "query" ||
    input === "mutation" ||
    input === "action" ||
    input === "workflowMutation";
}

function isFunctionMetadataVisibility(
  input: unknown,
): input is FunctionMetadataVisibilityV1 {
  return input === "public" || input === "internal";
}

type SimpleValidatorTypeV1 =
  | "null"
  | "number"
  | "bigint"
  | "boolean"
  | "string"
  | "bytes"
  | "any";

function isSimpleValidatorType(input: string): input is SimpleValidatorTypeV1 {
  return input === "null" ||
    input === "number" ||
    input === "bigint" ||
    input === "boolean" ||
    input === "string" ||
    input === "bytes" ||
    input === "any";
}

function requireFunctionKind(
  input: unknown,
  path: string,
): Result.Result<FunctionMetadataKindV1, FunctionMetadataInvalidV1Error> {
  return isFunctionMetadataKind(input)
    ? Result.succeed(input)
    : invalid(path, "expected a supported function kind");
}

function requireStoredFunctionKind(
  input: unknown,
  path: string,
): Result.Result<
  FunctionMetadataKindV1,
  FunctionMetadataNonCanonicalBytesV1Error
> {
  return isFunctionMetadataKind(input)
    ? Result.succeed(input)
    : Result.fail(nonCanonical("invalidShape", `${path} is not a supported function kind`));
}

function requireFunctionVisibility(
  input: unknown,
  path: string,
): Result.Result<
  FunctionMetadataVisibilityV1,
  FunctionMetadataInvalidV1Error
> {
  return isFunctionMetadataVisibility(input)
    ? Result.succeed(input)
    : invalid(path, "expected public or internal visibility");
}

function requireStoredFunctionVisibility(
  input: unknown,
  path: string,
): Result.Result<
  FunctionMetadataVisibilityV1,
  FunctionMetadataNonCanonicalBytesV1Error
> {
  return isFunctionMetadataVisibility(input)
    ? Result.succeed(input)
    : Result.fail(nonCanonical("invalidShape", `${path} is not a supported visibility`));
}

function requireStoredLiteral(
  record: UnknownRecord,
  key: string,
  expected: string | number,
  path: string,
): Result.Result<void, FunctionMetadataNonCanonicalBytesV1Error> {
  return requireStoredOwnValue(record, key, path).pipe(
    Result.flatMap((value) => value === expected
      ? Result.succeed(undefined)
      : Result.fail(nonCanonical(
          "invalidShape",
          `${path}.${key} must equal ${JSON.stringify(expected)}`,
        ))),
  );
}

function decodeFatalUtf8(
  bytes: Uint8Array,
): Result.Result<string, FunctionMetadataNonCanonicalBytesV1Error> {
  try {
    return Result.succeed(FATAL_UTF8_DECODER.decode(bytes));
  } catch (cause) {
    if (cause instanceof TypeError) {
      return Result.fail(nonCanonical(
        "invalidUtf8",
        "stored Function Metadata V1 evidence is not valid UTF-8",
      ));
    }
    throw cause;
  }
}

function parseJson(
  text: string,
): Result.Result<unknown, FunctionMetadataNonCanonicalBytesV1Error> {
  try {
    return Result.succeed(JSON.parse(text));
  } catch (cause) {
    if (cause instanceof SyntaxError) {
      return Result.fail(nonCanonical(
        "invalidJson",
        "stored Function Metadata V1 evidence is not valid JSON",
      ));
    }
    throw cause;
  }
}

function invalid(
  path: string,
  detail: string,
): Result.Result<never, FunctionMetadataInvalidV1Error> {
  return Result.fail(new FunctionMetadataInvalidV1Error({
    issue: Object.freeze({ path, detail }),
  }));
}

function boundaryError(
  boundary: "source" | "stored",
  path: string,
  detail: string,
): FunctionMetadataInvalidV1Error | FunctionMetadataNonCanonicalBytesV1Error {
  return boundary === "source"
    ? new FunctionMetadataInvalidV1Error({
        issue: Object.freeze({ path, detail }),
      })
    : nonCanonical("invalidShape", `${path}: ${detail}`);
}

function nonCanonical(
  reason: FunctionMetadataNonCanonicalBytesV1Reason,
  detail: string,
): FunctionMetadataNonCanonicalBytesV1Error {
  return new FunctionMetadataNonCanonicalBytesV1Error({ reason, detail });
}

function canonicalJsonInvariantFailure(
  issue: CanonicalJsonEncodingInvariantIssue,
): never {
  throw new Error(
    `Owned Function Metadata V1 JSON violated its encoding invariant: ${issue.reason}`,
  );
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}
