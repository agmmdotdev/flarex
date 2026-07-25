import {
  bytesEqualFullScan,
  copyBytes,
  encodeBytesToLowercaseHex,
  isUint8Array,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Effect } from "effect";
import {
  SOURCE_ARTIFACT_V2_SHA256_BYTES,
} from "./Framing";
import type {
  SourceArtifactV2Sha256,
  SourceArtifactV2Sha256Error,
} from "./Sha256";

const TYPED_ARRAY_PROTOTYPE: object = Object.getPrototypeOf(Uint8Array.prototype);
const TYPED_ARRAY_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  TYPED_ARRAY_PROTOTYPE,
  "byteLength",
)?.get;

export type SourceArtifactV2ObjectKind =
  | "source-block"
  | "source-map-block"
  | "tree-node"
  | "module"
  | "completed-root";

export type SourceArtifactV2R2Operation =
  | "putImmutable"
  | "readImmutable"
  | "readImmutableAdmitted";

export interface SourceArtifactV2R2Budget {
  readonly maximumBodyBytes: number;
  readonly maximumHashBytes: number;
}

export class SourceArtifactV2R2InputError extends Data.TaggedError(
  "SourceArtifactV2R2InputError",
)<{
  readonly operation: SourceArtifactV2R2Operation;
  readonly field: string;
  readonly reason: "invalidBudget" | "invalidBytes" | "invalidDigest";
}> {}

export class SourceArtifactV2R2NotFoundError extends Data.TaggedError(
  "SourceArtifactV2R2NotFoundError",
)<{
  readonly key: string;
}> {}

export class SourceArtifactV2R2ResourceError extends Data.TaggedError(
  "SourceArtifactV2R2ResourceError",
)<{
  readonly operation: "put" | "get" | "readBody";
  readonly key: string;
}> {}

export class SourceArtifactV2R2CorruptionError extends Data.TaggedError(
  "SourceArtifactV2R2CorruptionError",
)<{
  readonly key: string;
  readonly reason:
    | "digestMismatch"
    | "keyCollision"
    | "invalidBody"
    | "invalidMetadata"
    | "sizeMismatch";
}> {}

export class SourceArtifactV2R2SettlementUncertainError extends Data.TaggedError(
  "SourceArtifactV2R2SettlementUncertainError",
)<{
  readonly key: string;
  readonly stage: "firstCreate" | "repeatCreate" | "reconcileRead";
}> {}

export type SourceArtifactV2R2Error =
  | SourceArtifactV2R2InputError
  | SourceArtifactV2R2NotFoundError
  | SourceArtifactV2R2ResourceError
  | SourceArtifactV2R2CorruptionError
  | SourceArtifactV2R2SettlementUncertainError
  | SourceArtifactV2Sha256Error;

export interface SourceArtifactV2R2Receipt {
  readonly key: string;
  readonly digest: Uint8Array;
  readonly byteLength: number;
}

export interface SourceArtifactV2R2Object {
  readonly key: string;
  readonly digest: Uint8Array;
  readonly bytes: Uint8Array;
}

export interface SourceArtifactV2R2AdmissionReceipt {
  readonly key: string;
  readonly digest: Uint8Array;
  readonly byteLength: number;
}

export interface SourceArtifactV2R2Store {
  readonly putImmutable: (
    kind: SourceArtifactV2ObjectKind,
    digest: unknown,
    bytes: unknown,
    budget: unknown,
  ) => Effect.Effect<SourceArtifactV2R2Receipt, SourceArtifactV2R2Error, never>;
  readonly readImmutable: (
    kind: SourceArtifactV2ObjectKind,
    digest: unknown,
    budget: unknown,
  ) => Effect.Effect<SourceArtifactV2R2Object, SourceArtifactV2R2Error, never>;
  readonly readImmutableAdmitted: <E>(
    kind: SourceArtifactV2ObjectKind,
    digest: unknown,
    admit: (
      receipt: SourceArtifactV2R2AdmissionReceipt,
    ) => Effect.Effect<void, E, never>,
  ) => Effect.Effect<SourceArtifactV2R2Object, SourceArtifactV2R2Error | E, never>;
}

export interface SourceArtifactV2R2Bucket {
  put(
    key: string,
    value: ArrayBuffer,
    options: { readonly onlyIf: { readonly etagDoesNotMatch: string } },
  ): PromiseLike<unknown>;
  get(key: string): PromiseLike<unknown>;
}

const resourceCause = new WeakMap<SourceArtifactV2R2ResourceError, unknown>();
const uncertainCause = new WeakMap<SourceArtifactV2R2SettlementUncertainError, unknown>();

class SourceArtifactV2R2BodyCorruption extends Error {}
class SourceArtifactV2R2BodySizeMismatch extends Error {}

export function sourceArtifactV2R2ResourceCause(
  error: SourceArtifactV2R2ResourceError,
): unknown {
  return resourceCause.get(error);
}

export function sourceArtifactV2R2UncertainCause(
  error: SourceArtifactV2R2SettlementUncertainError,
): unknown {
  return uncertainCause.get(error);
}

export function makeSourceArtifactV2R2Store(
  bucket: SourceArtifactV2R2Bucket,
  sha256: SourceArtifactV2Sha256,
): SourceArtifactV2R2Store {
  const readImmutableAdmitted = Effect.fn(
    "SourceArtifactV2R2.readImmutableAdmitted",
  )(
    function* <E>(
      kind: SourceArtifactV2ObjectKind,
      digestInput: unknown,
      admit: (
        receipt: SourceArtifactV2R2AdmissionReceipt,
      ) => Effect.Effect<void, E, never>,
    ): Effect.fn.Return<
      SourceArtifactV2R2Object,
      SourceArtifactV2R2Error | E
    > {
      const digest = yield* decodeDigest("readImmutableAdmitted", digestInput);
      const key = objectKey(kind, digest);
      const object = yield* Effect.tryPromise({
        try: () => Reflect.apply(bucket.get, bucket, [key]) as PromiseLike<unknown>,
        catch: cause => resourceFailure("get", key, cause),
      });
      if (object === null) {
        return yield* Effect.fail(new SourceArtifactV2R2NotFoundError({ key }));
      }
      if (!isNonArrayRecord(object)) {
        return yield* Effect.fail(new SourceArtifactV2R2CorruptionError({
          key,
          reason: "invalidMetadata",
        }));
      }
      let byteLength: unknown;
      try {
        byteLength = object.size;
      } catch (cause) {
        return yield* Effect.die(cause);
      }
      if (
        typeof byteLength !== "number" ||
        !Number.isSafeInteger(byteLength) ||
        byteLength < 1
      ) {
        return yield* Effect.fail(new SourceArtifactV2R2CorruptionError({
          key,
          reason: "invalidMetadata",
        }));
      }
      const admissionReceipt = Object.freeze({
        key,
        digest: copyBytes(digest),
        byteLength,
      });
      yield* admit(admissionReceipt);

      let body: unknown;
      try {
        body = object.body;
      } catch (cause) {
        return yield* Effect.die(cause);
      }
      if (!isNonArrayRecord(body)) {
        return yield* Effect.fail(new SourceArtifactV2R2CorruptionError({
          key,
          reason: "invalidBody",
        }));
      }
      const bytes = yield* Effect.tryPromise({
        try: signal => readBodyBounded(body, byteLength, signal, true),
        catch: cause =>
          cause instanceof SourceArtifactV2R2BodySizeMismatch
            ? new SourceArtifactV2R2CorruptionError({
              key,
              reason: "sizeMismatch",
            })
            : cause instanceof SourceArtifactV2R2BodyCorruption
              ? new SourceArtifactV2R2CorruptionError({
                key,
                reason: "invalidBody",
              })
              : resourceFailure("readBody", key, cause),
      });
      if (bytes.byteLength !== byteLength) {
        return yield* Effect.fail(new SourceArtifactV2R2CorruptionError({
          key,
          reason: "sizeMismatch",
        }));
      }
      yield* verifyDigest(key, bytes, digest, byteLength, sha256);
      return Object.freeze({
        key,
        digest: copyBytes(digest),
        bytes: copyBytes(bytes),
      });
    },
  );

  const readImmutable = Effect.fn("SourceArtifactV2R2.readImmutable")(
    function* (
      kind: SourceArtifactV2ObjectKind,
      digestInput: unknown,
      budgetInput: unknown,
    ): Effect.fn.Return<SourceArtifactV2R2Object, SourceArtifactV2R2Error> {
      const digest = yield* decodeDigest("readImmutable", digestInput);
      const budget = yield* decodeBudget("readImmutable", budgetInput);
      const key = objectKey(kind, digest);
      const bytes = yield* readRaw(key, budget.maximumBodyBytes);
      yield* verifyDigest(key, bytes, digest, budget.maximumHashBytes, sha256);
      return Object.freeze({ key, digest: copyBytes(digest), bytes: copyBytes(bytes) });
    },
  );

  const putImmutable = Effect.fn("SourceArtifactV2R2.putImmutable")(
    function* (
      kind: SourceArtifactV2ObjectKind,
      digestInput: unknown,
      bytesInput: unknown,
      budgetInput: unknown,
    ): Effect.fn.Return<SourceArtifactV2R2Receipt, SourceArtifactV2R2Error> {
      const digest = yield* decodeDigest("putImmutable", digestInput);
      const budget = yield* decodeBudget("putImmutable", budgetInput);
      const bytes = yield* captureBytes("putImmutable", bytesInput, budget.maximumBodyBytes);
      const key = objectKey(kind, digest);
      yield* verifyDigest(key, bytes, digest, budget.maximumHashBytes, sha256);
      return yield* Effect.uninterruptible(Effect.gen(function* () {
        const first = yield* createConditional(key, bytes).pipe(
          Effect.map(() => ({ kind: "settled" as const })),
          Effect.catchTag("SourceArtifactV2R2ResourceError", error =>
            Effect.succeed({ kind: "resource" as const, error })
          ),
        );
        if (first.kind === "settled") {
          return yield* verifyStoredObject(kind, digest, bytes, budget, readImmutable);
        }
        const reconciled = yield* reconcileStoredObject(
          kind,
          digest,
          bytes,
          budget,
          readImmutable,
          "firstCreate",
          first.error,
        );
        if (reconciled !== null) return reconciled;

        const repeated = yield* createConditional(key, bytes).pipe(
          Effect.map(() => ({ kind: "settled" as const })),
          Effect.catchTag("SourceArtifactV2R2ResourceError", error =>
            Effect.succeed({ kind: "resource" as const, error })
          ),
        );
        if (repeated.kind === "settled") {
          return yield* verifyStoredObject(kind, digest, bytes, budget, readImmutable);
        }
        const repeatedReconciliation = yield* reconcileStoredObject(
          kind,
          digest,
          bytes,
          budget,
          readImmutable,
          "repeatCreate",
          repeated.error,
        );
        if (repeatedReconciliation !== null) return repeatedReconciliation;
        const uncertain = new SourceArtifactV2R2SettlementUncertainError({
          key,
          stage: "repeatCreate",
        });
        uncertainCause.set(uncertain, sourceArtifactV2R2ResourceCause(repeated.error));
        return yield* Effect.fail(uncertain);
      }));
    },
  );

  const createConditional = Effect.fn("SourceArtifactV2R2.createConditional")(
    function* (
      key: string,
      bytes: Uint8Array,
    ): Effect.fn.Return<void, SourceArtifactV2R2ResourceError> {
      const body = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(body).set(bytes);
      const result = yield* Effect.uninterruptible(Effect.tryPromise({
        try: () => Reflect.apply(bucket.put, bucket, [
          key,
          body,
          { onlyIf: { etagDoesNotMatch: "*" } },
        ]) as PromiseLike<unknown>,
        catch: cause => resourceFailure("put", key, cause),
      }));
      if (result !== null && !isNonArrayRecord(result)) {
        return yield* Effect.die(new Error("R2 conditional put returned an invalid result."));
      }
    },
  );

  const readRaw = Effect.fn("SourceArtifactV2R2.readRaw")(
    function* (
      key: string,
      maximumBodyBytes: number,
    ): Effect.fn.Return<Uint8Array, SourceArtifactV2R2NotFoundError | SourceArtifactV2R2ResourceError | SourceArtifactV2R2CorruptionError> {
      const object = yield* Effect.tryPromise({
        try: () => Reflect.apply(bucket.get, bucket, [key]) as PromiseLike<unknown>,
        catch: cause => resourceFailure("get", key, cause),
      });
      if (object === null) return yield* Effect.fail(new SourceArtifactV2R2NotFoundError({ key }));
      if (!isNonArrayRecord(object)) {
        return yield* Effect.fail(new SourceArtifactV2R2CorruptionError({
          key,
          reason: "invalidBody",
        }));
      }
      let body: unknown;
      try {
        body = object.body;
      } catch (cause) {
        return yield* Effect.die(cause);
      }
      if (!isNonArrayRecord(body) || typeof body.getReader !== "function") {
        return yield* Effect.fail(new SourceArtifactV2R2CorruptionError({
          key,
          reason: "invalidBody",
        }));
      }
      return yield* Effect.tryPromise({
        try: signal => readBodyBounded(body, maximumBodyBytes, signal),
        catch: cause => cause instanceof SourceArtifactV2R2BodyCorruption
          ? new SourceArtifactV2R2CorruptionError({ key, reason: "invalidBody" })
          : resourceFailure("readBody", key, cause),
      });
    },
  );

  return Object.freeze({
    putImmutable,
    readImmutable,
    readImmutableAdmitted,
  });
}

function decodeBudget(
  operation: SourceArtifactV2R2Operation,
  value: unknown,
): Effect.Effect<SourceArtifactV2R2Budget, SourceArtifactV2R2InputError> {
  if (
    !isNonArrayRecord(value) ||
    typeof value.maximumBodyBytes !== "number" ||
    !Number.isSafeInteger(value.maximumBodyBytes) || value.maximumBodyBytes < 1 ||
    typeof value.maximumHashBytes !== "number" ||
    !Number.isSafeInteger(value.maximumHashBytes) || value.maximumHashBytes < 1
  ) {
    return Effect.fail(new SourceArtifactV2R2InputError({
      operation,
      field: "budget",
      reason: "invalidBudget",
    }));
  }
  return Effect.succeed(Object.freeze({
    maximumBodyBytes: value.maximumBodyBytes,
    maximumHashBytes: value.maximumHashBytes,
  }));
}

function decodeDigest(
  operation: SourceArtifactV2R2Operation,
  value: unknown,
): Effect.Effect<Uint8Array, SourceArtifactV2R2InputError> {
  return isUint8ArrayWithByteLength(value, SOURCE_ARTIFACT_V2_SHA256_BYTES)
    ? Effect.succeed(copyBytes(value))
    : Effect.fail(new SourceArtifactV2R2InputError({
      operation,
      field: "digest",
      reason: "invalidDigest",
    }));
}

function captureBytes(
  operation: SourceArtifactV2R2Operation,
  value: unknown,
  maximum: number,
): Effect.Effect<Uint8Array, SourceArtifactV2R2InputError> {
  const byteLength = intrinsicUint8ArrayByteLength(value);
  if (byteLength === undefined || byteLength === 0 || byteLength > maximum) {
    return Effect.fail(new SourceArtifactV2R2InputError({
      operation,
      field: "bytes",
      reason: byteLength !== undefined && byteLength > maximum
        ? "invalidBudget"
        : "invalidBytes",
    }));
  }
  return Effect.succeed(copyBytes(value as Uint8Array));
}

function intrinsicUint8ArrayByteLength(value: unknown): number | undefined {
  if (!isUint8Array(value) || TYPED_ARRAY_BYTE_LENGTH_GETTER === undefined) return undefined;
  try {
    const byteLength: unknown = Reflect.apply(TYPED_ARRAY_BYTE_LENGTH_GETTER, value, []);
    return typeof byteLength === "number" ? byteLength : undefined;
  } catch {
    return undefined;
  }
}

function verifyDigest(
  key: string,
  bytes: Uint8Array,
  expected: Uint8Array,
  maximumHashBytes: number,
  sha256: SourceArtifactV2Sha256,
): Effect.Effect<void, SourceArtifactV2Sha256Error | SourceArtifactV2R2CorruptionError> {
  return sha256(bytes, { maximumInputBytes: maximumHashBytes }).pipe(
    Effect.flatMap(actual => bytesEqualFullScan(actual, expected)
      ? Effect.void
      : Effect.fail(new SourceArtifactV2R2CorruptionError({
        key,
        reason: "digestMismatch",
      }))),
  );
}

function verifyStoredObject(
  kind: SourceArtifactV2ObjectKind,
  digest: Uint8Array,
  expectedBytes: Uint8Array,
  budget: SourceArtifactV2R2Budget,
  readImmutable: SourceArtifactV2R2Store["readImmutable"],
): Effect.Effect<SourceArtifactV2R2Receipt, SourceArtifactV2R2Error> {
  return readImmutable(kind, digest, budget).pipe(
    Effect.flatMap(stored => bytesEqualFullScan(stored.bytes, expectedBytes)
      ? Effect.succeed(Object.freeze({
        key: stored.key,
        digest: copyBytes(stored.digest),
        byteLength: stored.bytes.byteLength,
      }))
      : Effect.fail(new SourceArtifactV2R2CorruptionError({
        key: stored.key,
        reason: "keyCollision",
      }))),
  );
}

function reconcileStoredObject(
  kind: SourceArtifactV2ObjectKind,
  digest: Uint8Array,
  expectedBytes: Uint8Array,
  budget: SourceArtifactV2R2Budget,
  readImmutable: SourceArtifactV2R2Store["readImmutable"],
  stage: "firstCreate" | "repeatCreate",
  primary: SourceArtifactV2R2ResourceError,
): Effect.Effect<SourceArtifactV2R2Receipt | null, SourceArtifactV2R2Error> {
  return readImmutable(kind, digest, budget).pipe(
    Effect.flatMap(stored => {
      if (!bytesEqualFullScan(stored.bytes, expectedBytes)) {
        return Effect.fail(new SourceArtifactV2R2CorruptionError({
          key: stored.key,
          reason: "keyCollision",
        }));
      }
      return Effect.succeed(Object.freeze({
        key: stored.key,
        digest: copyBytes(stored.digest),
        byteLength: stored.bytes.byteLength,
      }));
    }),
    Effect.catchTag("SourceArtifactV2R2NotFoundError", () => Effect.succeed(null)),
    Effect.catchTag("SourceArtifactV2R2ResourceError", secondary => {
      const uncertain = new SourceArtifactV2R2SettlementUncertainError({
        key: objectKey(kind, digest),
        stage: "reconcileRead",
      });
      uncertainCause.set(uncertain, Object.freeze({
        primary: sourceArtifactV2R2ResourceCause(primary),
        secondary: sourceArtifactV2R2ResourceCause(secondary),
        createStage: stage,
      }));
      return Effect.fail(uncertain);
    }),
  );
}

async function readBodyBounded(
  body: Readonly<Record<PropertyKey, unknown>>,
  maximum: number,
  signal: AbortSignal,
  exactSize = false,
): Promise<Uint8Array> {
  let getReader: unknown;
  let reader: unknown;
  try {
    getReader = body.getReader;
    if (typeof getReader !== "function") {
      throw new SourceArtifactV2R2BodyCorruption("R2 body has no reader.");
    }
    reader = Reflect.apply(getReader, body, []);
  } catch (cause) {
    if (cause instanceof SourceArtifactV2R2BodyCorruption) throw cause;
    throw new SourceArtifactV2R2BodyCorruption("R2 body reader is invalid.");
  }
  if (!isNonArrayRecord(reader)) {
    throw new SourceArtifactV2R2BodyCorruption("R2 body reader is invalid.");
  }
  let read: unknown;
  let cancel: unknown;
  let releaseLock: unknown;
  try {
    read = reader.read;
    cancel = reader.cancel;
    releaseLock = reader.releaseLock;
  } catch {
    throw new SourceArtifactV2R2BodyCorruption("R2 body reader methods are invalid.");
  }
  if (
    typeof read !== "function" ||
    !(cancel === undefined || typeof cancel === "function") ||
    !(releaseLock === undefined || typeof releaseLock === "function")
  ) {
    throw new SourceArtifactV2R2BodyCorruption("R2 body reader methods are invalid.");
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  const abort = () => {
    if (typeof cancel !== "function") return;
    try {
      void Promise.resolve(Reflect.apply(cancel, reader, ["interrupted"])).catch(() => undefined);
    } catch {
      // Cancellation is best-effort and must not replace the interruption Cause.
    }
  };
  signal.addEventListener("abort", abort, { once: true });
  let hasPrimaryFailure = false;
  try {
    try {
      while (true) {
        const item = await Reflect.apply(read, reader, []) as unknown;
        if (!isNonArrayRecord(item) || typeof item.done !== "boolean") {
          throw new SourceArtifactV2R2BodyCorruption("R2 body reader returned an invalid result.");
        }
        if (item.done) break;
        const chunkByteLength = intrinsicUint8ArrayByteLength(item.value);
        if (chunkByteLength === undefined) {
          throw new SourceArtifactV2R2BodyCorruption("R2 body reader returned invalid bytes.");
        }
        const nextTotal = total + chunkByteLength;
        if (!Number.isSafeInteger(nextTotal) || nextTotal > maximum) {
          if (exactSize) {
            throw new SourceArtifactV2R2BodySizeMismatch(
              "R2 object body exceeded its stored byte-size metadata.",
            );
          }
          throw new SourceArtifactV2R2BodyCorruption(
            "R2 object exceeded its caller-supplied byte budget.",
          );
        }
        const chunk = copyBytes(item.value as Uint8Array);
        total = nextTotal;
        chunks.push(chunk);
      }
    } catch (cause) {
      hasPrimaryFailure = true;
      if (
        (
          cause instanceof SourceArtifactV2R2BodyCorruption ||
          cause instanceof SourceArtifactV2R2BodySizeMismatch
        ) &&
        typeof cancel === "function"
      ) {
        try {
          void Promise.resolve(Reflect.apply(cancel, reader, [cause.message])).catch(() => undefined);
        } catch {
          // The corruption remains primary; cancellation is best-effort cleanup.
        }
      }
      throw cause;
    }
  } finally {
    signal.removeEventListener("abort", abort);
    if (typeof releaseLock === "function") {
      try {
        Reflect.apply(releaseLock, reader, []);
      } catch (cause) {
        if (!hasPrimaryFailure) throw cause;
      }
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function resourceFailure(
  operation: SourceArtifactV2R2ResourceError["operation"],
  key: string,
  cause: unknown,
): SourceArtifactV2R2ResourceError {
  const error = new SourceArtifactV2R2ResourceError({ operation, key });
  resourceCause.set(error, cause);
  return error;
}

function objectKey(kind: SourceArtifactV2ObjectKind, digest: Uint8Array): string {
  return `source-artifact-v2/${kind}/${encodeBytesToLowercaseHex(digest)}`;
}
