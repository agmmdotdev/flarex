import { bytesEqualFullScan, copyBytes, isUint8Array, uint8ArrayByteLength } from "@flarex/utils/bytes";
import { inspectTrustedWorkflowTaskBinding, type TrustedWorkflowTaskBinding } from "@flarex/durable-task/internal/run-creation-v1";
import { MAX_TRUSTED_WORKFLOW_CHECKPOINT_BYTES, TrustedWorkflowCheckpointDescriptorSchema } from "@flarex/durable-task/internal/run-attempt-v1";
import { and, eq } from "drizzle-orm";
import { Data, Effect, Option, Result, Schema } from "effect";
import type { TrustedScopeAuthority } from "../scope/scopeAuthorityResolution";
import type { AppRowTransaction } from "../storage/documents/appRows";
import { runLocatedEffectQuery } from "../database/locatedEffectTransaction";
import { captureTaskSystemTrustedScopeAuthorityV1, requireLockedTaskSystemScopeAuthorityV1 } from "./taskSystemScopeAuthorityV1";
import { requireDeadlineOwnedTaskPersistenceTarget, runDeadlineOwnedTaskPersistenceTransaction, type DeadlineOwnedTaskPersistenceTarget } from "./taskPersistenceTransaction";
import { requireLiveTrustedWorkflowInterpreterSubject, type LiveTrustedWorkflowExecutionPins, type TrustedWorkflowInterpreterSubject } from "./trustedWorkflowExecutionSubject";
import { fxSystemTrustedWorkflowCheckpoints } from "./trustedWorkflowCheckpointSchema";

const maximumRevision = 9_223_372_036_854_775_807n;
const CodecSchema = Schema.String.check(Schema.isPattern(/^[a-zA-Z][a-zA-Z0-9._-]{0,127}$/));
const InputSchema = Schema.Struct({
  expectedRevision: Schema.BigInt.check(Schema.makeFilter(value => value >= 0n && value < maximumRevision)),
  codec: CodecSchema,
  bytes: Schema.Uint8Array.check(Schema.makeFilter(value => value.byteLength > 0 && value.byteLength <= MAX_TRUSTED_WORKFLOW_CHECKPOINT_BYTES)),
});
const DescriptorSchema = TrustedWorkflowCheckpointDescriptorSchema;
const StoredSchema = Schema.Struct({ ...DescriptorSchema.fields, codec: CodecSchema,
  bytes: InputSchema.fields.bytes, bindingSha256: DescriptorSchema.fields.sha256 });
export type StoredTrustedWorkflowCheckpoint = typeof StoredSchema.Type;
const decodeInput = Schema.decodeUnknownResult(InputSchema, { onExcessProperty: "error" });
const decodeStored = Schema.decodeUnknownResult(StoredSchema, { onExcessProperty: "error" });
const decodeDigest = Schema.decodeUnknownResult(DescriptorSchema.fields.sha256);
type PreparedState = typeof InputSchema.Type & Readonly<{ sha256: Uint8Array; bindingSha256: Uint8Array; scopeId: TrustedScopeAuthority["scopeId"] }>;
export interface PreparedTrustedWorkflowCheckpoint { readonly _PreparedTrustedWorkflowCheckpoint: unique symbol }
const preparedStates = new WeakMap<object, PreparedState>();

export class TrustedWorkflowCheckpointError extends Data.TaggedError("TrustedWorkflowCheckpointError")<{
  readonly reason: "invalidTarget" | "invalidBinding" | "invalidInput" | "notPrepared" | "staleAuthority" | "versionConflict" | "storedCorruption" | "storeFailure";
  readonly cause?: unknown;
}> {}
const failure = (reason: TrustedWorkflowCheckpointError["reason"], cause?: unknown) =>
  new TrustedWorkflowCheckpointError({ reason, ...(cause === undefined ? {} : { cause }) });

/** This private binary command is not a Flarex application value. Capture its
 * three own data fields without getters, then copy the bounded intrinsic view;
 * the authoritative Schema still owns revision/codec/value validity. */
const captureInput = (raw: unknown) => Result.try({
  try: () => {
    if (typeof raw !== "object" || raw === null ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) throw failure("invalidInput");
    const keys = Reflect.ownKeys(raw);
    if (keys.length !== 3 || keys.some(key => !["expectedRevision", "codec", "bytes"].includes(String(key))))
      throw failure("invalidInput");
    const fields: Record<string, unknown> = {};
    for (const key of ["expectedRevision", "codec", "bytes"]) {
      const field = Object.getOwnPropertyDescriptor(raw, key);
      if (field === undefined || !("value" in field) || !field.enumerable) throw failure("invalidInput");
      fields[key] = field.value;
    }
    if (!isUint8Array(fields.bytes)) throw failure("invalidInput");
    const length = uint8ArrayByteLength(fields.bytes);
    if (length === undefined || length < 1 || length > MAX_TRUSTED_WORKFLOW_CHECKPOINT_BYTES) throw failure("invalidInput");
    const bytes = new Uint8Array(length);
    Uint8Array.prototype.set.call(bytes, fields.bytes);
    return { expectedRevision: fields.expectedRevision, codec: fields.codec, bytes };
  },
  catch: cause => cause instanceof TrustedWorkflowCheckpointError ? cause : failure("invalidInput", cause),
});

/** Private opaque-byte owner. Every persistence operation borrows one short
 * deadline-owned transaction and authenticates the active interpreter attempt.
 * The framework retains responsibility for its native codec and graph. */
export function makeTrustedWorkflowCheckpointStore<HashFailure>(input: {
  readonly authority: TrustedScopeAuthority;
  readonly target: DeadlineOwnedTaskPersistenceTarget;
  readonly binding: TrustedWorkflowTaskBinding;
  readonly sha256: (bytes: Uint8Array) => Effect.Effect<Uint8Array, HashFailure>;
}) {
  const authority = captureTaskSystemTrustedScopeAuthorityV1(input.authority);
  const target = input.target, binding = input.binding, sha256 = input.sha256;
  const selectedBinding = Effect.fn("TrustedWorkflowCheckpoint.binding")(function* () {
    yield* Effect.fromResult(requireDeadlineOwnedTaskPersistenceTarget(target)).pipe(Effect.mapError(cause => failure("invalidTarget", cause)));
    const selected = yield* Effect.fromResult(inspectTrustedWorkflowTaskBinding(binding)).pipe(Effect.mapError(cause => failure("invalidBinding", cause)));
    if (selected.definition.scopeId !== authority.scopeId) return yield* failure("staleAuthority");
    return selected;
  });
  const hash = Effect.fn("TrustedWorkflowCheckpoint.hash")(function* (bytes: Uint8Array) {
    const digest = yield* sha256(copyBytes(bytes));
    return yield* Effect.fromResult(decodeDigest(copyBytes(digest))).pipe(Effect.mapError(cause => failure("storedCorruption", cause)));
  });
  const prepare = Effect.fn("TrustedWorkflowCheckpoint.prepare")(function* (raw: unknown) {
    const selected = yield* selectedBinding();
    const captured = yield* Effect.fromResult(captureInput(raw));
    const decoded = yield* Effect.fromResult(decodeInput(captured)).pipe(Effect.mapError(cause => failure("invalidInput", cause)));
    const state: PreparedState = { ...decoded, bytes: copyBytes(decoded.bytes), bindingSha256: copyBytes(selected.sha256),
      scopeId: authority.scopeId, sha256: yield* hash(decoded.bytes) };
    // SAFETY: only this module's private registry authenticates the captured bytes.
    const prepared = Object.freeze({}) as PreparedTrustedWorkflowCheckpoint;
    preparedStates.set(prepared, state);
    return prepared;
  });
  const transact = Effect.fn("TrustedWorkflowCheckpoint.transaction")(function* <A, E>(subject: TrustedWorkflowInterpreterSubject, operation: string,
    work: (tx: AppRowTransaction, pins: LiveTrustedWorkflowExecutionPins) => Effect.Effect<A, E>) {
    const selected = yield* selectedBinding();
    return yield* runDeadlineOwnedTaskPersistenceTransaction(target, operation, tx => Effect.gen(function* () {
      yield* Effect.tryPromise({ try: () => requireLockedTaskSystemScopeAuthorityV1(tx, authority, target, mismatch => failure("staleAuthority", mismatch)),
        catch: cause => cause instanceof TrustedWorkflowCheckpointError ? cause : failure("storeFailure", cause) });
      const pins = yield* requireLiveTrustedWorkflowInterpreterSubject(tx, subject, authority);
      if (!bytesEqualFullScan(pins.bindingSha256, selected.sha256)) return yield* failure("invalidBinding");
      const result = yield* work(tx, pins);
      yield* requireLiveTrustedWorkflowInterpreterSubject(tx, subject, authority);
      return result;
    }), cause => failure(cause.reason, cause));
  });
  const load = Effect.fn("TrustedWorkflowCheckpoint.load")((subject: TrustedWorkflowInterpreterSubject) =>
    transact(subject, "trustedWorkflowCheckpoint.load", (tx, pins) => readTrustedWorkflowCheckpointInTransaction(tx, pins, hash)));
  const save = Effect.fn("TrustedWorkflowCheckpoint.save")(function* (subject: TrustedWorkflowInterpreterSubject, prepared: PreparedTrustedWorkflowCheckpoint) {
    const state = preparedStates.get(prepared);
    if (state === undefined) return yield* failure("notPrepared");
    const selected = yield* selectedBinding();
    if (state.scopeId !== authority.scopeId || !bytesEqualFullScan(state.bindingSha256, selected.sha256)) return yield* failure("invalidBinding");
    return yield* transact(subject, "trustedWorkflowCheckpoint.save", (tx, pins) =>
      persistPreparedTrustedWorkflowCheckpointInTransaction(tx, pins, prepared, hash));
  });
  return Object.freeze({ prepare, load, save });
}

/** Authentic capture facts only; inspection neither checks a live attempt nor
 * grants a SQL loan. Returned digests never alias the retained input. */
export function inspectPreparedTrustedWorkflowCheckpoint(prepared: unknown) {
  const state = typeof prepared === "object" && prepared !== null ? preparedStates.get(prepared) : undefined;
  return state === undefined ? Result.fail(failure("notPrepared")) : Result.succeed(Object.freeze({
    expectedRevision: state.expectedRevision, codec: state.codec, byteLength: state.bytes.byteLength,
    sha256: copyBytes(state.sha256), scopeId: state.scopeId, bindingSha256: copyBytes(state.bindingSha256),
  }));
}

/** INTERNAL loan used by the Task continuation owner to commit a checkpoint and
 * suspend the same attempt atomically. Caller holds scope and run locks and
 * authenticates the live subject before and immediately before its transition.
 * This operation neither opens nor settles a transaction. */
export const persistPreparedTrustedWorkflowCheckpointInTransaction = Effect.fn("TrustedWorkflowCheckpoint.persistBorrowed")(
  function* <E>(tx: AppRowTransaction, pins: LiveTrustedWorkflowExecutionPins, prepared: PreparedTrustedWorkflowCheckpoint,
    hash: (bytes: Uint8Array) => Effect.Effect<Uint8Array, E>) {
    const state = preparedStates.get(prepared);
    if (state === undefined) return yield* failure("notPrepared");
    if (state.scopeId !== pins.scopeId || !bytesEqualFullScan(state.bindingSha256, pins.bindingSha256)) return yield* failure("invalidBinding");
    const row = yield* readRow(tx, pins);
    if (row !== undefined) {
      const current = yield* validateRow(row, pins.bindingSha256, hash);
      if (current.revision === state.expectedRevision + 1n && current.codec === state.codec &&
        bytesEqualFullScan(current.sha256, state.sha256) && bytesEqualFullScan(current.bytes, state.bytes))
        return Object.freeze({ disposition: "idempotent" as const, checkpoint: descriptor(current) });
      if (current.revision !== state.expectedRevision) return yield* failure("versionConflict");
    } else if (state.expectedRevision !== 0n) return yield* failure("versionConflict");
    const next = { revision: state.expectedRevision + 1n, codec: state.codec, byteLength: state.bytes.byteLength,
      sha256: state.sha256, bytes: state.bytes, bindingSha256: pins.bindingSha256 };
    const changed = row === undefined
      ? yield* query(tx.insert(fxSystemTrustedWorkflowCheckpoints).values({ scopeId: pins.scopeId, runId: pins.runId, ...next }).returning())
      : yield* query(tx.update(fxSystemTrustedWorkflowCheckpoints).set(next).where(and(
        eq(fxSystemTrustedWorkflowCheckpoints.scopeId, pins.scopeId), eq(fxSystemTrustedWorkflowCheckpoints.runId, pins.runId),
        eq(fxSystemTrustedWorkflowCheckpoints.revision, state.expectedRevision))).returning());
    if (changed.length !== 1) return yield* failure("versionConflict");
    return Object.freeze({ disposition: "accepted" as const, checkpoint: descriptor(next) });
  });

/** INTERNAL read-only loan. The caller has already authenticated the principal,
 * binding and actual run while holding scope then run locks. This verifies the
 * same opaque stored bytes without granting a lease, write or transaction. */
export const readTrustedWorkflowCheckpointInTransaction = Effect.fn("TrustedWorkflowCheckpoint.readBorrowed")(
  function* <E>(tx: AppRowTransaction,
    pins: Pick<LiveTrustedWorkflowExecutionPins, "scopeId" | "runId" | "bindingSha256">,
    hash: (bytes: Uint8Array) => Effect.Effect<Uint8Array, E>): Effect.fn.Return<
      Option.Option<StoredTrustedWorkflowCheckpoint>, E | TrustedWorkflowCheckpointError
    > {
    const row = yield* readRow(tx, pins);
    if (row === undefined) return Option.none<StoredTrustedWorkflowCheckpoint>();
    return Option.some(yield* validateRow(row, pins.bindingSha256, hash));
  });

function descriptor(value: typeof DescriptorSchema.Type) {
  return Object.freeze({ revision: value.revision, byteLength: value.byteLength, sha256: copyBytes(value.sha256) });
}
const readRow = Effect.fn("TrustedWorkflowCheckpoint.readRow")((tx: AppRowTransaction, pins: Pick<LiveTrustedWorkflowExecutionPins, "scopeId" | "runId">) =>
  query(tx.select({ revision: fxSystemTrustedWorkflowCheckpoints.revision, codec: fxSystemTrustedWorkflowCheckpoints.codec,
    byteLength: fxSystemTrustedWorkflowCheckpoints.byteLength, sha256: fxSystemTrustedWorkflowCheckpoints.sha256,
    bytes: fxSystemTrustedWorkflowCheckpoints.bytes, bindingSha256: fxSystemTrustedWorkflowCheckpoints.bindingSha256 })
    .from(fxSystemTrustedWorkflowCheckpoints).where(and(eq(fxSystemTrustedWorkflowCheckpoints.scopeId, pins.scopeId),
      eq(fxSystemTrustedWorkflowCheckpoints.runId, pins.runId))).for("update").limit(1)).pipe(Effect.map(rows => rows[0])));

const validateRow = Effect.fn("TrustedWorkflowCheckpoint.validateRow")(function* <E>(raw: unknown, bindingSha256: Uint8Array,
  hash: (bytes: Uint8Array) => Effect.Effect<Uint8Array, E>) {
  const row = yield* Effect.fromResult(decodeStored(raw)).pipe(Effect.mapError(cause => failure("storedCorruption", cause)));
  if (row.byteLength !== row.bytes.byteLength || !bytesEqualFullScan(row.bindingSha256, bindingSha256) ||
    !bytesEqualFullScan(row.sha256, yield* hash(row.bytes))) return yield* failure("storedCorruption");
  return Object.freeze({ ...row, bytes: copyBytes(row.bytes), sha256: copyBytes(row.sha256), bindingSha256: copyBytes(row.bindingSha256) });
});
function query<Row>(value: PromiseLike<ReadonlyArray<Row>>) {
  return runLocatedEffectQuery(value, "trustedWorkflowCheckpoint", (_operation, cause) => failure("storeFailure", cause));
}
