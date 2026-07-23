import {
  bytesEqualFullScan,
  copyBytes,
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonNegativeSafeInteger } from "@flarex/utils/numbers";
import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Effect } from "effect";
import type {
  SemanticArtifactV1Sha256,
  SemanticArtifactV1Sha256Error,
} from "./Sha256";
import { semanticArtifactV1IntrinsicByteLength } from "./Bytes";

const SHA256_BYTES = 32;

export type SemanticArtifactV1ObjectKind = "block" | "tree" | "root";

export interface SemanticArtifactV1R2Budget {
  readonly maximumCalls: number;
  readonly maximumBodyBytes: number;
  readonly maximumHashBytes: number;
}

export interface SemanticArtifactV1R2Usage {
  readonly calls: number;
  readonly bodyBytes: number;
  readonly hashBytes: number;
}

export class SemanticArtifactV1R2InputError extends Data.TaggedError(
  "SemanticArtifactV1R2InputError",
)<{
  readonly operation: "putImmutable" | "readImmutable";
  readonly reason: "invalidBudget" | "invalidDigest" | "invalidBytes" | "budgetExceeded";
}> {}

export class SemanticArtifactV1R2NotFoundError extends Data.TaggedError(
  "SemanticArtifactV1R2NotFoundError",
)<{ readonly key: string }> {}

export class SemanticArtifactV1R2ResourceError extends Data.TaggedError(
  "SemanticArtifactV1R2ResourceError",
)<{
  readonly operation: "put" | "get" | "readBody";
  readonly key: string;
}> {}

export class SemanticArtifactV1R2CorruptionError extends Data.TaggedError(
  "SemanticArtifactV1R2CorruptionError",
)<{
  readonly key: string;
  readonly reason: "invalidBody" | "digestMismatch" | "keyCollision";
}> {}

export class SemanticArtifactV1R2SettlementUncertainError extends Data.TaggedError(
  "SemanticArtifactV1R2SettlementUncertainError",
)<{
  readonly key: string;
  readonly stage: "firstCreate" | "repeatCreate" | "reconcileRead";
}> {}

export type SemanticArtifactV1R2Error =
  | SemanticArtifactV1R2InputError
  | SemanticArtifactV1R2NotFoundError
  | SemanticArtifactV1R2ResourceError
  | SemanticArtifactV1R2CorruptionError
  | SemanticArtifactV1R2SettlementUncertainError
  | SemanticArtifactV1Sha256Error;

export interface SemanticArtifactV1R2Receipt {
  readonly key: string;
  readonly digest: Uint8Array;
  readonly byteLength: number;
  readonly usage: SemanticArtifactV1R2Usage;
}

export interface SemanticArtifactV1R2Object extends SemanticArtifactV1R2Receipt {
  readonly bytes: Uint8Array;
}

export interface SemanticArtifactV1R2Store {
  readonly putImmutable: (
    kind: SemanticArtifactV1ObjectKind,
    digest: unknown,
    bytes: unknown,
    budget: unknown,
  ) => Effect.Effect<SemanticArtifactV1R2Receipt, SemanticArtifactV1R2Error>;
  readonly readImmutable: (
    kind: SemanticArtifactV1ObjectKind,
    digest: unknown,
    budget: unknown,
  ) => Effect.Effect<SemanticArtifactV1R2Object, SemanticArtifactV1R2Error>;
}

export interface SemanticArtifactV1R2Bucket {
  put(
    key: string,
    body: ArrayBuffer,
    options: { readonly onlyIf: { readonly etagDoesNotMatch: string } },
  ): PromiseLike<unknown>;
  get(key: string): PromiseLike<unknown>;
}

const resourceCause = new WeakMap<SemanticArtifactV1R2ResourceError, unknown>();
const uncertainCause = new WeakMap<SemanticArtifactV1R2SettlementUncertainError, unknown>();

class BodyFailure extends Error {}
class BodyBudgetFailure extends Error {}

export function semanticArtifactV1R2ResourceCause(
  error: SemanticArtifactV1R2ResourceError,
): unknown {
  return resourceCause.get(error);
}

export function semanticArtifactV1R2UncertainCause(
  error: SemanticArtifactV1R2SettlementUncertainError,
): unknown {
  return uncertainCause.get(error);
}

export function makeSemanticArtifactV1R2Store(
  bucket: SemanticArtifactV1R2Bucket,
  sha256: SemanticArtifactV1Sha256,
): SemanticArtifactV1R2Store {
  const readBounded = Effect.fn("SemanticArtifactV1R2.readBody")(
    function* (
      key: string,
      maximum: number,
    ): Effect.fn.Return<
      Uint8Array,
      SemanticArtifactV1R2InputError | SemanticArtifactV1R2NotFoundError |
        SemanticArtifactV1R2ResourceError |
        SemanticArtifactV1R2CorruptionError
    > {
      const object = yield* Effect.tryPromise({
        try: () => Reflect.apply(bucket.get, bucket, [key]) as PromiseLike<unknown>,
        catch: cause => resourceFailure("get", key, cause),
      });
      if (object === null) {
        return yield* Effect.fail(new SemanticArtifactV1R2NotFoundError({ key }));
      }
      if (!isNonArrayRecord(object)) {
        return yield* Effect.fail(new SemanticArtifactV1R2CorruptionError({
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
        return yield* Effect.fail(new SemanticArtifactV1R2CorruptionError({
          key,
          reason: "invalidBody",
        }));
      }
      return yield* Effect.tryPromise({
        try: signal => readBody(body, maximum, signal),
        catch: cause => cause instanceof BodyBudgetFailure
          ? new SemanticArtifactV1R2InputError({
            operation: "readImmutable",
            reason: "budgetExceeded",
          })
          : cause instanceof BodyFailure
            ? new SemanticArtifactV1R2CorruptionError({ key, reason: "invalidBody" })
            : resourceFailure("readBody", key, cause),
      });
    },
  );

  const readImmutable = Effect.fn("SemanticArtifactV1R2.readImmutable")(
    function* (
      kind: SemanticArtifactV1ObjectKind,
      digestInput: unknown,
      budgetInput: unknown,
    ): Effect.fn.Return<SemanticArtifactV1R2Object, SemanticArtifactV1R2Error> {
      const digest = yield* captureDigest("readImmutable", digestInput);
      const budget = yield* captureBudget("readImmutable", budgetInput);
      if (budget.maximumCalls < 2) return yield* budgetExceeded("readImmutable");
      const key = keyFor(kind, digest);
      const bytes = yield* readBounded(key, budget.maximumBodyBytes);
      if (bytes.byteLength > budget.maximumHashBytes) {
        return yield* budgetExceeded("readImmutable");
      }
      const actual = yield* sha256(bytes, { maximumInputBytes: budget.maximumHashBytes });
      if (!bytesEqualFullScan(actual, digest)) {
        return yield* Effect.fail(new SemanticArtifactV1R2CorruptionError({
          key,
          reason: "digestMismatch",
        }));
      }
      return Object.freeze({
        key,
        digest: copyBytes(digest),
        bytes,
        byteLength: bytes.byteLength,
        usage: Object.freeze({
          calls: 2,
          bodyBytes: checkedMultiply(bytes.byteLength, 2),
          hashBytes: bytes.byteLength,
        }),
      });
    },
  );

  const putImmutable = Effect.fn("SemanticArtifactV1R2.putImmutable")(
    function* (
      kind: SemanticArtifactV1ObjectKind,
      digestInput: unknown,
      bytesInput: unknown,
      budgetInput: unknown,
    ): Effect.fn.Return<SemanticArtifactV1R2Receipt, SemanticArtifactV1R2Error> {
      const digest = yield* captureDigest("putImmutable", digestInput);
      const budget = yield* captureBudget("putImmutable", budgetInput);
      const inputByteLength = semanticArtifactV1IntrinsicByteLength(bytesInput);
      if (inputByteLength === undefined || inputByteLength === 0) {
        return yield* Effect.fail(new SemanticArtifactV1R2InputError({
          operation: "putImmutable",
          reason: "invalidBytes",
        }));
      }
      const settledHashBytes = checkedDouble(inputByteLength);
      const firstSettlementBodyBytes = checkedMultiply(inputByteLength, 5);
      if (
        budget.maximumCalls < 6 ||
        firstSettlementBodyBytes > budget.maximumBodyBytes ||
        settledHashBytes > budget.maximumHashBytes
      ) {
        return yield* budgetExceeded("putImmutable");
      }
      const bytes = copyBytes(bytesInput as Uint8Array);
      const key = keyFor(kind, digest);
      const actual = yield* sha256(bytes, { maximumInputBytes: budget.maximumHashBytes });
      if (!bytesEqualFullScan(actual, digest)) {
        return yield* Effect.fail(new SemanticArtifactV1R2CorruptionError({
          key,
          reason: "digestMismatch",
        }));
      }
      return yield* Effect.uninterruptible(Effect.gen(function* () {
        const first = yield* attemptCreate(bucket, key, bytes).pipe(Effect.exit);
        const firstRead = yield* reconcileMaybe(
          kind,
          digest,
          bytes,
          budget,
          readImmutable,
          2,
          checkedMultiply(bytes.byteLength, 2),
          bytes.byteLength,
        ).pipe(
          Effect.catchTag(
            "SemanticArtifactV1R2ResourceError",
            failure => settlementUncertain(
              key,
              "reconcileRead",
              Object.freeze({
                create: first._tag === "Failure" ? first.cause : undefined,
                read: failure,
              }),
            ),
          ),
          Effect.catchTag(
            "SemanticArtifactV1Sha256ResourceError",
            failure => settlementUncertain(
              key,
              "reconcileRead",
              Object.freeze({
                create: first._tag === "Failure" ? first.cause : undefined,
                read: failure,
              }),
            ),
          ),
        );
        if (firstRead !== null) return firstRead;
        const second = yield* attemptCreate(bucket, key, bytes).pipe(Effect.exit);
        const secondRead = yield* reconcileMaybe(
          kind,
          digest,
          bytes,
          budget,
          readImmutable,
          4,
          checkedMultiply(bytes.byteLength, 3),
          bytes.byteLength,
        ).pipe(
          Effect.catchTag(
            "SemanticArtifactV1R2ResourceError",
            failure => settlementUncertain(
              key,
              "reconcileRead",
              Object.freeze({
                first: first._tag === "Failure" ? first.cause : undefined,
                second: second._tag === "Failure" ? second.cause : undefined,
                read: failure,
              }),
            ),
          ),
          Effect.catchTag(
            "SemanticArtifactV1Sha256ResourceError",
            failure => settlementUncertain(
              key,
              "reconcileRead",
              Object.freeze({
                first: first._tag === "Failure" ? first.cause : undefined,
                second: second._tag === "Failure" ? second.cause : undefined,
                read: failure,
              }),
            ),
          ),
        );
        if (secondRead !== null) return secondRead;
        const uncertain = new SemanticArtifactV1R2SettlementUncertainError({
          key,
          stage: "repeatCreate",
        });
        uncertainCause.set(uncertain, Object.freeze({
          first: first._tag === "Failure" ? first.cause : undefined,
          second: second._tag === "Failure" ? second.cause : undefined,
        }));
        return yield* Effect.fail(uncertain);
      }));
    },
  );
  return Object.freeze({ putImmutable, readImmutable });
}

function captureBudget(
  operation: "putImmutable" | "readImmutable",
  input: unknown,
): Effect.Effect<SemanticArtifactV1R2Budget, SemanticArtifactV1R2InputError> {
  if (
    !isNonArrayRecord(input) ||
    !isNonNegativeSafeInteger(input.maximumCalls) ||
    !isNonNegativeSafeInteger(input.maximumBodyBytes) ||
    !isNonNegativeSafeInteger(input.maximumHashBytes)
  ) {
    return Effect.fail(new SemanticArtifactV1R2InputError({
      operation,
      reason: "invalidBudget",
    }));
  }
  return Effect.succeed(Object.freeze({
    maximumCalls: input.maximumCalls,
    maximumBodyBytes: input.maximumBodyBytes,
    maximumHashBytes: input.maximumHashBytes,
  }));
}

function captureDigest(
  operation: "putImmutable" | "readImmutable",
  input: unknown,
): Effect.Effect<Uint8Array, SemanticArtifactV1R2InputError> {
  return isUint8ArrayWithByteLength(input, SHA256_BYTES)
    ? Effect.succeed(copyBytes(input))
    : Effect.fail(new SemanticArtifactV1R2InputError({
      operation,
      reason: "invalidDigest",
    }));
}

function budgetExceeded(
  operation: "putImmutable" | "readImmutable",
): Effect.Effect<never, SemanticArtifactV1R2InputError> {
  return Effect.fail(new SemanticArtifactV1R2InputError({
    operation,
    reason: "budgetExceeded",
  }));
}

function settlementUncertain(
  key: string,
  stage: SemanticArtifactV1R2SettlementUncertainError["stage"],
  cause: unknown,
): Effect.Effect<never, SemanticArtifactV1R2SettlementUncertainError> {
  const error = new SemanticArtifactV1R2SettlementUncertainError({ key, stage });
  uncertainCause.set(error, cause);
  return Effect.fail(error);
}

function attemptCreate(
  bucket: SemanticArtifactV1R2Bucket,
  key: string,
  bytes: Uint8Array,
): Effect.Effect<void, SemanticArtifactV1R2ResourceError> {
  return Effect.tryPromise({
    try: () => Reflect.apply(bucket.put, bucket, [
      key,
      copyBytesToArrayBuffer(bytes),
      { onlyIf: { etagDoesNotMatch: "*" } },
    ]) as PromiseLike<unknown>,
    catch: cause => resourceFailure("put", key, cause),
  }).pipe(Effect.asVoid);
}

function reconcileExact(
  kind: SemanticArtifactV1ObjectKind,
  digest: Uint8Array,
  expected: Uint8Array,
  budget: SemanticArtifactV1R2Budget,
  read: SemanticArtifactV1R2Store["readImmutable"],
  baseCalls: number,
  baseBodyBytes: number,
  baseHashBytes: number,
): Effect.Effect<SemanticArtifactV1R2Receipt, SemanticArtifactV1R2Error> {
  return read(kind, digest, {
    maximumCalls: budget.maximumCalls - baseCalls,
    maximumBodyBytes: budget.maximumBodyBytes - baseBodyBytes,
    maximumHashBytes: budget.maximumHashBytes - baseHashBytes,
  }).pipe(
    Effect.flatMap(value => bytesEqualFullScan(value.bytes, expected)
      ? Effect.succeed(Object.freeze({
        key: value.key,
        digest: copyBytes(value.digest),
        byteLength: value.byteLength,
        usage: Object.freeze({
          calls: baseCalls + value.usage.calls,
          bodyBytes: baseBodyBytes + value.usage.bodyBytes,
          hashBytes: baseHashBytes + value.usage.hashBytes,
        }),
      }))
      : Effect.fail(new SemanticArtifactV1R2CorruptionError({
        key: value.key,
        reason: "keyCollision",
      }))),
  );
}

function reconcileMaybe(
  kind: SemanticArtifactV1ObjectKind,
  digest: Uint8Array,
  expected: Uint8Array,
  budget: SemanticArtifactV1R2Budget,
  read: SemanticArtifactV1R2Store["readImmutable"],
  baseCalls: number,
  baseBodyBytes: number,
  baseHashBytes: number,
): Effect.Effect<SemanticArtifactV1R2Receipt | null, SemanticArtifactV1R2Error> {
  return reconcileExact(
    kind,
    digest,
    expected,
    budget,
    read,
    baseCalls,
    baseBodyBytes,
    baseHashBytes,
  ).pipe(
    Effect.catchTag("SemanticArtifactV1R2NotFoundError", () => Effect.succeed(null)),
  );
}

function checkedMultiply(value: number, multiplier: number): number {
  const multiplied = value * multiplier;
  if (!Number.isSafeInteger(multiplied)) {
    throw new Error("Semantic artifact R2 byte accounting overflow.");
  }
  return multiplied;
}

function checkedDouble(value: number): number {
  return checkedMultiply(value, 2);
}

async function readBody(
  body: Readonly<Record<PropertyKey, unknown>>,
  maximum: number,
  signal: AbortSignal,
): Promise<Uint8Array> {
  let reader: unknown;
  try {
    const getReader = body.getReader;
    if (typeof getReader !== "function") throw new BodyFailure();
    reader = Reflect.apply(getReader, body, []);
  } catch {
    throw new BodyFailure();
  }
  if (!isNonArrayRecord(reader) || typeof reader.read !== "function") {
    throw new BodyFailure();
  }
  const read = reader.read;
  const cancel = reader.cancel;
  const releaseLock = reader.releaseLock;
  if (
    !(cancel === undefined || typeof cancel === "function") ||
    !(releaseLock === undefined || typeof releaseLock === "function")
  ) throw new BodyFailure();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const abort = () => {
    if (typeof cancel !== "function") return;
    try {
      void Promise.resolve(Reflect.apply(cancel, reader, ["interrupted"])).catch(() => undefined);
    } catch {
      // Cancellation is best effort and cannot replace the interruption Cause.
    }
  };
  signal.addEventListener("abort", abort, { once: true });
  let primaryFailure = false;
  try {
    try {
      while (true) {
        const item = await Reflect.apply(read, reader, []) as unknown;
        if (!isNonArrayRecord(item) || typeof item.done !== "boolean") {
          throw new BodyFailure();
        }
        if (item.done) break;
        const chunkByteLength = semanticArtifactV1IntrinsicByteLength(item.value);
        if (chunkByteLength === undefined) throw new BodyFailure();
        const next = total + chunkByteLength;
        if (
          !Number.isSafeInteger(next) ||
          checkedMultiply(next, 2) > maximum
        ) throw new BodyBudgetFailure();
        const chunk = copyBytes(item.value as Uint8Array);
        chunks.push(chunk);
        total = next;
      }
    } catch (cause) {
      primaryFailure = true;
      if (
        (cause instanceof BodyFailure || cause instanceof BodyBudgetFailure) &&
        typeof cancel === "function"
      ) {
        try {
          void Promise.resolve(Reflect.apply(cancel, reader, ["invalid body"])).catch(
            () => undefined,
          );
        } catch {
          // The bounded-body failure remains primary.
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
        if (!primaryFailure) throw cause;
      }
    }
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function resourceFailure(
  operation: SemanticArtifactV1R2ResourceError["operation"],
  key: string,
  cause: unknown,
): SemanticArtifactV1R2ResourceError {
  const error = new SemanticArtifactV1R2ResourceError({ operation, key });
  resourceCause.set(error, cause);
  return error;
}

function keyFor(kind: SemanticArtifactV1ObjectKind, digest: Uint8Array): string {
  return `semantic-artifact-v1/${kind}/${encodeBytesToLowercaseHex(digest)}`;
}
