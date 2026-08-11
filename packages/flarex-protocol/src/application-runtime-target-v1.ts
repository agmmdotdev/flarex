import { Data, Result, Schema } from "effect";
import { isNonArrayRecord } from "@flarex/utils/records";

import { encodeCanonicalJson, type Json, type JsonObject } from "./json";
import { StrictParseOptions, StrictStructOptions } from "./strict-schema-options";
import {
  ValidatorJsonV1,
  validatorJsonAdmissionIssueV1,
} from "./validator-json";
import {
  MAX_VALIDATOR_JSON_DEPTH_V1,
  MAX_VALIDATOR_JSON_NODES_V1,
} from "./validator-json-core";

export const APPLICATION_RUNTIME_TARGET_FORMAT_V1 =
  "flarex.application-runtime-target" as const;
export const APPLICATION_RUNTIME_TARGET_VERSION_V1 = 1 as const;
export const MAX_APPLICATION_RUNTIME_TARGET_BYTES_V1 = 65_536;

const UTF8 = new TextEncoder();
const MAX_CAPTURE_NODES = MAX_VALIDATOR_JSON_NODES_V1 * 2 + 256;
const MAX_CAPTURE_DEPTH = MAX_VALIDATOR_JSON_DEPTH_V1 + 8;
const NonemptyBoundedText = Schema.String.check(
  Schema.makeFilter(value =>
    value.length > 0 && UTF8.encode(value).byteLength <= 4_096
      ? undefined
      : "Expected nonempty text of at most 4096 UTF-8 bytes"
  ),
);
const IdentityText = Schema.String.check(
  Schema.makeFilter(value =>
    value.length > 0 && value.length <= 256
      ? undefined
      : "Expected a nonempty identity of at most 256 code units"
  ),
);
const LowercaseSha256 = Schema.String.check(
  Schema.makeFilter(value =>
    /^[0-9a-f]{64}$/.test(value)
      ? undefined
      : "Expected a lowercase SHA-256 digest"
  ),
);
const ApplicationRuntimeFunctionPartitionV1Schema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("partition"),
    table: NonemptyBoundedText,
    selector: NonemptyBoundedText,
    partitionField: NonemptyBoundedText,
    argField: NonemptyBoundedText,
  }).annotate(StrictStructOptions),
  Schema.Struct({
    type: Schema.Literal("partitionCreateRoot"),
    table: NonemptyBoundedText,
    partitionField: Schema.Literal("_id"),
  }).annotate(StrictStructOptions),
  Schema.Null,
]);
const ApplicationRuntimeFunctionV1Schema = Schema.Struct({
  path: NonemptyBoundedText,
  moduleName: NonemptyBoundedText,
  exportName: NonemptyBoundedText,
  kind: Schema.Union([
    Schema.Literal("query"),
    Schema.Literal("mutation"),
    Schema.Literal("workflowMutation"),
    Schema.Literal("action"),
  ]),
  visibility: Schema.Union([
    Schema.Literal("public"),
    Schema.Literal("internal"),
  ]),
  args: ValidatorJsonV1,
  returns: Schema.Union([ValidatorJsonV1, Schema.Null]),
  partition: ApplicationRuntimeFunctionPartitionV1Schema,
  entrySha256: LowercaseSha256,
}).annotate(StrictStructOptions);

const ApplicationRuntimeTargetV1StructuralSchema = Schema.Struct({
  format: Schema.Literal(APPLICATION_RUNTIME_TARGET_FORMAT_V1),
  version: Schema.Literal(APPLICATION_RUNTIME_TARGET_VERSION_V1),
  scopeId: IdentityText,
  revisionId: IdentityText,
  candidateId: IdentityText,
  analysisId: IdentityText,
  sourceArtifactRootSha256: LowercaseSha256,
  manifestSha256: LowercaseSha256,
  schemaSha256: LowercaseSha256,
  functionCatalogSha256: LowercaseSha256,
  publicationSha256: LowercaseSha256,
  executionModulePath: NonemptyBoundedText,
  function: ApplicationRuntimeFunctionV1Schema,
}).annotate(StrictStructOptions);

export type ApplicationRuntimeTargetV1 =
  typeof ApplicationRuntimeTargetV1StructuralSchema.Type;
export type ApplicationRuntimeFunctionV1 =
  ApplicationRuntimeTargetV1["function"];

export interface CanonicalApplicationRuntimeTargetV1 {
  readonly target: ApplicationRuntimeTargetV1;
  readonly canonicalText: string;
  readonly canonicalBytes: Uint8Array;
}

export class ApplicationRuntimeTargetV1Error extends Data.TaggedError(
  "ApplicationRuntimeTargetV1Error",
)<{
  readonly operation: "decode" | "canonicalize";
  readonly reason: "invalidShape" | "invalidFunctionPath" | "bytesExceeded";
  readonly cause?: unknown;
}> {}

const decodeShape = Schema.decodeUnknownResult(
  ApplicationRuntimeTargetV1StructuralSchema,
  StrictParseOptions,
);

export function decodeApplicationRuntimeTargetV1(
  value: unknown,
): Result.Result<ApplicationRuntimeTargetV1, ApplicationRuntimeTargetV1Error> {
  return capturePlainData(value).pipe(
    Result.mapError(cause => error("decode", "invalidShape", cause)),
    Result.flatMap(captured => {
      const admissionFailure = preflightValidators(captured);
      return admissionFailure === undefined
        ? Result.succeed(captured)
        : Result.fail(error("decode", "invalidShape", admissionFailure));
    }),
    Result.flatMap(captured => decodeShape(captured).pipe(
      Result.mapError(cause => error("decode", "invalidShape", cause)),
      Result.flatMap(target => target.function.path === functionPath(
          target.function.moduleName,
          target.function.exportName,
        )
        ? Result.succeed(snapshotTarget(target))
        : Result.fail(error("decode", "invalidFunctionPath"))),
    )),
  );
}

export function canonicalizeApplicationRuntimeTargetV1(
  value: unknown,
): Result.Result<
  CanonicalApplicationRuntimeTargetV1,
  ApplicationRuntimeTargetV1Error
> {
  return decodeApplicationRuntimeTargetV1(value).pipe(
    Result.flatMap(target => {
      const canonicalText = encodeCanonicalJson(targetJson(target), issue => {
        throw new Error(`Application runtime target invariant: ${issue.reason}`);
      });
      const canonicalBytes = UTF8.encode(canonicalText);
      return canonicalBytes.byteLength <= MAX_APPLICATION_RUNTIME_TARGET_BYTES_V1
        ? Result.succeed(Object.freeze({
          target,
          canonicalText,
          canonicalBytes,
        }))
        : Result.fail(error("canonicalize", "bytesExceeded"));
    }),
  );
}

function preflightValidators(value: unknown): unknown | undefined {
  try {
    if (!isNonArrayRecord(value) || !isNonArrayRecord(value.function)) {
      return "function";
    }
    const argsIssue = validatorJsonAdmissionIssueV1(value.function.args);
    if (argsIssue !== undefined) return argsIssue;
    if (value.function.returns !== null) {
      return validatorJsonAdmissionIssueV1(value.function.returns);
    }
    return undefined;
  } catch (cause) {
    return cause;
  }
}

interface CaptureState {
  remaining: number;
  readonly ancestors: WeakSet<object>;
}

function capturePlainData(value: unknown): Result.Result<unknown, unknown> {
  return capturePlainDataNode(value, {
    remaining: MAX_CAPTURE_NODES,
    ancestors: new WeakSet<object>(),
  }, 0);
}

function capturePlainDataNode(
  value: unknown,
  state: CaptureState,
  depth: number,
): Result.Result<unknown, unknown> {
  if (state.remaining === 0) return Result.fail("captureNodes");
  state.remaining -= 1;
  if (depth > MAX_CAPTURE_DEPTH) return Result.fail("captureDepth");
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    value === undefined
  ) return Result.succeed(value);
  if (typeof value !== "object" || state.ancestors.has(value)) {
    return Result.fail("plainData");
  }

  state.ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return Result.gen(function* () {
        const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
        if (
          lengthDescriptor === undefined ||
          !("value" in lengthDescriptor) ||
          typeof lengthDescriptor.value !== "number" ||
          lengthDescriptor.value > state.remaining
        ) return yield* Result.fail("array");
        const length = lengthDescriptor.value;
        const keys = Reflect.ownKeys(value);
        if (keys.length !== length + 1) return yield* Result.fail("arrayKeys");
        const output: unknown[] = [];
        for (let index = 0; index < length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
          if (
            descriptor === undefined ||
            !descriptor.enumerable ||
            !("value" in descriptor)
          ) return yield* Result.fail("arrayMember");
          output.push(yield* capturePlainDataNode(
            descriptor.value,
            state,
            depth + 1,
          ));
        }
        return output;
      });
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return Result.fail("prototype");
    }
    return Result.gen(function* () {
      const keys = Reflect.ownKeys(value);
      if (keys.length > state.remaining) return yield* Result.fail("objectKeys");
      const output: Record<string, unknown> = Object.create(null);
      for (const key of keys) {
        if (typeof key !== "string") return yield* Result.fail("symbolKey");
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (
          descriptor === undefined ||
          !descriptor.enumerable ||
          !("value" in descriptor)
        ) return yield* Result.fail("objectMember");
        Object.defineProperty(output, key, {
          value: yield* capturePlainDataNode(
            descriptor.value,
            state,
            depth + 1,
          ),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      return output;
    });
  } catch (cause) {
    return Result.fail(cause);
  } finally {
    state.ancestors.delete(value);
  }
}

function targetJson(target: ApplicationRuntimeTargetV1): JsonObject {
  const partition: Json = target.function.partition === null
    ? null
    : { ...target.function.partition };
  return {
    format: target.format,
    version: target.version,
    scopeId: target.scopeId,
    revisionId: target.revisionId,
    candidateId: target.candidateId,
    analysisId: target.analysisId,
    sourceArtifactRootSha256: target.sourceArtifactRootSha256,
    manifestSha256: target.manifestSha256,
    schemaSha256: target.schemaSha256,
    functionCatalogSha256: target.functionCatalogSha256,
    publicationSha256: target.publicationSha256,
    executionModulePath: target.executionModulePath,
    function: {
      path: target.function.path,
      moduleName: target.function.moduleName,
      exportName: target.function.exportName,
      kind: target.function.kind,
      visibility: target.function.visibility,
      args: target.function.args,
      returns: target.function.returns,
      partition,
      entrySha256: target.function.entrySha256,
    },
  };
}

function functionPath(moduleName: string, exportName: string): string {
  return exportName === "default" ? moduleName : `${moduleName}:${exportName}`;
}

function snapshotTarget(
  target: ApplicationRuntimeTargetV1,
): ApplicationRuntimeTargetV1 {
  const snapshot = structuredClone(target);
  freezeJson(snapshot);
  return snapshot;
}

function freezeJson(value: unknown): void {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return;
  if (Array.isArray(value)) {
    for (const item of value) freezeJson(item);
  } else {
    for (const item of Object.values(value)) freezeJson(item);
  }
  Object.freeze(value);
}

function error(
  operation: ApplicationRuntimeTargetV1Error["operation"],
  reason: ApplicationRuntimeTargetV1Error["reason"],
  cause?: unknown,
): ApplicationRuntimeTargetV1Error {
  return new ApplicationRuntimeTargetV1Error({
    operation,
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}
