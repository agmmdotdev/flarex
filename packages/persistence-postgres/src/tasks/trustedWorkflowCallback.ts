import { bytesEqualFullScan, copyBytes, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { inspectTrustedWorkflowTaskBinding, type TrustedWorkflowTaskBinding } from "@flarex/durable-task/internal/run-creation-v1";
import { and, eq, sql } from "drizzle-orm";
import { Data, Effect, Schema } from "effect";
import type { Json } from "flarex-protocol/json";
import { fxSystemExternalEffectAttemptsV1 as effects } from "../database/schema";
import { runLocatedEffectQuery } from "../database/locatedEffectTransaction";
import type { AppRowTransaction } from "../storage/documents/appRows";
import type { TrustedScopeAuthority } from "../scope/scopeAuthorityResolution";
import { canonicalizeJsonOutcome } from "../values/jsonOutcome";
import { captureTaskSystemTrustedScopeAuthorityV1, requireLockedTaskSystemScopeAuthorityV1 } from "./taskSystemScopeAuthorityV1";
import { requireDeadlineOwnedTaskPersistenceTarget, runDeadlineOwnedTaskPersistenceTransaction,
  type DeadlineOwnedTaskPersistenceTarget } from "./taskPersistenceTransaction";
import { inspectTrustedWorkflowInterpreterSubject, requireLiveTrustedWorkflowInterpreterSubject, type LiveTrustedWorkflowExecutionPins,
  type TrustedWorkflowInterpreterSubject } from "./trustedWorkflowExecutionSubject";

const maximumValueBytes = 65_536;
const settlementReserveMs = 1000;
const strict = { parseOptions: { onExcessProperty: "error" } } as const;
const token = Schema.String.check(Schema.isPattern(/^[a-zA-Z][a-zA-Z0-9._-]{0,127}$/));
const revision = Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/));
export const TrustedWorkflowCallbackDefinitionSchema = Schema.Struct({ id: token, revision, inputCodecRevision: revision, outcomeCodecRevision: revision,
  allowControl: Schema.Boolean, maximumCallbackMs: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 60_000 })) }).annotate(strict);
const decodeDefinition = Schema.decodeUnknownEffect(TrustedWorkflowCallbackDefinitionSchema, { onExcessProperty: "error" });
const ordinalSchema = Schema.BigInt.check(Schema.makeFilter(value => value >= 1n && value <= 16n));
const decodeOrdinal = Schema.decodeUnknownEffect(ordinalSchema);
const digest = Schema.Uint8Array.check(Schema.makeFilter(value => value.byteLength === 32));
const decodeDigest = Schema.decodeUnknownEffect(digest);
export const TrustedWorkflowCallbackOutcomeSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("returned"), value: Schema.Json }).annotate(strict),
  Schema.Struct({ kind: Schema.Literal("failed"), error: Schema.Json }).annotate(strict),
]);
export type TrustedWorkflowCallbackOutcome = typeof TrustedWorkflowCallbackOutcomeSchema.Type;
const decodeOutcome = Schema.decodeUnknownEffect(TrustedWorkflowCallbackOutcomeSchema, { onExcessProperty: "error" });
export type TrustedWorkflowCallbackDefinition = typeof TrustedWorkflowCallbackDefinitionSchema.Type;

export class TrustedWorkflowCallbackError extends Data.TaggedError("TrustedWorkflowCallbackError")<{
  readonly reason: "invalidTarget" | "invalidBinding" | "invalidInput" | "invalidOutcome" | "staleAuthority" |
    "controlForbidden" | "requestConflict" | "uncertain" | "deadlineExceeded" | "storedCorruption" | "storeFailure";
  readonly cause?: unknown;
}> {}
const failure = (reason: TrustedWorkflowCallbackError["reason"], cause?: unknown) =>
  new TrustedWorkflowCallbackError({ reason, ...(cause === undefined ? {} : { cause }) });
const storedSchema = Schema.Struct({
  effectKind: Schema.Literal("trusted_callback"), subjectKind: Schema.Literal("durable_task_attempt"),
  stableEffectKey: Schema.String, effectOrdinal: ordinalSchema, requestIdentitySha256: digest,
  trustedCallbackId: token, trustedCallbackRevision: revision, trustedCallbackBindingSha256: digest,
  trustedCallbackInputJson: Schema.Json, trustedCallbackInputSha256: digest,
  trustedCallbackPolicyJson: TrustedWorkflowCallbackDefinitionSchema, trustedCallbackPolicySha256: digest,
  trustedCallbackOutcomeJson: Schema.NullOr(TrustedWorkflowCallbackOutcomeSchema), trustedCallbackOutcomeSha256: Schema.NullOr(digest),
  state: Schema.Literals(["dispatching", "confirmed", "uncertain"]),
  requestStoreIdentity: Schema.Null, requestCodecIdentity: Schema.Null, requestObjectKey: Schema.Null,
  requestByteLength: Schema.Null, requestSha256: Schema.Null,
  childMutationRequestKey: Schema.Null, childMutationFunctionPath: Schema.Null, childMutationArgumentsSha256: Schema.Null,
  childMutationOutcomeSha256: Schema.Null, childCommerceRequestKey: Schema.Null, childCommerceCommandName: Schema.Null,
  childCommerceArgumentsSha256: Schema.Null, childCommercePolicySha256: Schema.Null, childCommerceOutcomeSha256: Schema.Null,
  responseStoreIdentity: Schema.Null, responseCodecIdentity: Schema.Null, responseObjectKey: Schema.Null,
  responseByteLength: Schema.Null, responseSha256: Schema.Null,
});
const decodeStored = Schema.decodeUnknownEffect(storedSchema);

/** Constructor-owned callback identity and codecs are part of the immutable
 * request policy. The framework owns expected failure encoding and its foreign
 * callback's cancellation/drain lifetime. E, defects and interruption are never
 * serialized or recovered here. A hanging foreign callback is not SQL-bounded. */
export const makeTrustedWorkflowCallbackJournal = Effect.fn("TrustedWorkflowCallback.make")(
  function* <E, R, HashError>(options: {
    readonly authority: TrustedScopeAuthority;
    readonly target: DeadlineOwnedTaskPersistenceTarget;
    readonly binding: TrustedWorkflowTaskBinding;
    readonly definition: TrustedWorkflowCallbackDefinition;
    readonly sha256: (bytes: Uint8Array) => Effect.Effect<Uint8Array, HashError>;
  }, invoke: (input: Json) => Effect.Effect<TrustedWorkflowCallbackOutcome, E, R>) {
    const target = yield* Effect.fromResult(requireDeadlineOwnedTaskPersistenceTarget(options.target))
      .pipe(Effect.mapError(cause => failure("invalidTarget", cause)));
    const authority = captureTaskSystemTrustedScopeAuthorityV1(options.authority);
    const binding = yield* Effect.fromResult(inspectTrustedWorkflowTaskBinding(options.binding))
      .pipe(Effect.mapError(cause => failure("invalidBinding", cause)));
    if (binding.definition.scopeId !== authority.scopeId) return yield* failure("staleAuthority");
    const canonical = (value: unknown, maximum: number, reason: "invalidInput" | "invalidOutcome" | "storedCorruption") =>
      Effect.fromResult(canonicalizeJsonOutcome(value, maximum)).pipe(Effect.mapError(cause => failure(reason, cause)));
    const capturedPolicy = yield* canonical(options.definition, 4096, "invalidInput");
    const definition = yield* decodeDefinition(capturedPolicy.valueJson).pipe(Effect.mapError(cause => failure("invalidInput", cause)));
    const sha256 = options.sha256;
    const hash = Effect.fn("TrustedWorkflowCallback.hash")(function* (bytes: Uint8Array) {
      const value = yield* sha256(copyBytes(bytes));
      return copyBytes(yield* decodeDigest(value).pipe(Effect.mapError(cause => failure("storedCorruption", cause))));
    });
    const policySha256 = yield* hash(capturedPolicy.canonicalBytes);
    const statement = <A>(query: PromiseLike<ReadonlyArray<A>>) => runLocatedEffectQuery(query, "trustedWorkflowCallback",
      (_operation, cause) => failure("storeFailure", cause));
    const where = (key: string) => and(eq(effects.scopeId, authority.scopeId), eq(effects.effectKind, "trusted_callback"), eq(effects.stableEffectKey, key));
    const transact = Effect.fn("TrustedWorkflowCallback.transaction")(function* <A, WorkError>(subject: TrustedWorkflowInterpreterSubject,
      operation: string, work: (tx: AppRowTransaction, pins: LiveTrustedWorkflowExecutionPins) => Effect.Effect<A, WorkError>) {
      return yield* runDeadlineOwnedTaskPersistenceTransaction(target, operation, tx => Effect.gen(function* () {
        yield* Effect.tryPromise({ try: () => requireLockedTaskSystemScopeAuthorityV1(tx, authority, target,
          mismatch => failure("staleAuthority", mismatch)), catch: cause => cause instanceof TrustedWorkflowCallbackError ? cause : failure("storeFailure", cause) });
        const pins = yield* requireLiveTrustedWorkflowInterpreterSubject(tx, subject, authority);
        if (!bytesEqualFullScan(pins.bindingSha256, binding.sha256)) return yield* failure("invalidBinding");
        if (pins.executionMode === "control" && !definition.allowControl) return yield* failure("controlForbidden");
        const result = yield* work(tx, pins);
        const final = yield* requireLiveTrustedWorkflowInterpreterSubject(tx, subject, authority);
        if (final.remainingLeaseMs < settlementReserveMs) return yield* failure("deadlineExceeded");
        return result;
      }), cause => failure(cause.reason, cause));
    });
    const run = Effect.fn("TrustedWorkflowCallback.run")(function* (subject: TrustedWorkflowInterpreterSubject, rawOrdinal: bigint, rawInput: unknown) {
      const inspected = yield* Effect.fromResult(inspectTrustedWorkflowInterpreterSubject(subject));
      if (!bytesEqualFullScan(inspected.bindingSha256, binding.sha256)) return yield* failure("invalidBinding");
      if (inspected.executionMode === "control" && !definition.allowControl) return yield* failure("controlForbidden");
      const ordinal = yield* decodeOrdinal(rawOrdinal).pipe(Effect.mapError(cause => failure("invalidInput", cause)));
      const input = yield* canonical(rawInput, maximumValueBytes, "invalidInput");
      const inputSha256 = yield* hash(input.canonicalBytes);
      const validate = Effect.fn("TrustedWorkflowCallback.validateRow")(function* (raw: unknown, key: string, requestSha256: Uint8Array) {
        const row = yield* decodeStored(raw).pipe(Effect.mapError(cause => failure("storedCorruption", cause)));
        const storedInput = yield* canonical(row.trustedCallbackInputJson, maximumValueBytes, "storedCorruption");
        const storedPolicy = yield* canonical(row.trustedCallbackPolicyJson, 4096, "storedCorruption");
        if (!bytesEqualFullScan(yield* hash(storedInput.canonicalBytes), row.trustedCallbackInputSha256) ||
          !bytesEqualFullScan(yield* hash(storedPolicy.canonicalBytes), row.trustedCallbackPolicySha256)) return yield* failure("storedCorruption");
        if (row.stableEffectKey !== key || row.effectOrdinal !== ordinal || row.trustedCallbackId !== definition.id ||
          row.trustedCallbackRevision !== definition.revision || !bytesEqualFullScan(row.trustedCallbackBindingSha256, binding.sha256) ||
          !bytesEqualFullScan(row.requestIdentitySha256, requestSha256) ||
          !bytesEqualFullScan(storedInput.canonicalBytes, input.canonicalBytes) ||
          !bytesEqualFullScan(storedPolicy.canonicalBytes, capturedPolicy.canonicalBytes)) return yield* failure("requestConflict");
        if (row.state !== "confirmed" && (row.trustedCallbackOutcomeJson !== null || row.trustedCallbackOutcomeSha256 !== null))
          return yield* failure("storedCorruption");
        return row;
      });
      const prepared = yield* transact(subject, "trustedWorkflowCallback.dispatch", (tx, pins) => Effect.gen(function* () {
        const logical = yield* canonical({ codec: "flarex.trusted-workflow.callback.v1", scopeId: authority.scopeId,
          runId: pins.runId, ordinal: ordinal.toString() }, 4096, "storedCorruption");
        const key = `task/callback/${encodeBytesToLowercaseHex(yield* hash(logical.canonicalBytes))}`;
        const request = yield* canonical({ key, binding: encodeBytesToLowercaseHex(binding.sha256),
          input: encodeBytesToLowercaseHex(inputSha256), policy: encodeBytesToLowercaseHex(policySha256) }, 4096, "storedCorruption");
        const requestSha256 = yield* hash(request.canonicalBytes);
        const rows = yield* statement(tx.select().from(effects).where(where(key)).for("update").limit(2));
        if (rows.length > 1) return yield* failure("storedCorruption");
        const existing = rows[0];
        if (existing !== undefined) {
          const row = yield* validate(existing, key, requestSha256);
          if (row.state !== "confirmed") return yield* failure("uncertain");
          if (row.trustedCallbackOutcomeJson === null || row.trustedCallbackOutcomeSha256 === null) return yield* failure("storedCorruption");
          const outcome = yield* canonical(row.trustedCallbackOutcomeJson, maximumValueBytes, "storedCorruption");
          if (!bytesEqualFullScan(yield* hash(outcome.canonicalBytes), row.trustedCallbackOutcomeSha256)) return yield* failure("storedCorruption");
          return { key, requestSha256, replay: row.trustedCallbackOutcomeJson };
        }
        if (pins.remainingLeaseMs < definition.maximumCallbackMs + settlementReserveMs) return yield* failure("deadlineExceeded");
        const identity = yield* canonical({ scopeId: authority.scopeId, runId: pins.runId, attemptId: pins.attemptId,
          binding: encodeBytesToLowercaseHex(binding.sha256) }, 4096, "storedCorruption");
        const inserted = yield* statement(tx.insert(effects).values({ scopeId: authority.scopeId, subjectKind: "durable_task_attempt",
          subjectIdentitySha256: yield* hash(identity.canonicalBytes), subjectFence: pins.executionFence, effectOrdinal: ordinal,
          effectKind: "trusted_callback", stableEffectKey: key, requestIdentitySha256: requestSha256,
          trustedCallbackId: definition.id, trustedCallbackRevision: definition.revision, trustedCallbackBindingSha256: binding.sha256,
          trustedCallbackInputJson: input.valueJson === null ? sql`'null'::jsonb` : input.valueJson, trustedCallbackInputSha256: inputSha256,
          trustedCallbackPolicyJson: capturedPolicy.valueJson, trustedCallbackPolicySha256: policySha256, state: "prepared",
        }).returning({ key: effects.stableEffectKey }));
        if (inserted.length !== 1 || inserted[0]?.key !== key) return yield* failure("storedCorruption");
        const dispatch = yield* statement(tx.update(effects).set({ state: "dispatching",
          dispatchDeclaredAt: sql`greatest(${effects.preparedAt}, clock_timestamp())` }).where(and(where(key), eq(effects.state, "prepared")))
          .returning({ key: effects.stableEffectKey }));
        if (dispatch.length !== 1) return yield* failure("storedCorruption");
        return { key, requestSha256, replay: undefined };
      }));
      if (prepared.replay !== undefined) return prepared.replay;
      // No SQL loan spans this callback. The callback owner retains its real
      // cancellation/drain semantics; a generic timeout cannot abandon it.
      const returned = yield* invoke(input.valueJson);
      const outcome = yield* canonical(returned, maximumValueBytes, "invalidOutcome");
      const decoded = yield* decodeOutcome(outcome.valueJson).pipe(Effect.mapError(cause => failure("invalidOutcome", cause)));
      const outcomeSha256 = yield* hash(outcome.canonicalBytes);
      yield* transact(subject, "trustedWorkflowCallback.confirm", (tx) => Effect.gen(function* () {
        const raw = (yield* statement(tx.select().from(effects).where(where(prepared.key)).for("update").limit(1)))[0];
        if (raw === undefined) return yield* failure("storedCorruption");
        const row = yield* validate(raw, prepared.key, prepared.requestSha256);
        if (row.state !== "dispatching") return yield* failure("uncertain");
        const changed = yield* statement(tx.update(effects).set({ state: "confirmed", trustedCallbackOutcomeJson: outcome.valueJson,
          trustedCallbackOutcomeSha256: outcomeSha256, settledAt: sql`greatest(${effects.preparedAt}, clock_timestamp())` })
          .where(and(where(prepared.key), eq(effects.state, "dispatching"),
            sql`clock_timestamp() <= ${effects.dispatchDeclaredAt} + ${definition.maximumCallbackMs} * interval '1 millisecond'`))
          .returning({ key: effects.stableEffectKey }));
        if (changed.length !== 1) return yield* failure("deadlineExceeded");
      }));
      return decoded;
    });
    return Object.freeze({ run });
  });
