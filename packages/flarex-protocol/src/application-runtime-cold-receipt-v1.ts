import { Data, Result, Schema } from "effect";

import { encodeCanonicalJson, type JsonObject } from "./json";
import { StrictParseOptions, StrictStructOptions } from "./strict-schema-options";

export const APPLICATION_RUNTIME_COLD_RECEIPT_FORMAT_V1 =
  "flarex.application-runtime-cold-receipt" as const;
export const APPLICATION_RUNTIME_COLD_RECEIPT_VERSION_V1 = 1 as const;
export const MAX_APPLICATION_RUNTIME_COLD_RECEIPT_BYTES_V1 = 16_384;
export const MAX_APPLICATION_RUNTIME_HOST_IDENTITY_CODE_UNITS_V1 = 1_024;

const UTF8 = new TextEncoder();
const BoundedText = Schema.String.check(Schema.makeFilter(value =>
  value.length > 0 && UTF8.encode(value).byteLength <= 4_096
    ? undefined
    : "Expected nonempty text of at most 4096 UTF-8 bytes"
));
const BoundedIdentity = Schema.String.check(Schema.makeFilter(value =>
  value.length > 0 &&
      value.length <= MAX_APPLICATION_RUNTIME_HOST_IDENTITY_CODE_UNITS_V1
    ? undefined
    : "Expected a nonempty identity of at most 1024 code units"
));
const LowercaseSha256 = Schema.String.check(Schema.makeFilter(value =>
  /^[0-9a-f]{64}$/.test(value)
    ? undefined
    : "Expected a lowercase SHA-256 digest"
));
const CompatibilityDate = Schema.String.check(Schema.makeFilter(value =>
  isCompatibilityDate(value) ? undefined : "Expected a canonical date"
));

const ApplicationRuntimeColdReceiptV1StructuralSchema = Schema.Struct({
  format: Schema.Literal(APPLICATION_RUNTIME_COLD_RECEIPT_FORMAT_V1),
  version: Schema.Literal(APPLICATION_RUNTIME_COLD_RECEIPT_VERSION_V1),
  status: Schema.Literal("resolved"),
  runtimeHostIdentity: BoundedIdentity,
  compatibilityDate: CompatibilityDate,
  sourceArtifactRootSha256: LowercaseSha256,
  manifestSha256: LowercaseSha256,
  publicationSha256: LowercaseSha256,
  runtimeTargetSha256: LowercaseSha256,
  functionPath: BoundedText,
  functionKind: Schema.Union([
    Schema.Literal("query"),
    Schema.Literal("mutation"),
    Schema.Literal("workflowMutation"),
    Schema.Literal("action"),
  ]),
  visibility: Schema.Union([
    Schema.Literal("public"),
    Schema.Literal("internal"),
  ]),
}).annotate(StrictStructOptions);

export type ApplicationRuntimeColdReceiptV1 =
  typeof ApplicationRuntimeColdReceiptV1StructuralSchema.Type;

export interface CanonicalApplicationRuntimeColdReceiptV1 {
  readonly receipt: ApplicationRuntimeColdReceiptV1;
  readonly canonicalText: string;
  readonly canonicalBytes: Uint8Array;
}

export class ApplicationRuntimeColdReceiptV1Error extends Data.TaggedError(
  "ApplicationRuntimeColdReceiptV1Error",
)<{
  readonly operation: "canonicalize";
  readonly reason: "invalidShape" | "bytesExceeded";
  readonly cause?: unknown;
}> {}

const decodeShape = Schema.decodeUnknownResult(
  ApplicationRuntimeColdReceiptV1StructuralSchema,
  StrictParseOptions,
);

export function canonicalizeApplicationRuntimeColdReceiptV1(
  value: unknown,
): Result.Result<
  CanonicalApplicationRuntimeColdReceiptV1,
  ApplicationRuntimeColdReceiptV1Error
> {
  return captureReceipt(value).pipe(
    Result.flatMap(captured => decodeShape(captured).pipe(
      Result.mapError(cause => new ApplicationRuntimeColdReceiptV1Error({
        operation: "canonicalize",
        reason: "invalidShape",
        cause,
      })),
    )),
    Result.flatMap(decoded => {
      const receipt = Object.freeze({ ...decoded });
      const canonicalText = encodeCanonicalJson(
        receiptJson(receipt),
        issue => {
          throw new Error(
            `Application runtime cold receipt invariant: ${issue.reason}`,
          );
        },
      );
      const canonicalBytes = UTF8.encode(canonicalText);
      return canonicalBytes.byteLength <=
          MAX_APPLICATION_RUNTIME_COLD_RECEIPT_BYTES_V1
        ? Result.succeed(Object.freeze({
          receipt,
          canonicalText,
          canonicalBytes,
        }))
        : Result.fail(new ApplicationRuntimeColdReceiptV1Error({
          operation: "canonicalize",
          reason: "bytesExceeded",
        }));
    }),
  );
}

function receiptJson(receipt: ApplicationRuntimeColdReceiptV1): JsonObject {
  return {
    format: receipt.format,
    version: receipt.version,
    status: receipt.status,
    runtimeHostIdentity: receipt.runtimeHostIdentity,
    compatibilityDate: receipt.compatibilityDate,
    sourceArtifactRootSha256: receipt.sourceArtifactRootSha256,
    manifestSha256: receipt.manifestSha256,
    publicationSha256: receipt.publicationSha256,
    runtimeTargetSha256: receipt.runtimeTargetSha256,
    functionPath: receipt.functionPath,
    functionKind: receipt.functionKind,
    visibility: receipt.visibility,
  };
}

function captureReceipt(
  value: unknown,
): Result.Result<Readonly<Record<string, unknown>>, ApplicationRuntimeColdReceiptV1Error> {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return invalidShape();
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return invalidShape();
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => typeof key !== "string")) return invalidShape();
    const output: Record<string, unknown> = Object.create(null);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined || !descriptor.enumerable ||
        !("value" in descriptor)
      ) return invalidShape();
      Object.defineProperty(output, key, {
        value: descriptor.value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return Result.succeed(output);
  } catch (cause) {
    return Result.fail(new ApplicationRuntimeColdReceiptV1Error({
      operation: "canonicalize",
      reason: "invalidShape",
      cause,
    }));
  }
}

function invalidShape(): Result.Result<
  never,
  ApplicationRuntimeColdReceiptV1Error
> {
  return Result.fail(new ApplicationRuntimeColdReceiptV1Error({
    operation: "canonicalize",
    reason: "invalidShape",
  }));
}

function isCompatibilityDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const milliseconds = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(milliseconds) &&
    new Date(milliseconds).toISOString().slice(0, 10) === value;
}
