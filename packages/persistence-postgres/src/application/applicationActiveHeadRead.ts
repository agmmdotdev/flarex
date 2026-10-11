import { databaseTimestampFromUnknown } from "../database/databaseTimestamp";
import { fxSystemApplicationRevisionSchemasV1 } from "../database/schema";
import { observeExecution } from "../execution/diagnostics/operation";
import {
  type FiniteEntryObservation,
  readFiniteEntryApplicationObservation,
} from "../execution/finiteEntryObservation";
import {
  authenticateProtectedTargetMetadataSnapshot,
  hasProtectedMetadataFinalGuardScope,
  registerProtectedMetadataFinalGuard,
} from "../execution/preparation/preparedMetadataEpoch";
import type { TrustedScopeAuthority } from "../scope/scopeAuthorityResolution";
import type { ScopeClockRecord } from "../scope/scopeClock";
import type { AppRowTransaction } from "../storage/documents/appRows";
import type {
  CheckedApplicationActiveHead,
  CoherentApplicationActiveHead,
  DecodedApplicationActivation,
  DecodedApplicationActiveHead,
  PreparedApplicationActiveHeadStructure,
} from "./activeHead/contracts";
import { ApplicationActiveHeadStateError } from "./activeHead/errors";
import {
  type ApplicationActiveHeadPreparationState,
  issueCheckedApplicationHeadObservation,
  issueCheckedCoherentApplicationHeadObservation,
  readApplicationActiveHeadPreparationState,
  readCheckedActiveHeadState,
  readCheckedApplicationActiveHead,
  readIssuedCheckedApplicationActiveHeadState,
} from "./activeHead/identity";
import {
  applicationActivationFrame,
  type ApplicationActivationReadinessCommitment,
  applicationActiveHeadFrame,
} from "./applicationActivationFrames";
import {
  fxSystemApplicationActivations,
  fxSystemApplicationActiveHeads,
} from "./applicationActivationSchema";
import { fxSystemApplicationRevisionSchemas } from "./relations/applicationRelationSchema";
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
import { Effect, Result, Schema } from "effect";
import { encodeCanonicalJson, isJson } from "flarex-protocol/json";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";

const UTF8 = new TextEncoder();

const MAX_FRAME_BYTES = 1_048_576;

/** Native scalar mapping preserves column types; a NULL composite can make
 * every scalar null. These envelopes carry evidence, never decoded authority. */
type RawApplicationActiveHeadRow = {
  readonly [Field in keyof typeof fxSystemApplicationActiveHeads.$inferSelect]:
    (typeof fxSystemApplicationActiveHeads.$inferSelect)[Field] | null;
};
type RawApplicationActivationRow = {
  readonly [Field in keyof typeof fxSystemApplicationActivations.$inferSelect]:
    (typeof fxSystemApplicationActivations.$inferSelect)[Field] | null;
};
type RawLegacyApplicationSchemaRow = {
  readonly [Field in keyof typeof fxSystemApplicationRevisionSchemasV1.$inferSelect]:
    (typeof fxSystemApplicationRevisionSchemasV1.$inferSelect)[Field] | null;
};
type RawRelationApplicationSchemaRow = {
  readonly [Field in keyof typeof fxSystemApplicationRevisionSchemas.$inferSelect]:
    (typeof fxSystemApplicationRevisionSchemas.$inferSelect)[Field] | null;
};

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

/** Ordinary entry owns only the head lock/decoder. Activation restoration stays
 * at the original accepting source's readiness position. */
export const readCheckedApplicationActiveHeadForShareInTransactionEffect = Effect.fnUntraced(function* (
  tx: AppRowTransaction, clock: ScopeClockRecord, onIssued: (checked: CheckedApplicationActiveHead) => void,
) {
  const head = yield* readApplicationActiveHeadInTransaction(tx, clock.scopeId, true);
  if (head === null) return null;
  const checked = issueCheckedApplicationHeadObservation(tx, clock, head);
  onIssued(checked);
  return Object.freeze({ head, checked });
}, work => observeExecution("ApplicationActiveHead.readCheckedHeadForShare", work));

/** A missing head is deliberately never retained: READ COMMITTED may observe a later insertion. */
export const readCheckedCoherentApplicationActiveHeadForShareInTransactionEffect = Effect.fn(
  "ApplicationActiveHead.readCheckedCoherentForShare",
)(function* (tx: AppRowTransaction, clock: ScopeClockRecord,
  onIssued: (checked: CheckedApplicationActiveHead) => void,
  prepared?: PreparedApplicationActiveHeadStructure,
  finiteEntry?: FiniteEntryObservation) {
  const preparation = prepared === undefined || !hasProtectedMetadataFinalGuardScope(tx)
    ? undefined : readApplicationActiveHeadPreparationState(prepared);
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
  const checked = issueCheckedCoherentApplicationHeadObservation(tx, clock, active, matchingPreparation);
  // The owning callback records the handle before this Effect can yield back to cancellation.
  onIssued(checked);
  return Object.freeze({ active, checked });
});

/** Completion authenticates the same transaction/clock loan and uses its exact
 * decoded locked head, without a second head query or an early activation read. */
export const completeCheckedApplicationActiveHeadInTransactionEffect = Effect.fnUntraced(function* (
  checked: CheckedApplicationActiveHead, tx: AppRowTransaction, clock: ScopeClockRecord,
  prepared?: PreparedApplicationActiveHeadStructure,
) {
  const state = yield* Effect.fromResult(readCheckedActiveHeadState(checked, tx, clock));
  if (state === "refresh") return "refresh" as const;
  if (state.active === undefined) {
    const preparation = prepared === undefined || !hasProtectedMetadataFinalGuardScope(tx) ? undefined : readApplicationActiveHeadPreparationState(prepared);
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

export const readCheckedApplicationSchemaForHeadForShareInTransactionEffect = Effect.fn(
  "ApplicationActiveHead.readCheckedSchemaForHead",
)(function* (checked: CheckedApplicationActiveHead, tx: AppRowTransaction, clock: ScopeClockRecord) {
  const active = yield* Effect.fromResult(readCheckedApplicationActiveHead(checked, tx, clock));
  if (active === "refresh") return "refresh" as const;
  const state = readIssuedCheckedApplicationActiveHeadState(checked);
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
  row: RawApplicationActiveHeadRow,
) {
  const readiness = yield* decodeHeadReadiness(row);
  if (row.scopeId === null || row.activationSequence === null || row.revisionId === null)
    return yield* storedState(row.revisionId);
  const expected = applicationActiveHeadFrame({
    scopeId: row.scopeId,
    activationSequence: row.activationSequence.toString(),
    revisionId: row.revisionId,
    readiness: readiness.commitment,
    activationSha256: encodeBytesToLowercaseHex(readiness.activationSha256),
  });
  if (row.headBytes === null) return yield* storedState(row.revisionId);
  yield* validateFrame(
    row.headBytes,
    readiness.headSha256,
    expected,
    row.revisionId,
  );
  const common = {
    evidenceByteLength: row.headBytes.byteLength,
    scopeId: row.scopeId,
    activationSequence: row.activationSequence,
    revisionId: row.revisionId,
    readinessSha256: copyBytes(readiness.readinessSha256),
    writePolicySetSha256: row.writePolicySetSha256 === null ? null : encodeBytesToLowercaseHex(row.writePolicySetSha256),
    writeOwnershipSha256: row.writeOwnershipSha256 === null ? null : encodeBytesToLowercaseHex(row.writeOwnershipSha256),
    activationSha256: copyBytes(readiness.activationSha256),
    headSha256: copyBytes(readiness.headSha256),
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
  row: RawApplicationActivationRow,
) {
  const readiness = yield* decodeActivationReadiness(row);
  const activatedAt = databaseTimestampFromUnknown(row.activatedAt);
  if (activatedAt === null) return yield* storedState(row.revisionId);
  if (row.scopeId === null || row.activationSequence === null || row.revisionId === null)
    return yield* storedState(row.revisionId);
  const expected = applicationActivationFrame({
    scopeId: row.scopeId,
    activationSequence: row.activationSequence.toString(),
    previousActivationSequence:
      row.previousActivationSequence?.toString() ?? null,
    revisionId: row.revisionId,
    readiness: readiness.commitment,
    activationRequestSha256:
      encodeBytesToLowercaseHex(readiness.activationRequestSha256),
    activatedAt: activatedAt.toISOString(),
  });
  if (row.activationBytes === null) return yield* storedState(row.revisionId);
  yield* validateFrame(
    row.activationBytes,
    readiness.activationSha256,
    expected,
    row.revisionId,
  );
  const common = {
    evidenceByteLength: row.activationBytes.byteLength,
    scopeId: row.scopeId,
    activationSequence: row.activationSequence,
    previousActivationSequence: row.previousActivationSequence,
    revisionId: row.revisionId,
    readinessSha256: copyBytes(readiness.readinessSha256),
    writePolicySetSha256: row.writePolicySetSha256 === null ? null : encodeBytesToLowercaseHex(row.writePolicySetSha256),
    writeOwnershipSha256: row.writeOwnershipSha256 === null ? null : encodeBytesToLowercaseHex(row.writeOwnershipSha256),
    activationRequestSha256: copyBytes(readiness.activationRequestSha256),
    activationSha256: copyBytes(readiness.activationSha256),
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
    bindings: readonly (RawLegacyApplicationSchemaRow | RawRelationApplicationSchemaRow)[]) {
    const scopeId = head.scopeId;

      const binding = bindings[0];
      if (bindings.length !== 1 || binding === undefined ||
        binding.scopeId !== scopeId || binding.revisionId !== head.revisionId ||
        !isNonBlankString(binding.deploymentId) ||
        !isNonBlankString(binding.schemaVersionId) ||
        !Number.isSafeInteger(binding.schemaVersion) || typeof binding.schemaVersion !== "number" || binding.schemaVersion < 1 ||
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
  capturedHead?: Readonly<{ row: RawApplicationActiveHeadRow | null }>,
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
    applicationHead: RawApplicationActiveHeadRow | null;
    applicationActivation: RawApplicationActivationRow | null;
    legacySchema: RawLegacyApplicationSchemaRow | null;
    relationSchema: RawRelationApplicationSchemaRow | null;
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
    captured: Readonly<{ applicationHead: RawApplicationActiveHeadRow | null;
      applicationActivation: RawApplicationActivationRow | null }>,
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

type DecodedHeadReadiness = DecodedReadiness & Readonly<{
  readinessSha256: Uint8Array; activationSha256: Uint8Array; headSha256: Uint8Array;
}>;
type DecodedActivationReadiness = DecodedReadiness & Readonly<{
  readinessSha256: Uint8Array; activationRequestSha256: Uint8Array; activationSha256: Uint8Array;
}>;

function decodeHeadReadiness(
  row: RawApplicationActiveHeadRow,
): Effect.Effect<DecodedHeadReadiness, ApplicationActiveHeadStateError> {
  // Preserve the original common-digest argument observation order. These
  // accepted facts feed frame assembly without rechecking the same bytes.
  const readinessSha256 = row.readinessSha256;
  const activationSha256 = row.activationSha256;
  const headSha256 = row.headSha256;
  if (!isUint8ArrayWithByteLength(readinessSha256, 32) ||
    !isUint8ArrayWithByteLength(activationSha256, 32) ||
    !isUint8ArrayWithByteLength(headSha256, 32)) return storedState(row.revisionId);
  const digests = { readinessSha256, activationSha256, headSha256 };
  if (row.readinessContractVersion === 1 &&
    row.writePolicySetSha256 === null && row.writeOwnershipSha256 === null &&
    row.relationSetReadinessSha256 === null && row.relationCount === null) {
    return Effect.succeed(Object.freeze({
      ...digests,
      kind: "legacy" as const,
      commitment: Object.freeze({
        kind: "legacy" as const,
        contractVersion: 1 as const,
        readinessSha256: encodeBytesToLowercaseHex(readinessSha256),
      }),
    }));
  }
  const policy = decodePolicyCommitment(row);
  if (policy !== undefined && row.readinessContractVersion !== 1 &&
    isUint8ArrayWithByteLength(row.relationSetReadinessSha256, 32) &&
    validRelationCount(row.relationCount, row.readinessContractVersion === 3 ? 0 : 1)) {
    return Effect.succeed(Object.freeze({
      ...digests,
      kind: "relation" as const,
      commitment: Object.freeze({
        ...policy,
        readinessSha256: encodeBytesToLowercaseHex(readinessSha256),
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
  row: RawApplicationActivationRow,
): Effect.Effect<DecodedActivationReadiness, ApplicationActiveHeadStateError> {
  const readinessSha256 = row.readinessSha256;
  if (!isUint8ArrayWithByteLength(readinessSha256, 32)) return storedState(row.revisionId);
  const activationRequestSha256 = row.activationRequestSha256;
  if (!isUint8ArrayWithByteLength(activationRequestSha256, 32)) return storedState(row.revisionId);
  const activationSha256 = row.activationSha256;
  if (!isUint8ArrayWithByteLength(activationSha256, 32)) return storedState(row.revisionId);
  const digests = { readinessSha256, activationRequestSha256, activationSha256 };
  if (row.readinessContractVersion === 1 &&
    row.writePolicySetSha256 === null && row.writeOwnershipSha256 === null &&
    isUint8ArrayWithByteLength(row.legacyReadinessSha256, 32) &&
    bytesEqualFullScan(row.legacyReadinessSha256, readinessSha256) &&
    row.relationReadinessSha256 === null &&
    row.relationSetReadinessSha256 === null && row.relationCount === null) {
    return Effect.succeed(Object.freeze({
      ...digests,
      kind: "legacy" as const,
      commitment: Object.freeze({
        kind: "legacy" as const,
        contractVersion: 1 as const,
        readinessSha256: encodeBytesToLowercaseHex(readinessSha256),
      }),
    }));
  }
  const policy = decodePolicyCommitment(row);
  if (policy !== undefined && row.readinessContractVersion !== 1 && row.legacyReadinessSha256 === null &&
    isUint8ArrayWithByteLength(row.relationReadinessSha256, 32) &&
    bytesEqualFullScan(row.relationReadinessSha256, readinessSha256) &&
    isUint8ArrayWithByteLength(row.relationSetReadinessSha256, 32) &&
    validRelationCount(row.relationCount, row.readinessContractVersion === 3 ? 0 : 1)) {
    return Effect.succeed(Object.freeze({
      ...digests,
      kind: "relation" as const,
      commitment: Object.freeze({
        ...policy,
        readinessSha256: encodeBytesToLowercaseHex(readinessSha256),
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

function decodePolicyCommitment(row: Pick<RawApplicationActiveHeadRow,
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

function storedState(revisionId?: string | null) {
  return Effect.fail(new ApplicationActiveHeadStateError({
    reason: "storedState",
    retryable: false,
    ...(revisionId === undefined || revisionId === null ? {} : { revisionId }),
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
