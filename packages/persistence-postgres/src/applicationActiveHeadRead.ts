import {
  bytesEqualFullScan,
  copyBytes,
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { isNonBlankString } from "@flarex/utils/strings";
import { and, eq } from "drizzle-orm";
import { Data, Effect, Result, Schema } from "effect";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { encodeCanonicalJson, isJson } from "flarex-protocol/json";

import {
  applicationActivationFrame,
  applicationActiveHeadFrame,
  type ApplicationActivationReadinessCommitment,
} from "./applicationActivationFrames";
import {
  fxSystemApplicationActivations,
  fxSystemApplicationActiveHeads,
} from "./applicationActivationSchema";
import {
  fxSystemApplicationRevisionSchemas,
} from "./applicationRelationSchema";
import type { AppRowTransaction } from "./appRows";
import type { ScopeClockRecord } from "./scopeClock";
import { databaseTimestampFromUnknown } from "./databaseTimestamp";
import type { TrustedScopeAuthority } from "./scopeAuthorityResolution";
import { fxSystemApplicationRevisionSchemasV1 } from "./schema";
import { hasProtectedMetadataFinalGuardScope, registerProtectedMetadataFinalGuard,
  authenticateProtectedTargetMetadataSnapshot,
  type ProtectedTargetMetadataEvidence } from "./preparedMetadataEpoch";
import type { PreparedHostPreparationCharge } from "./preparedHostRuntime";
import type { ApplicationActiveSelectionBasis, ApplicationBindingObservation } from "./applicationActivation";
import { readFiniteEntryApplicationObservation, type FiniteEntryObservation } from "./finiteEntryObservation";
import { observeExecution } from "./executionDiagnostics/operation";

const UTF8 = new TextEncoder();
const MAX_FRAME_BYTES = 1_048_576;

export class ApplicationActiveHeadStateError extends Data.TaggedError(
  "ApplicationActiveHeadStateError",
)<{
  readonly reason: "storedState" | "resourceFailure";
  readonly retryable: boolean;
  readonly revisionId?: string;
  readonly cause?: unknown;
}> {}

interface DecodedApplicationActiveHeadBase {
  readonly evidenceByteLength: number;
  readonly scopeId: TrustedScopeAuthority["scopeId"];
  readonly activationSequence: bigint;
  readonly revisionId: string;
  readonly readinessSha256: Uint8Array;
  readonly writePolicySetSha256: string | null;
  readonly writeOwnershipSha256: string | null;
  readonly activationSha256: Uint8Array;
  readonly headSha256: Uint8Array;
}

export type DecodedApplicationActiveHead =
  | Readonly<DecodedApplicationActiveHeadBase & {
      readonly readinessKind: "legacy";
      readonly readinessContractVersion: 1;
      readonly relationSetReadinessSha256: null;
      readonly relationCount: null;
    }>
  | Readonly<DecodedApplicationActiveHeadBase & {
      readonly readinessKind: "relation";
      readonly readinessContractVersion: 2 | 3;
      readonly relationSetReadinessSha256: Uint8Array;
      readonly relationCount: number;
    }>;

interface DecodedApplicationActivationBase {
  readonly evidenceByteLength: number;
  readonly scopeId: TrustedScopeAuthority["scopeId"];
  readonly activationSequence: bigint;
  readonly previousActivationSequence: bigint | null;
  readonly revisionId: string;
  readonly readinessSha256: Uint8Array;
  readonly writePolicySetSha256: string | null;
  readonly writeOwnershipSha256: string | null;
  readonly activationRequestSha256: Uint8Array;
  readonly activationSha256: Uint8Array;
  readonly activatedAt: Date;
}

export type DecodedApplicationActivation =
  | Readonly<DecodedApplicationActivationBase & {
      readonly readinessKind: "legacy";
      readonly readinessContractVersion: 1;
      readonly relationSetReadinessSha256: null;
      readonly relationCount: null;
    }>
  | Readonly<DecodedApplicationActivationBase & {
      readonly readinessKind: "relation";
      readonly readinessContractVersion: 2 | 3;
      readonly relationSetReadinessSha256: Uint8Array;
      readonly relationCount: number;
    }>;

export interface CoherentApplicationActiveHead {
  readonly head: DecodedApplicationActiveHead;
  readonly activation: DecodedApplicationActivation;
}

const CapturedActiveHeadColumnsSchema = Schema.Struct({
  scopeId: Schema.toType(ScopeIdSchema), sequenceText: Schema.BigIntFromString, revisionId: Schema.String,
  readinessContractVersion: Schema.Literals([1, 2, 3]), relationCount: Schema.NullOr(Schema.Number),
  evidenceBytes: Schema.Uint8Array, evidenceSha256: Schema.Uint8Array, readinessSha256: Schema.Uint8Array,
  relationSetReadinessSha256: Schema.NullOr(Schema.Uint8Array), writePolicySetSha256: Schema.NullOr(Schema.Uint8Array),
  writeOwnershipSha256: Schema.NullOr(Schema.Uint8Array), activationSha256: Schema.Uint8Array,
  createdAtText: Schema.String, updatedAtText: Schema.String,
});
const decodeCapturedActiveHeadColumnsResult = Schema.decodeUnknownResult(CapturedActiveHeadColumnsSchema);
const CapturedActivationColumnsSchema = Schema.Struct({
  scopeId: Schema.toType(ScopeIdSchema), sequenceText: Schema.BigIntFromString,
  previousSequenceText: Schema.NullOr(Schema.BigIntFromString), revisionId: Schema.String,
  readinessContractVersion: Schema.Literals([1, 2, 3]), relationCount: Schema.NullOr(Schema.Number),
  evidenceBytes: Schema.Uint8Array, evidenceSha256: Schema.Uint8Array, readinessSha256: Schema.Uint8Array,
  relationSetReadinessSha256: Schema.NullOr(Schema.Uint8Array), writePolicySetSha256: Schema.NullOr(Schema.Uint8Array),
  writeOwnershipSha256: Schema.NullOr(Schema.Uint8Array), activationSha256: Schema.Uint8Array,
  activationRequestSha256: Schema.Uint8Array, legacyReadinessSha256: Schema.NullOr(Schema.Uint8Array),
  relationReadinessSha256: Schema.NullOr(Schema.Uint8Array), activatedAtText: Schema.String,
});
const decodeCapturedActivationColumnsResult = Schema.decodeUnknownResult(CapturedActivationColumnsSchema);

/** Raw scalar/byte projection only; the canonical head decoder remains authority. */
export const decodeCapturedApplicationActiveHeadRowEffect = Effect.fn("ApplicationActiveHead.decodeCapturedRow")(function* (raw: unknown) {
  const row = yield* Effect.fromResult(decodeCapturedActiveHeadColumnsResult(raw)).pipe(Effect.mapError(cause =>
    new ApplicationActiveHeadStateError({ reason: "storedState", retryable: false, cause })));
  const createdAt = databaseTimestampFromUnknown(row.createdAtText);
  const updatedAt = databaseTimestampFromUnknown(row.updatedAtText);
  if (createdAt === null || updatedAt === null) return yield* storedState(row.revisionId);
  return yield* decodeApplicationActiveHeadRowEffect({ ...row, activationSequence: row.sequenceText,
    headBytes: row.evidenceBytes, headSha256: row.evidenceSha256, createdAt, updatedAt });
});

export const decodeCapturedApplicationActivationRowEffect = Effect.fn("ApplicationActivation.decodeCapturedRow")(function* (raw: unknown) {
  const row = yield* Effect.fromResult(decodeCapturedActivationColumnsResult(raw)).pipe(Effect.mapError(cause =>
    new ApplicationActiveHeadStateError({ reason: "storedState", retryable: false, cause })));
  const activatedAt = databaseTimestampFromUnknown(row.activatedAtText);
  if (activatedAt === null) return yield* storedState(row.revisionId);
  return yield* decodeApplicationActivationRowEffect({ ...row, activationSequence: row.sequenceText,
    previousActivationSequence: row.previousSequenceText, activationBytes: row.evidenceBytes,
    activationSha256: row.evidenceSha256, activatedAt });
});

declare const checkedActiveHeadBrand: unique symbol;
/** A locked head observation. The original issuer records whether complete
 * activation coherence has been established; this handle alone is not readiness. */
export interface CheckedApplicationActiveHead {
  readonly [checkedActiveHeadBrand]: true;
}

type CheckedActiveHeadState = {
  readonly tx: AppRowTransaction;
  readonly clock: ScopeClockRecord;
  readonly head: DecodedApplicationActiveHead;
  active?: CoherentApplicationActiveHead;
  schema?: Effect.Success<ReturnType<typeof readApplicationSchemaForHeadForShareInTransactionEffect>>;
  preparation?: ApplicationActiveHeadPreparationState;
};
const checkedActiveHeads = new WeakMap<object, CheckedActiveHeadState>();

export function isCheckedApplicationActiveHead(observation: ApplicationBindingObservation): observation is CheckedApplicationActiveHead {
  return checkedActiveHeads.has(observation);
}

/** Ordinary entry owns only the head lock/decoder. Activation restoration stays
 * at the original accepting source's readiness position. */
export const readCheckedApplicationActiveHeadForShareInTransactionEffect = Effect.fnUntraced(function* (
  tx: AppRowTransaction, clock: ScopeClockRecord, onIssued: (checked: CheckedApplicationActiveHead) => void,
) {
  const head = yield* readApplicationActiveHeadInTransaction(tx, clock.scopeId, true);
  if (head === null) return null;
  // SAFETY: membership and the private phase are established only by this issuer.
  const checked = Object.freeze({}) as CheckedApplicationActiveHead;
  checkedActiveHeads.set(checked, { tx, clock: { ...clock, updatedAt: new Date(clock.updatedAt.getTime()) }, head: structuredClone(head) });
  onIssued(checked);
  return Object.freeze({ head, checked });
}, work => observeExecution("ApplicationActiveHead.readCheckedHeadForShare", work));

declare const preparedHeadStructureBrand: unique symbol;
export interface PreparedApplicationActiveHeadStructure { readonly [preparedHeadStructureBrand]: true }
interface ApplicationActiveHeadPreparationState {
  readonly protection: ProtectedTargetMetadataEvidence;
  readonly charge: PreparedHostPreparationCharge | undefined;
  readonly expected: Pick<ApplicationActiveSelectionBasis, "authority" | "revisionId" | "activationSequence" | "activationSha256" | "headSha256">;
  active?: CoherentApplicationActiveHead;
  schema?: Effect.Success<ReturnType<typeof readApplicationSchemaForHeadForShareInTransactionEffect>>;
}
const preparedHeadStructures = new WeakMap<object, ApplicationActiveHeadPreparationState>();

/** Called by the nominal Application binding issuer during host construction.
 * Lazy readers retain only decoded immutable bodies under this captured epoch. */
export function prepareApplicationActiveHeadStructure(protection: ProtectedTargetMetadataEvidence,
  charge: ApplicationActiveHeadPreparationState["charge"],
  expected: ApplicationActiveHeadPreparationState["expected"]): PreparedApplicationActiveHeadStructure {
  // SAFETY: the private registry authenticates this inert preparation handle.
  const prepared = Object.freeze({}) as PreparedApplicationActiveHeadStructure;
  preparedHeadStructures.set(prepared, { protection, charge, expected: { ...expected,
    authority: { ...expected.authority }, activationSha256: copyBytes(expected.activationSha256), headSha256: copyBytes(expected.headSha256) } });
  return prepared;
}

/** A missing head is deliberately never retained: READ COMMITTED may observe a later insertion. */
export const readCheckedCoherentApplicationActiveHeadForShareInTransactionEffect = Effect.fn(
  "ApplicationActiveHead.readCheckedCoherentForShare",
)(function* (tx: AppRowTransaction, clock: ScopeClockRecord,
  onIssued: (checked: CheckedApplicationActiveHead) => void,
  prepared?: PreparedApplicationActiveHeadStructure,
  finiteEntry?: FiniteEntryObservation) {
  const preparation = prepared === undefined || !hasProtectedMetadataFinalGuardScope(tx)
    ? undefined : preparedHeadStructures.get(prepared);
  if (prepared !== undefined && hasProtectedMetadataFinalGuardScope(tx) && preparation === undefined)
    return yield* storedState();
  if (preparation !== undefined) yield* registerProtectedMetadataFinalGuard(tx,
    preparation.protection.token, preparation.protection.database, preparation.protection.epoch).pipe(
    Effect.mapError(cause => new ApplicationActiveHeadStateError({ reason: "resourceFailure", retryable: false, cause })));
  const captured = finiteEntry === undefined ? undefined : yield* Effect.fromResult(
    readFiniteEntryApplicationObservation(finiteEntry, tx, clock)).pipe(Effect.mapError(cause =>
      new ApplicationActiveHeadStateError({ reason: "storedState", retryable: false, cause })));
  const active = captured === undefined ? yield* readCoherentApplicationActiveHeadInTransaction(tx, clock.scopeId, true, preparation) :
    yield* decodeObservedCoherentApplicationActiveHead(tx, clock.scopeId, captured, preparation);
  if (active === null) return null;
  const matchingPreparation = preparation !== undefined && preparedHeadMatchesSelection(active.head, preparation) ? preparation : undefined;
  // SAFETY: only this fresh locked reader issues the inert handle; the WeakMap owns its evidence.
  const checked = Object.freeze({}) as CheckedApplicationActiveHead;
  checkedActiveHeads.set(checked, {
    tx,
    clock: { ...clock, updatedAt: new Date(clock.updatedAt.getTime()) },
    head: structuredClone(active.head),
    // The issuer's copy cannot be changed through the validated basis or a coverage context.
    active: structuredClone(active),
    ...(matchingPreparation === undefined ? {} : { preparation: matchingPreparation }),
  });
  // The owning callback records the handle before this Effect can yield back to cancellation.
  onIssued(checked);
  return Object.freeze({ active, checked });
});

/** Wrong transaction or lifecycle identity is invalid; ordinary clock progress requests a fresh read. */
export function readCheckedApplicationActiveHead(
  checked: CheckedApplicationActiveHead,
  tx: AppRowTransaction,
  clock: ScopeClockRecord,
): Result.Result<"refresh" | CoherentApplicationActiveHead, ApplicationActiveHeadStateError> {
  return Result.gen(function* () {
    const state = yield* readCheckedActiveHeadState(checked, tx, clock);
    if (state === "refresh") return "refresh" as const;
    if (state.active === undefined)
      return yield* Result.fail(new ApplicationActiveHeadStateError({ reason: "storedState", retryable: false }));
    return structuredClone(state.active);
  });
}

function readCheckedActiveHeadState(checked: CheckedApplicationActiveHead, tx: AppRowTransaction,
  clock: ScopeClockRecord): Result.Result<"refresh" | CheckedActiveHeadState, ApplicationActiveHeadStateError> {
  const state = checkedActiveHeads.get(checked);
  if (state === undefined || state.tx !== tx || state.clock.scopeId !== clock.scopeId ||
    state.clock.storageGeneration !== clock.storageGeneration ||
    state.clock.storageGenerationFence !== clock.storageGenerationFence ||
    state.clock.epoch !== clock.epoch) {
    return Result.fail(new ApplicationActiveHeadStateError({ reason: "storedState", retryable: false }));
  }
  if (clock.lastCommitSeq < state.clock.lastCommitSeq ||
    clock.oldestAvailableCommitSeq < state.clock.oldestAvailableCommitSeq)
    return Result.fail(new ApplicationActiveHeadStateError({ reason: "storedState", retryable: false }));
  if (state.clock.lastCommitSeq !== clock.lastCommitSeq ||
    state.clock.oldestAvailableCommitSeq !== clock.oldestAvailableCommitSeq ||
    state.clock.updatedAt.getTime() !== clock.updatedAt.getTime()) return Result.succeed("refresh");
  return Result.succeed(state);
}

/** Completion authenticates the same transaction/clock loan and uses its exact
 * decoded locked head, without a second head query or an early activation read. */
export const completeCheckedApplicationActiveHeadInTransactionEffect = Effect.fnUntraced(function* (
  checked: CheckedApplicationActiveHead, tx: AppRowTransaction, clock: ScopeClockRecord,
  prepared?: PreparedApplicationActiveHeadStructure,
) {
  const state = yield* Effect.fromResult(readCheckedActiveHeadState(checked, tx, clock));
  if (state === "refresh") return "refresh" as const;
  if (state.active === undefined) {
    const preparation = prepared === undefined || !hasProtectedMetadataFinalGuardScope(tx) ? undefined : preparedHeadStructures.get(prepared);
    if (prepared !== undefined && hasProtectedMetadataFinalGuardScope(tx) && preparation === undefined) return yield* storedState();
    if (preparation !== undefined) yield* registerProtectedMetadataFinalGuard(tx,
      preparation.protection.token, preparation.protection.database, preparation.protection.epoch).pipe(
      Effect.mapError(cause => new ApplicationActiveHeadStateError({ reason: "resourceFailure", retryable: false, cause })));
    const active = yield* readCoherentApplicationActiveHeadInTransaction(tx, clock.scopeId, true, preparation, undefined, state.head);
    if (active === null) return yield* storedState(state.head.revisionId);
    state.active = structuredClone(active);
    if (preparation !== undefined && preparedHeadMatchesSelection(active.head, preparation)) state.preparation = preparation;
  }
  return structuredClone(state.active);
}, work => observeExecution("ApplicationActiveHead.completeCheckedHead", work));

export function releaseCheckedApplicationActiveHead(checked: CheckedApplicationActiveHead | undefined): void {
  if (checked !== undefined) checkedActiveHeads.delete(checked);
}

export const readCheckedApplicationSchemaForHeadForShareInTransactionEffect = Effect.fn(
  "ApplicationActiveHead.readCheckedSchemaForHead",
)(function* (checked: CheckedApplicationActiveHead, tx: AppRowTransaction, clock: ScopeClockRecord) {
  const active = yield* Effect.fromResult(readCheckedApplicationActiveHead(checked, tx, clock));
  if (active === "refresh") return "refresh" as const;
  const state = checkedActiveHeads.get(checked);
  if (state === undefined) return yield* storedState(active.head.revisionId);
  if (state.preparation?.schema !== undefined) return Object.freeze({ ...state.preparation.schema });
  state.schema ??= yield* readApplicationSchemaForHeadForShareInTransactionEffect(tx, active.head);
  if (state.preparation !== undefined && state.preparation.schema === undefined) {
    yield* authenticateProtectedTargetMetadataSnapshot(state.preparation.protection, tx).pipe(
      Effect.mapError(cause => new ApplicationActiveHeadStateError({ reason: "resourceFailure", retryable: false, cause })));
    // Another accepting transaction may have completed the same first read.
    const preparation = state.preparation;
    const retained = Object.freeze({ ...state.schema });
    yield* Effect.suspend(() => {
      if (preparation.schema !== undefined) return Effect.void;
      return Effect.fromResult((preparation.charge?.(retained) ?? Result.succeed(undefined)).pipe(
        Result.mapError(cause => new ApplicationActiveHeadStateError({ reason: "resourceFailure", retryable: false, cause })),
        Result.map(() => { preparation.schema = retained; })));
    });
  }
  return state.schema;
});

export const decodeApplicationActiveHeadRowEffect = Effect.fn(
  "ApplicationActiveHead.decodeRow",
)(function* (
  row: typeof fxSystemApplicationActiveHeads.$inferSelect,
) {
  const readiness = yield* decodeHeadReadiness(row);
  const expected = applicationActiveHeadFrame({
    scopeId: row.scopeId,
    activationSequence: row.activationSequence.toString(),
    revisionId: row.revisionId,
    readiness: readiness.commitment,
    activationSha256: encodeBytesToLowercaseHex(row.activationSha256),
  });
  yield* validateFrame(
    row.headBytes,
    row.headSha256,
    expected,
    row.revisionId,
  );
  const common = {
    evidenceByteLength: row.headBytes.byteLength,
    scopeId: row.scopeId,
    activationSequence: row.activationSequence,
    revisionId: row.revisionId,
    readinessSha256: copyBytes(row.readinessSha256),
    writePolicySetSha256: row.writePolicySetSha256 === null ? null : encodeBytesToLowercaseHex(row.writePolicySetSha256),
    writeOwnershipSha256: row.writeOwnershipSha256 === null ? null : encodeBytesToLowercaseHex(row.writeOwnershipSha256),
    activationSha256: copyBytes(row.activationSha256),
    headSha256: copyBytes(row.headSha256),
  } as const;
  return readiness.kind === "legacy"
    ? Object.freeze({
        ...common,
        readinessKind: "legacy" as const,
        readinessContractVersion: 1 as const,
        relationSetReadinessSha256: null,
        relationCount: null,
      })
    : Object.freeze({
        ...common,
        readinessKind: "relation" as const,
        readinessContractVersion: readiness.commitment.contractVersion,
        relationSetReadinessSha256:
          copyBytes(readiness.relationSetReadinessSha256),
        relationCount: readiness.relationCount,
      });
});

export const decodeApplicationActivationRowEffect = Effect.fn(
  "ApplicationActivation.decodeRow",
)(function* (
  row: typeof fxSystemApplicationActivations.$inferSelect,
) {
  const readiness = yield* decodeActivationReadiness(row);
  const activatedAt = databaseTimestampFromUnknown(row.activatedAt);
  if (activatedAt === null) return yield* storedState(row.revisionId);
  const expected = applicationActivationFrame({
    scopeId: row.scopeId,
    activationSequence: row.activationSequence.toString(),
    previousActivationSequence:
      row.previousActivationSequence?.toString() ?? null,
    revisionId: row.revisionId,
    readiness: readiness.commitment,
    activationRequestSha256:
      encodeBytesToLowercaseHex(row.activationRequestSha256),
    activatedAt: activatedAt.toISOString(),
  });
  yield* validateFrame(
    row.activationBytes,
    row.activationSha256,
    expected,
    row.revisionId,
  );
  const common = {
    evidenceByteLength: row.activationBytes.byteLength,
    scopeId: row.scopeId,
    activationSequence: row.activationSequence,
    previousActivationSequence: row.previousActivationSequence,
    revisionId: row.revisionId,
    readinessSha256: copyBytes(row.readinessSha256),
    writePolicySetSha256: row.writePolicySetSha256 === null ? null : encodeBytesToLowercaseHex(row.writePolicySetSha256),
    writeOwnershipSha256: row.writeOwnershipSha256 === null ? null : encodeBytesToLowercaseHex(row.writeOwnershipSha256),
    activationRequestSha256: copyBytes(row.activationRequestSha256),
    activationSha256: copyBytes(row.activationSha256),
    activatedAt: new Date(activatedAt.getTime()),
  } as const;
  return readiness.kind === "legacy"
    ? Object.freeze({
        ...common,
        readinessKind: "legacy" as const,
        readinessContractVersion: 1 as const,
        relationSetReadinessSha256: null,
        relationCount: null,
      })
    : Object.freeze({
        ...common,
        readinessKind: "relation" as const,
        readinessContractVersion: readiness.commitment.contractVersion,
        relationSetReadinessSha256:
          copyBytes(readiness.relationSetReadinessSha256),
        relationCount: readiness.relationCount,
      });
});

export const readApplicationActiveRevisionForShareInTransactionEffect =
  Effect.fn("ApplicationActiveHead.readRevisionForShareInTransaction")(
    function* (
      tx: AppRowTransaction,
      scopeId: TrustedScopeAuthority["scopeId"],
    ) {
      const active = yield* readCoherentApplicationActiveHeadForShareInTransactionEffect(
        tx,
        scopeId,
      );
      if (active === null) return null;
      const schema = yield* readApplicationSchemaForHeadForShareInTransactionEffect(tx, active.head);
      return Object.freeze({ revisionId: schema.revisionId, deploymentId: schema.deploymentId, schemaVersionId: schema.schemaVersionId });
    },
  );

/** Reuses a coherent head already authenticated in the caller's guarded transaction. */
export const readApplicationSchemaForHeadForShareInTransactionEffect = Effect.fn("ApplicationActiveHead.readSchemaForHead")(
    function* (tx: AppRowTransaction, head: DecodedApplicationActiveHead) {
      const scopeId = head.scopeId;
      const bindings = head.readinessKind === "legacy"
        ? yield* query(
            tx.select().from(fxSystemApplicationRevisionSchemasV1).where(and(
              eq(fxSystemApplicationRevisionSchemasV1.scopeId, scopeId),
              eq(
                fxSystemApplicationRevisionSchemasV1.revisionId,
                head.revisionId,
              ),
            )).limit(2).for("share"),
            head.revisionId,
          )
        : yield* query(
            tx.select().from(fxSystemApplicationRevisionSchemas).where(and(
              eq(fxSystemApplicationRevisionSchemas.scopeId, scopeId),
              eq(fxSystemApplicationRevisionSchemas.revisionId, head.revisionId),
            )).limit(2).for("share"),
            head.revisionId,
          );
      return yield* decodeApplicationSchemaBinding(head, bindings);
    },
  );
const decodeApplicationSchemaBinding = Effect.fn("ApplicationActiveHead.decodeSchemaBinding")(
  function* (head: DecodedApplicationActiveHead,
    bindings: readonly (typeof fxSystemApplicationRevisionSchemasV1.$inferSelect | typeof fxSystemApplicationRevisionSchemas.$inferSelect)[]) {
    const scopeId = head.scopeId;

      const binding = bindings[0];
      if (bindings.length !== 1 || binding === undefined ||
        binding.scopeId !== scopeId || binding.revisionId !== head.revisionId ||
        !isNonBlankString(binding.deploymentId) ||
        !isNonBlankString(binding.schemaVersionId) ||
        !Number.isSafeInteger(binding.schemaVersion) || binding.schemaVersion < 1 ||
        !isUint8ArrayWithByteLength(binding.applicationSchemaSha256, 32) ||
        !isUint8ArrayWithByteLength(binding.schemaManifestSha256, 32) ||
        databaseTimestampFromUnknown(binding.boundAt) === null) {
        return yield* storedState(head.revisionId);
      }
      if (head.readinessKind === "legacy") {
        if (!("schemaBindingSha256" in binding) ||
          !isUint8ArrayWithByteLength(binding.schemaBindingSha256, 32)) {
          return yield* storedState(head.revisionId);
        }
      } else if (!("manifestSchemaBindingSha256" in binding) ||
        !isUint8ArrayWithByteLength(
          binding.manifestSchemaBindingSha256,
          32,
        ) || !("boundPublicationSha256" in binding) ||
        !isUint8ArrayWithByteLength(binding.boundPublicationSha256, 32)) {
        return yield* storedState(head.revisionId);
      }
      return Object.freeze({
        revisionId: head.revisionId,
        deploymentId: binding.deploymentId,
        schemaVersionId: binding.schemaVersionId,
        schemaManifestSha256: encodeBytesToLowercaseHex(binding.schemaManifestSha256),
      });
    },
  );

/** Authenticates the exact current persisted active-head frame. */
export const readApplicationActiveHeadForShareInTransactionEffect =
  Effect.fn("ApplicationActiveHead.readForShareInTransaction")(
    (
      tx: AppRowTransaction,
      scopeId: TrustedScopeAuthority["scopeId"],
    ) => readApplicationActiveHeadInTransaction(tx, scopeId, true),
  );

/** Repeatable-read snapshot variant; the caller owns snapshot isolation. */
export const readApplicationActiveHeadInTransactionEffect = Effect.fn(
  "ApplicationActiveHead.readInTransaction",
)((
  tx: AppRowTransaction,
  scopeId: TrustedScopeAuthority["scopeId"],
) => readApplicationActiveHeadInTransaction(tx, scopeId, false));

/** Authenticates one head and the immutable activation row it selects. */
export const readCoherentApplicationActiveHeadForShareInTransactionEffect =
  Effect.fn("ApplicationActiveHead.readCoherentForShareInTransaction")(
    (
      tx: AppRowTransaction,
      scopeId: TrustedScopeAuthority["scopeId"],
    ) => readCoherentApplicationActiveHeadInTransaction(
      tx,
      scopeId,
      true,
    ),
  );

/** Repeatable-read snapshot variant; the caller owns snapshot isolation. */
export const readCoherentApplicationActiveHeadInTransactionEffect = Effect.fn(
  "ApplicationActiveHead.readCoherentInTransaction",
)((
  tx: AppRowTransaction,
  scopeId: TrustedScopeAuthority["scopeId"],
) => readCoherentApplicationActiveHeadInTransaction(tx, scopeId, false));

// The SDK diagnostic policy observes this stable shared operation explicitly.
const readApplicationActiveHeadInTransaction = Effect.fnUntraced(function* (
  tx: AppRowTransaction,
  scopeId: TrustedScopeAuthority["scopeId"],
  lockForShare: boolean,
): Effect.fn.Return<
  DecodedApplicationActiveHead | null,
  ApplicationActiveHeadStateError
> {
  const base = tx.select().from(fxSystemApplicationActiveHeads).where(eq(
    fxSystemApplicationActiveHeads.scopeId,
    scopeId,
  )).limit(1);
  const rows = yield* query(lockForShare ? base.for("share") : base);
  const row = rows[0];
  if (row === undefined) return null;
  const head = yield* decodeApplicationActiveHeadRowEffect(row);
  return head.scopeId === scopeId
    ? head
    : yield* storedState(head.revisionId);
}, work => observeExecution("ApplicationActiveHead.readInOwnedTransaction", work));

const readCoherentApplicationActiveHeadInTransaction = Effect.fnUntraced(function* (
  tx: AppRowTransaction,
  scopeId: TrustedScopeAuthority["scopeId"],
  lockForShare: boolean,
  preparation?: ApplicationActiveHeadPreparationState,
  capturedHead?: Readonly<{ row: typeof fxSystemApplicationActiveHeads.$inferSelect | null }>,
  decodedHead?: DecodedApplicationActiveHead,
): Effect.fn.Return<
  CoherentApplicationActiveHead | null,
  ApplicationActiveHeadStateError
> {
  const head = decodedHead ?? (capturedHead === undefined ? yield* readApplicationActiveHeadInTransaction(tx, scopeId, lockForShare)
    : capturedHead.row === null ? null : yield* decodeApplicationActiveHeadRowEffect(capturedHead.row));
  if (head === null) return null;
  if (head.scopeId !== scopeId) return yield* storedState(head.revisionId);
  // Preserve the owning Application selection's concurrent-head failure order.
  // A different fresh head receives full canonical proof but cannot fill this selection.
  if (preparation !== undefined && !preparedHeadMatchesSelection(head, preparation)) preparation = undefined;
  if (preparation?.active !== undefined) {
    if (!activationMatchesHead(preparation.active.activation, head)) return yield* storedState(head.revisionId);
    return Object.freeze({ head, activation: structuredClone(preparation.active.activation) });
  }
  const base = tx.select().from(fxSystemApplicationActivations).where(and(
    eq(fxSystemApplicationActivations.scopeId, scopeId),
    eq(
      fxSystemApplicationActivations.activationSequence,
      head.activationSequence,
    ),
  )).limit(1);
  const rows = yield* query(
    lockForShare ? base.for("share") : base,
    head.revisionId,
  );
  const row = rows[0];
  if (row === undefined) return yield* storedState(head.revisionId);
  const activation = yield* decodeApplicationActivationRowEffect(row);
  if (!activationMatchesHead(activation, head)) {
    return yield* storedState(head.revisionId);
  }
  yield* retainCoherentApplicationHeadPreparation(tx, head, activation, preparation);
  return Object.freeze({ head, activation });
}, work => observeExecution("ApplicationActiveHead.readCoherentInOwnedTransaction", work));

export const decodeApplicationMaterializationObservation = Effect.fn("ApplicationActiveHead.decodeMaterializationObservation")(
  function* (tx: AppRowTransaction, scopeId: TrustedScopeAuthority["scopeId"], captured: Readonly<{
    applicationHead: typeof fxSystemApplicationActiveHeads.$inferSelect | null;
    applicationActivation: typeof fxSystemApplicationActivations.$inferSelect | null;
    legacySchema: typeof fxSystemApplicationRevisionSchemasV1.$inferSelect | null;
    relationSchema: typeof fxSystemApplicationRevisionSchemas.$inferSelect | null;
    snapshot: boolean;
  }>) {
    if (!captured.snapshot) {
      const active = yield* readCoherentApplicationActiveHeadInTransaction(tx, scopeId, true, undefined, { row: captured.applicationHead });
      return active === null ? null : Object.freeze({ ...active,
        schema: yield* readApplicationSchemaForHeadForShareInTransactionEffect(tx, active.head) });
    }
    const active = yield* decodeObservedCoherentApplicationActiveHead(tx, scopeId, captured, undefined);
    if (active === null) return null;
    const binding = active.head.readinessKind === "legacy" ? captured.legacySchema : captured.relationSchema;
    const schema = yield* decodeApplicationSchemaBinding(active.head, binding === null ? [] : [binding]);
    return Object.freeze({ ...active, schema });
  },
);
const decodeObservedCoherentApplicationActiveHead = Effect.fn("ApplicationActiveHead.decodeFiniteEntryObservation")(
  function* (tx: AppRowTransaction, scopeId: TrustedScopeAuthority["scopeId"],
    captured: Result.Result.Success<ReturnType<typeof readFiniteEntryApplicationObservation>>,
    preparation: ApplicationActiveHeadPreparationState | undefined) {
    const row = captured.applicationHead;
    if (row === null) {
      if (captured.applicationActivation !== null) return yield* storedState();
      return null;
    }
    const head = yield* decodeApplicationActiveHeadRowEffect(row);
    if (head.scopeId !== scopeId || captured.applicationActivation === null) return yield* storedState(head.revisionId);
    const activation = yield* decodeApplicationActivationRowEffect(captured.applicationActivation);
    if (!activationMatchesHead(activation, head)) return yield* storedState(head.revisionId);
    const matching = preparation !== undefined && preparedHeadMatchesSelection(head, preparation) ? preparation : undefined;
    yield* retainCoherentApplicationHeadPreparation(tx, head, activation, matching);
    return Object.freeze({ head, activation });
  },
);
const retainCoherentApplicationHeadPreparation = Effect.fn("ApplicationActiveHead.retainCoherentPreparation")(
  function* (tx: AppRowTransaction, head: DecodedApplicationActiveHead, activation: DecodedApplicationActivation,
    preparation: ApplicationActiveHeadPreparationState | undefined) {
    if (preparation === undefined || preparation.active !== undefined) return;
    yield* authenticateProtectedTargetMetadataSnapshot(preparation.protection, tx).pipe(
      Effect.mapError(cause => new ApplicationActiveHeadStateError({ reason: "resourceFailure", retryable: false, cause })));
    yield* Effect.suspend(() => {
      if (preparation.active !== undefined) return Effect.void;
      const retained = structuredClone({ head, activation });
      return Effect.fromResult((preparation.charge?.({ ...retained,
        activation: { ...retained.activation, activatedAt: retained.activation.activatedAt.toISOString() } }) ?? Result.succeed(undefined)).pipe(
        Result.mapError(cause => new ApplicationActiveHeadStateError({ reason: "resourceFailure", retryable: false, cause })),
        Result.map(() => { preparation.active = retained; })));
    });
  },
);

function preparedHeadMatchesSelection(head: DecodedApplicationActiveHead, preparation: ApplicationActiveHeadPreparationState): boolean {
  return head.scopeId === preparation.expected.authority.scopeId && head.activationSequence === preparation.expected.activationSequence &&
    head.revisionId === preparation.expected.revisionId && bytesEqualFullScan(head.activationSha256, preparation.expected.activationSha256) &&
    bytesEqualFullScan(head.headSha256, preparation.expected.headSha256);
}

export function activationMatchesHead(
  activation: DecodedApplicationActivation,
  head: DecodedApplicationActiveHead,
): boolean {
  if (activation.scopeId !== head.scopeId ||
    activation.activationSequence !== head.activationSequence ||
    activation.revisionId !== head.revisionId ||
    activation.readinessContractVersion !== head.readinessContractVersion ||
    activation.writePolicySetSha256 !== head.writePolicySetSha256 ||
    activation.writeOwnershipSha256 !== head.writeOwnershipSha256 ||
    !bytesEqualFullScan(activation.readinessSha256, head.readinessSha256) ||
    !bytesEqualFullScan(activation.activationSha256, head.activationSha256)) {
    return false;
  }
  return activation.readinessKind === "legacy" && head.readinessKind === "legacy" ||
    activation.readinessKind === "relation" && head.readinessKind === "relation" &&
      activation.relationCount === head.relationCount &&
      bytesEqualFullScan(
        activation.relationSetReadinessSha256,
        head.relationSetReadinessSha256,
      );
}

type DecodedReadiness =
  | Readonly<{
      readonly kind: "legacy";
      readonly commitment: Extract<
        ApplicationActivationReadinessCommitment,
        { readonly kind: "legacy" }
      >;
    }>
  | Readonly<{
      readonly kind: "relation";
      readonly commitment: Extract<
        ApplicationActivationReadinessCommitment,
        { readonly kind: "relation" | "policy" }
      >;
      readonly relationSetReadinessSha256: Uint8Array;
      readonly relationCount: number;
    }>;

function decodeHeadReadiness(
  row: typeof fxSystemApplicationActiveHeads.$inferSelect,
): Effect.Effect<DecodedReadiness, ApplicationActiveHeadStateError> {
  if (!commonDigestsAreValid(
    row.readinessSha256,
    row.activationSha256,
    row.headSha256,
  )) return storedState(row.revisionId);
  if (row.readinessContractVersion === 1 &&
    row.writePolicySetSha256 === null && row.writeOwnershipSha256 === null &&
    row.relationSetReadinessSha256 === null && row.relationCount === null) {
    return Effect.succeed(Object.freeze({
      kind: "legacy" as const,
      commitment: Object.freeze({
        kind: "legacy" as const,
        contractVersion: 1 as const,
        readinessSha256: encodeBytesToLowercaseHex(row.readinessSha256),
      }),
    }));
  }
  const policy = decodePolicyCommitment(row);
  if (policy !== undefined && row.readinessContractVersion !== 1 &&
    isUint8ArrayWithByteLength(row.relationSetReadinessSha256, 32) &&
    validRelationCount(row.relationCount, row.readinessContractVersion === 3 ? 0 : 1)) {
    return Effect.succeed(Object.freeze({
      kind: "relation" as const,
      commitment: Object.freeze({
        ...policy,
        readinessSha256: encodeBytesToLowercaseHex(row.readinessSha256),
        relationSetReadinessSha256:
          encodeBytesToLowercaseHex(row.relationSetReadinessSha256),
        relationCount: row.relationCount,
      }),
      relationSetReadinessSha256: copyBytes(row.relationSetReadinessSha256),
      relationCount: row.relationCount,
    }));
  }
  return storedState(row.revisionId);
}

function decodeActivationReadiness(
  row: typeof fxSystemApplicationActivations.$inferSelect,
): Effect.Effect<DecodedReadiness, ApplicationActiveHeadStateError> {
  if (!isUint8ArrayWithByteLength(row.readinessSha256, 32) ||
    !isUint8ArrayWithByteLength(row.activationRequestSha256, 32) ||
    !isUint8ArrayWithByteLength(row.activationSha256, 32)) {
    return storedState(row.revisionId);
  }
  if (row.readinessContractVersion === 1 &&
    row.writePolicySetSha256 === null && row.writeOwnershipSha256 === null &&
    isUint8ArrayWithByteLength(row.legacyReadinessSha256, 32) &&
    bytesEqualFullScan(row.legacyReadinessSha256, row.readinessSha256) &&
    row.relationReadinessSha256 === null &&
    row.relationSetReadinessSha256 === null && row.relationCount === null) {
    return Effect.succeed(Object.freeze({
      kind: "legacy" as const,
      commitment: Object.freeze({
        kind: "legacy" as const,
        contractVersion: 1 as const,
        readinessSha256: encodeBytesToLowercaseHex(row.readinessSha256),
      }),
    }));
  }
  const policy = decodePolicyCommitment(row);
  if (policy !== undefined && row.readinessContractVersion !== 1 && row.legacyReadinessSha256 === null &&
    isUint8ArrayWithByteLength(row.relationReadinessSha256, 32) &&
    bytesEqualFullScan(row.relationReadinessSha256, row.readinessSha256) &&
    isUint8ArrayWithByteLength(row.relationSetReadinessSha256, 32) &&
    validRelationCount(row.relationCount, row.readinessContractVersion === 3 ? 0 : 1)) {
    return Effect.succeed(Object.freeze({
      kind: "relation" as const,
      commitment: Object.freeze({
        ...policy,
        readinessSha256: encodeBytesToLowercaseHex(row.readinessSha256),
        relationSetReadinessSha256:
          encodeBytesToLowercaseHex(row.relationSetReadinessSha256),
        relationCount: row.relationCount,
      }),
      relationSetReadinessSha256: copyBytes(row.relationSetReadinessSha256),
      relationCount: row.relationCount,
    }));
  }
  return storedState(row.revisionId);
}

function commonDigestsAreValid(...values: ReadonlyArray<unknown>): boolean {
  return values.every(value => isUint8ArrayWithByteLength(value, 32));
}

function decodePolicyCommitment(row: Pick<typeof fxSystemApplicationActiveHeads.$inferSelect,
  "readinessContractVersion" | "writePolicySetSha256" | "writeOwnershipSha256">) {
  if (row.readinessContractVersion === 2 && row.writePolicySetSha256 === null && row.writeOwnershipSha256 === null) {
    return { kind: "relation" as const, contractVersion: 2 as const };
  }
  if (row.readinessContractVersion === 3 && isUint8ArrayWithByteLength(row.writePolicySetSha256, 32) &&
    isUint8ArrayWithByteLength(row.writeOwnershipSha256, 32)) {
    return { kind: "policy" as const, contractVersion: 3 as const,
      writePolicySetSha256: encodeBytesToLowercaseHex(row.writePolicySetSha256),
      writeOwnershipSha256: encodeBytesToLowercaseHex(row.writeOwnershipSha256) };
  }
  return undefined;
}

function validRelationCount(value: unknown, minimum: number): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" &&
    value >= minimum && value <= 1_024;
}

const validateFrame = Effect.fn("ApplicationActiveHead.validateFrame")(
  function* (
    bytes: Uint8Array,
    expectedSha256: Uint8Array,
    expected: Readonly<Record<string, unknown>>,
    revisionId: string,
  ) {
    if (bytes.byteLength < 1 || bytes.byteLength > MAX_FRAME_BYTES ||
      !bytesEqualFullScan(yield* sha256(bytes, revisionId), expectedSha256) ||
      !isJson(expected) || !bytesEqualFullScan(
        UTF8.encode(encodeCanonicalJson(expected, invariant)),
        bytes,
      )) return yield* storedState(revisionId);
  },
);

function storedState(revisionId?: string) {
  return Effect.fail(new ApplicationActiveHeadStateError({
    reason: "storedState",
    retryable: false,
    ...(revisionId === undefined ? {} : { revisionId }),
  }));
}

function query<Row>(
  statement: PromiseLike<ReadonlyArray<Row>>,
  revisionId?: string,
) {
  return Effect.tryPromise({
    try: () => Promise.resolve(statement),
    catch: cause => new ApplicationActiveHeadStateError({
      reason: "resourceFailure",
      retryable: retryableCause(cause),
      ...(revisionId === undefined ? {} : { revisionId }),
      cause,
    }),
  });
}

function retryableCause(cause: unknown): boolean {
  const code = isNonArrayRecord(cause) ? cause.code : undefined;
  return code === "40001" || code === "40P01" || code === "55P03";
}

function sha256(bytes: Uint8Array, revisionId: string) {
  return Effect.tryPromise({
    try: () =>
      globalThis.crypto.subtle.digest(
        "SHA-256",
        copyBytesToArrayBuffer(bytes),
      ).then(value => new Uint8Array(value)),
    catch: cause => new ApplicationActiveHeadStateError({
      reason: "resourceFailure",
      retryable: false,
      revisionId,
      cause,
    }),
  });
}

function invariant(issue: Readonly<{ reason: string }>): never {
  throw new Error(`Application activation frame invariant: ${issue.reason}`);
}
