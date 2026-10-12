import { AppIndexEntryWritePersistenceError, InvalidAppIndexEntryInputError, AppIndexEntryScopeAuthorityUnavailableError, AppIndexEntryReadPersistenceError, AppIndexEntryHashError, AppIndexEntryStorageCorruptionError, AppIndexEntryTransitionConflictError, AppIndexEntryRevisionAlreadyExistsError, AppIndexEntryParentRowError } from "./appIndexEntryErrors";
import type { AppendAppIndexEntryRevisionV1Error, InvalidAppIndexEntryInputIssue } from "./appIndexEntryErrors";
import { observeExecution } from "../../execution/diagnostics/operation";
import { fxSystemScopeExecutionAuthorities } from "../../database/schema";
import { closeExactAttemptScopeClockObservation, readExactScopeWriteClockObservation, exactScopeWriteClockObservationIdentity,
  readFiniteExecutionAuthorityObservation, requireFiniteExecutionAuthorityObservation,
  readProtectedScopeReadIdentity, requireProtectedScopeReadIdentity } from "../../scope/scopeClock";
import { defineNativeMetadataRead } from "../../database/physicalSession/drizzle";
import type { PointCommitPublicationObservation } from "../../commit/point/observation";
import { bytesEqualFullScan, isUint8Array, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { isNonArrayRecord } from "@flarex/utils/records";
import { eq, sql, type SQL } from "drizzle-orm";
import { Data, Effect, Result, Schema } from "effect";
import { observeDrizzleRawQuery } from "../../database/drizzleQueryObservation";
import { type AppRowIdHexV1 } from "flarex-protocol/app-document-id";
import {
  CatalogTableIdSchema,
  CatalogIndexDefinitionIdSchema,
  type CatalogIndexDefinitionId,
  type CatalogTableId,
} from "flarex-protocol/catalog";
import {
  ORDERED_INDEX_KEY_CODEC_VERSION_V1,
  OrderedIndexBoundHexV1Schema,
  OrderedIndexKeyBytesHexV1Schema,
  OrderedIndexRowIdHexV1Schema,
  decodeAppOrderedIndexKeyV1,
  orderedIndexBoundHexV1ToBytes,
  orderedIndexKeyBytesHexV1FromBytes,
  orderedIndexKeyBytesHexV1ToBytes,
  orderedIndexRowIdHexV1FromBytesResult,
  orderedIndexRowIdHexV1ToBytes,
  type OrderedIndexBoundsV1,
  type AppOrderedIndexPhysicalSpecV1,
  type OrderedIndexKeyBytesHexV1,
  type OrderedIndexKeyCodecVersion,
  type OrderedIndexKeyHexV1,
  type OrderedIndexRowIdHexV1,
} from "flarex-protocol/ordered-index";
import {
  AppIndexPhysicalSpecSha256HexV1Schema,
  appIndexPhysicalSpecSha256HexV1ToBytes,
  canonicalizeAppIndexPhysicalSpecV1,
  type AppIndexPhysicalSpecSha256HexV1,
} from "flarex-protocol/index-definition";
import {
  CommitSeqSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
  ScopeUuidV1Schema,
  projectScopeEpochUuidV1Result,
  projectScopeIdUuidV1Result,
  type CommitSeq,
  type ScopeEpoch,
  type ScopeEpochUuidV1,
  type ScopeId,
  type ScopeIdUuidProjectionV1,
  type ScopeUuidV1,
} from "flarex-protocol/storage-authority";

import { rowsFromDriverExecuteResult } from "../../database/driverExecuteResult";
import { requireAdmittedTargetInstallationSchema } from "../../installation/installationLifecycle";
import { applicationDomainFailureDetail, buildAppIndexBatchStatement, applicationIndexTransitionScalarArray,
  applicationIndexTransitionByteArray } from "../materialization/domainApplication";
import type { IndexBuildStateRecord } from "./indexBuildStates";
import { runDrizzleStatementEffect } from "../../database/drizzleStatementEffect";
import {
  isLocatedAppIndexDefinitionV1,
  type LocatedAppIndexDefinitionV1,
} from "./appIndexDefinitions";
import type { FlarexMetadataTransaction } from "../../database/metadataTransaction";
import type { StrongReferenceActivationProjection } from "../../installation/frameworkSchema/binding/strongReferenceProjection";
import { fxAppIndexEntryRevisions, fxSystemScopeClocks, fxSystemIndexBuildStates } from "../../database/schema";

export const MAX_APP_INDEX_RANGE_PAGE_SIZE_V1 = 1_000;
const MAX_APP_INDEX_WRITE_ROWS = 4096;
const BoundedRangeCountRowSchema = Schema.Struct({
  countText: Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]*)$/)),
});
const decodeBoundedRangeCountRow = Schema.decodeUnknownResult(BoundedRangeCountRowSchema,
  { onExcessProperty: "error" });

export type AppIndexEntryTransaction = FlarexMetadataTransaction;

export interface AppIndexEntryIdentityV1 {
  readonly scopeId: ScopeId;
  readonly indexDefinitionId: CatalogIndexDefinitionId;
  readonly tableId: CatalogTableId;
  readonly encodedKey: OrderedIndexKeyBytesHexV1;
  readonly rowId: OrderedIndexRowIdHexV1;
}

interface AppendAppIndexEntryRevisionV1Base {
  readonly membershipHeadEvidence?: AppIndexMembershipHeadEvidence;
  readonly scopeId: ScopeId;
  readonly definition: LocatedAppIndexDefinitionV1;
  readonly encodedKey: OrderedIndexKeyHexV1;
  readonly rowId: OrderedIndexRowIdHexV1;
  readonly writeEpoch: ScopeEpoch;
  readonly commitSeq: CommitSeq;
}

export interface AppendLiveAppIndexEntryRevisionV1Input extends AppendAppIndexEntryRevisionV1Base {
  readonly kind: "live";
}

export interface AppendTombstoneAppIndexEntryRevisionV1Input extends AppendAppIndexEntryRevisionV1Base {
  readonly kind: "tombstone";
}

export type AppendAppIndexEntryRevisionV1Input =
  | AppendLiveAppIndexEntryRevisionV1Input
  | AppendTombstoneAppIndexEntryRevisionV1Input;

export type AppendPublicationIndexEntryRevisionInput = Omit<AppendAppIndexEntryRevisionV1Base, "definition"> & {
  readonly kind: "live" | "tombstone";
  readonly reference: StrongReferenceActivationProjection;
};

export interface AppIndexEntryRevisionV1 extends AppIndexEntryIdentityV1 {
  readonly kind: "live" | "tombstone";
  readonly scopeUuid: ScopeUuidV1;
  readonly commitSeq: CommitSeq;
  readonly keyCodecVersion: OrderedIndexKeyCodecVersion;
  readonly keySha256: Uint8Array;
  readonly physicalSpecSha256: Uint8Array;
}

export interface AppIndexRangeCursorV1 {
  readonly encodedKey: OrderedIndexKeyBytesHexV1;
  readonly rowId: OrderedIndexRowIdHexV1;
}

interface AppIndexRangeReadV1Base {
  readonly scopeId: ScopeId;
  readonly definition: LocatedAppIndexDefinitionV1;
  readonly bounds: OrderedIndexBoundsV1;
  readonly after?: AppIndexRangeCursorV1;
  readonly limit: number;
}

export interface ScanAppIndexAtSnapshotV1Input extends AppIndexRangeReadV1Base {
  readonly snapshotCommitSeq: CommitSeq;
}

export type ScanCurrentAppIndexV1Input = AppIndexRangeReadV1Base;

type PublicationIndexRangeInput = Omit<AppIndexRangeReadV1Base, "definition"> & {
  /** The caller must obtain this from the authenticated active binding in
   * the same publication transaction. */
  readonly publicationIndex: StrongReferenceActivationProjection["reverseIndex"];
};

export interface AppIndexRangeEntryV1 extends AppIndexEntryIdentityV1 {
  readonly scopeUuid: ScopeUuidV1;
  readonly commitSeq: CommitSeq;
  readonly keyCodecVersion: OrderedIndexKeyCodecVersion;
  readonly keySha256: Uint8Array;
  readonly physicalSpecSha256: Uint8Array;
}

export interface AppIndexRangePageV1 {
  readonly entries: ReadonlyArray<AppIndexRangeEntryV1>;
  readonly isDone: boolean;
  readonly continueCursor: AppIndexRangeCursorV1 | null;
}

const appendQueryEffect = <T>(
  query: PromiseLike<T>,
): Effect.Effect<T, AppIndexEntryWritePersistenceError> =>
  Effect.uninterruptible(
    Effect.tryPromise({
      try: () => Promise.resolve(query),
      catch: (cause) => new AppIndexEntryWritePersistenceError(cause),
    }),
  );

export type ReadAppIndexRangeV1Error =
  | InvalidAppIndexEntryInputError
  | AppIndexEntryScopeAuthorityUnavailableError
  | AppIndexEntryReadPersistenceError
  | AppIndexEntryHashError
  | AppIndexEntryStorageCorruptionError;

interface DecodedAppendAppIndexEntryRevisionV1 {
  readonly historical: boolean;
  readonly kind: "live" | "tombstone";
  readonly identity: AppIndexEntryIdentityV1;
  readonly scopeUuid: ScopeUuidV1;
  readonly commitSeq: CommitSeq;
  readonly physicalSpec: AppOrderedIndexPhysicalSpecV1;
  readonly physicalSpecSha256: Uint8Array;
  readonly keyBytes: Uint8Array;
  readonly keySha256: Uint8Array;
}

interface CapturedIndexReadDefinition {
  readonly scopeId: ScopeId;
  readonly scopeProjection: ScopeIdUuidProjectionV1;
  readonly indexDefinitionId: CatalogIndexDefinitionId;
  readonly physicalSpec: AppOrderedIndexPhysicalSpecV1;
  readonly specification:
    | Readonly<{ kind: "catalog"; sha256Hex: AppIndexPhysicalSpecSha256HexV1 }>
    | Readonly<{ kind: "publication" }>;
}

interface PreparedIndexReadDefinition extends Omit<CapturedIndexReadDefinition, "specification"> {
  readonly physicalSpecSha256: Uint8Array;
}

interface DecodedAppIndexRangeReadV1
  extends Omit<PreparedIndexReadDefinition, "scopeProjection"> {
  readonly scopeUuid: ScopeUuidV1;
  readonly bounds: Readonly<{
    readonly startInclusive?: Uint8Array;
    readonly endExclusive?: Uint8Array;
  }>;
  readonly after?: Readonly<{
    readonly encodedKey: OrderedIndexKeyBytesHexV1;
    readonly keyBytes: Uint8Array;
    readonly rowId: OrderedIndexRowIdHexV1;
    readonly rowIdBytes: Uint8Array;
  }>;
  readonly limit: number;
}

const decodeScopeIdResult = Schema.decodeUnknownResult(
  Schema.toType(ScopeIdSchema),
);
const decodeScopeEpochResult = Schema.decodeUnknownResult(
  Schema.toType(ScopeEpochSchema),
);
const decodeScopeUuidResult = Schema.decodeUnknownResult(
  Schema.toType(ScopeUuidV1Schema),
);
const decodeTableIdResult = Schema.decodeUnknownResult(
  Schema.toType(CatalogTableIdSchema),
);
const decodeIndexDefinitionIdResult = Schema.decodeUnknownResult(
  Schema.toType(CatalogIndexDefinitionIdSchema),
);
const decodePhysicalSpecDigestResult = Schema.decodeUnknownResult(
  Schema.toType(AppIndexPhysicalSpecSha256HexV1Schema),
);
const decodeCommitSeqResult = Schema.decodeUnknownResult(
  Schema.toType(CommitSeqSchema),
);
const decodeOrderedKeyResult = Schema.decodeUnknownResult(
  Schema.toType(OrderedIndexKeyBytesHexV1Schema),
);
const decodeOrderedBoundResult = Schema.decodeUnknownResult(
  Schema.toType(OrderedIndexBoundHexV1Schema),
);
const decodeOrderedRowIdResult = Schema.decodeUnknownResult(
  Schema.toType(OrderedIndexRowIdHexV1Schema),
);

/** Online membership set; its owner must abort the transaction on any failure. */
export const appendAppIndexEntryRevisionsInTransactionEffect = Effect.fn(
  "AppIndexEntries.appendBatch",
)(function* (
  tx: AppIndexEntryTransaction,
  inputs: ReadonlyArray<AppendAppIndexEntryRevisionV1Input>,
  publicationObservation?: PointCommitPublicationObservation,
) {
  const revisions = yield* decodeAppendInputsEffect(tx, inputs);
  return yield* appendDecodedAppIndexEntryRevisionsEffect(tx, revisions, inputs.map(input => input.membershipHeadEvidence), publicationObservation);
}, (effect, tx) => effect.pipe(Effect.onError(() => Effect.sync(() => closeExactAttemptScopeClockObservation(tx)))));

/** The common publisher supplies only a reference read from its authenticated
 * active target binding. The ordinary index revision writer still owns row
 * parent checks, revision/current writes and rollback semantics. */
export const appendPublicationIndexEntryRevisionsInTransactionEffect = Effect.fn(
  "AppIndexEntries.appendPublicationBatch",
)(function* (tx: AppIndexEntryTransaction, inputs: readonly AppendPublicationIndexEntryRevisionInput[]) {
  const revisions = yield* decodeAppendInputsEffect(tx, inputs);
  return yield* appendDecodedAppIndexEntryRevisionsEffect(tx, revisions);
}, (effect, tx) => effect.pipe(Effect.onError(() => Effect.sync(() => closeExactAttemptScopeClockObservation(tx)))));

const decodeAppendInputsEffect = Effect.fnUntraced(function* (
  tx: AppIndexEntryTransaction,
  inputs: ReadonlyArray<AppendAppIndexEntryRevisionV1Input | AppendPublicationIndexEntryRevisionInput>,
): Effect.fn.Return<
  ReadonlyArray<DecodedAppendAppIndexEntryRevisionV1>,
  AppendAppIndexEntryRevisionV1Error
> {
  const captures: DecodedAppendAppIndexEntryCapture[] = [];
  const positions = new Set<string>();
  for (const input of inputs) {
    const captured = yield* Effect.fromResult(captureAppendInputResult(input));
    const first = captures[0];
    if (
      first !== undefined &&
      (captured.identity.scopeId !== first.identity.scopeId ||
        captured.writeEpochUuid !== first.writeEpochUuid ||
        captured.commitSeq !== first.commitSeq)
    )
      return yield* Effect.fail(
        new InvalidAppIndexEntryInputError("invalidBatch"),
      );
    const key = indexPositionKey(
      captured.scopeProjection.scopeUuid,
      captured.identity,
    );
    if (positions.has(key))
      return yield* Effect.fail(
        new InvalidAppIndexEntryInputError("invalidBatch"),
      );
    positions.add(key);
    captures.push(captured);
  }
  const first = captures[0];
  if (first === undefined) return [];
  const observed = readExactScopeWriteClockObservation(tx, first.identity.scopeId);
  const clocks = observed === undefined ? yield* appendQueryEffect(
    tx
      .select({
        scopeUuid: fxSystemScopeClocks.scopeUuid,
        epochUuid: fxSystemScopeExecutionAuthorities.epochUuid,
      })
      .from(fxSystemScopeClocks).innerJoin(fxSystemScopeExecutionAuthorities, eq(fxSystemScopeExecutionAuthorities.scopeId, fxSystemScopeClocks.scopeId))
      .where(eq(fxSystemScopeClocks.scopeId, first.identity.scopeId))
      .limit(1),
  ) : [{ scopeUuid: first.scopeProjection.scopeUuid,
    epochUuid: (yield* Effect.fromResult(projectScopeEpochUuidV1Result(observed.epoch)).pipe(Effect.mapError(cause => corruption("issued clock epoch is invalid", cause)))).epochUuid }];
  if (
    clocks[0]?.scopeUuid !== first.scopeProjection.scopeUuid ||
    clocks[0].epochUuid !== first.writeEpochUuid
  )
    return yield* Effect.fail(
      new AppIndexEntryScopeAuthorityUnavailableError(first.identity.scopeId),
    );
  const specs = new Map<AppOrderedIndexPhysicalSpecV1, Uint8Array>();
  const revisions: DecodedAppendAppIndexEntryRevisionV1[] = [];
  for (const [ordinal, captured] of captures.entries()) {
    const input = inputs[ordinal];
    const issued = input === undefined || !("definition" in input) || input.membershipHeadEvidence === undefined
      ? undefined : membershipHeadEvidence.get(input.membershipHeadEvidence);
    const position = issued?.tx === tx && issued.clockIdentity !== undefined &&
      issued.clockIdentity === exactScopeWriteClockObservationIdentity(tx, captured.identity.scopeId)
      ? issued.positions.get(indexPositionKey(captured.scopeProjection.scopeUuid, captured.identity)) : undefined;
    const accepted = position !== undefined && position.tableId === captured.identity.tableId &&
      position.mutationEpoch === indexPositionMutationEpoch(tx, indexPositionKey(captured.scopeProjection.scopeUuid, captured.identity)) &&
      position.acceptedKey?.physicalSpec === captured.physicalSpec && bytesEqualFullScan(position.acceptedKey.keyBytes, captured.keyBytes)
      ? position : undefined;
    let digest = accepted?.physicalSpecSha256 ?? specs.get(captured.physicalSpec);
    if (digest === undefined) {
      const spec = yield* Effect.tryPromise({
        try: () => canonicalizeAppIndexPhysicalSpecV1(captured.physicalSpec),
        catch: (cause) => new AppIndexEntryHashError("append", cause),
      });
      digest = appIndexPhysicalSpecSha256HexV1ToBytes(spec.sha256Hex);
      specs.set(captured.physicalSpec, digest);
    }
    if (captured.expectedPhysicalSpecSha256Hex !== undefined) {
      const expected = yield* Effect.fromResult(decodePhysicalSpecDigestResult(
        captured.expectedPhysicalSpecSha256Hex).pipe(Result.mapError(cause =>
          new AppIndexEntryStorageCorruptionError("invalid activation index digest", { cause }))));
      if (!bytesEqualFullScan(digest, appIndexPhysicalSpecSha256HexV1ToBytes(expected)))
        return yield* Effect.fail(new AppIndexEntryStorageCorruptionError("activation index digest mismatch"));
    }
    revisions.push({
      historical: false,
      kind: captured.kind,
      identity: captured.identity,
      scopeUuid: captured.scopeProjection.scopeUuid,
      commitSeq: captured.commitSeq,
      physicalSpec: captured.physicalSpec,
      physicalSpecSha256: digest,
      keyBytes: captured.keyBytes,
      keySha256: accepted?.acceptedKey?.keySha256 ?? (yield* sha256Effect(captured.keyBytes, "append")),
    });
  }
  return revisions;
}, work => observeExecution("AppIndexEntries.decodeAppendInputs", work));

export const prepareAppIndexRevisionApplicationEffect = Effect.fnUntraced(function* (
  tx: AppIndexEntryTransaction, inputs: readonly AppendAppIndexEntryRevisionV1Input[],
) {
  const revisions = yield* decodeAppendInputsEffect(tx, inputs);
  return yield* prepareDecodedAppIndexRevisionApplicationEffect(tx, revisions, inputs.map(input => input.membershipHeadEvidence));
}, work => observeExecution("AppIndexEntries.prepareApplication", work));

function indexPositionKey(
  scopeUuid: ScopeUuidV1,
  identity: Pick<
    AppIndexEntryIdentityV1,
    "indexDefinitionId" | "encodedKey" | "rowId"
  >,
): string {
  return `${scopeUuid}/${identity.indexDefinitionId}/${identity.encodedKey}/${identity.rowId}`;
}

const decodeIndexBatchRefusal = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Struct({
  phase: Schema.Literals(["write", "verify"]),
  reason: Schema.Literals(["invalidBatch", "transitionConflict", "storedCorruption", "parentMissing", "parentTombstone", "revisionExists"]),
  ordinal: Schema.Number, actualCommitSeqText: Schema.NullOr(Schema.BigIntFromString),
})), { onExcessProperty: "error" });
const decodeIndexBatchSuccess = Schema.decodeUnknownResult(Schema.Struct({
  reason: Schema.Literal("accepted"), ordinal: Schema.Number, actualCommitSeqText: Schema.Null,
}), { onExcessProperty: "error" });

function indexBatchFailure(cause: unknown, batch: readonly Readonly<{ revision: Pick<DecodedAppendAppIndexEntryRevisionV1, "identity" | "commitSeq"> }>[],
  verification: readonly Readonly<{ revision: Pick<DecodedAppendAppIndexEntryRevisionV1, "identity" | "commitSeq"> }>[], capturedDetail?: string): AppendAppIndexEntryRevisionV1Error {
  const detail = capturedDetail ?? applicationDomainFailureDetail(cause, "fx_apply_app_index_batch");
  if (detail === null) return new AppIndexEntryWritePersistenceError(cause);
  return Result.match(decodeIndexBatchRefusal(detail), {
    onFailure: () => new AppIndexEntryWritePersistenceError(cause),
    onSuccess: refusal => {
      if (refusal.phase === "verify" && refusal.reason !== "storedCorruption") return new AppIndexEntryWritePersistenceError(cause);
      const selected = refusal.phase === "verify" ? [...verification, ...batch] : batch;
      const entry = Number.isSafeInteger(refusal.ordinal) && refusal.ordinal >= 0 ? selected[refusal.ordinal] : undefined;
      if (entry === undefined) return new AppIndexEntryWritePersistenceError(cause);
      const revision = entry.revision;
      switch (refusal.reason) {
        case "invalidBatch": return new InvalidAppIndexEntryInputError("invalidBatch");
        case "transitionConflict":
          if (refusal.actualCommitSeqText !== null && refusal.actualCommitSeqText <= 0n)
            return new AppIndexEntryWritePersistenceError(cause);
          return new AppIndexEntryTransitionConflictError(revision.identity, revision.commitSeq,
            refusal.actualCommitSeqText === null ? null : CommitSeqSchema.make(refusal.actualCommitSeqText));
        case "revisionExists": return new AppIndexEntryRevisionAlreadyExistsError(revision.identity, revision.commitSeq);
        case "parentMissing": return new AppIndexEntryParentRowError(revision.identity, "missing");
        case "parentTombstone": return new AppIndexEntryParentRowError(revision.identity, "tombstonedLiveEntry");
        case "storedCorruption": return corruption("index revision or current membership differs after application", cause);
      }
    },
  });
}

/** Fixed publication reports only selected intrinsic identities on failure.
 * The original batch refusal decoder still owns all row/phase ordinals. */
export function publicationAppIndexApplicationFailure(cause: unknown, identities: readonly AppIndexEntryIdentityV1[],
  commitSeq: CommitSeq, pageOffset: number, detail: string): AppendAppIndexEntryRevisionV1Error {
  if (!Number.isSafeInteger(pageOffset) || pageOffset < 0 || pageOffset % 32 !== 0 || pageOffset >= identities.length)
    return new AppIndexEntryWritePersistenceError(cause);
  const revisions = identities.map(identity => ({ revision: { identity, commitSeq } }));
  const batch = revisions.slice(pageOffset, pageOffset+32);
  return indexBatchFailure(cause,batch,pageOffset+batch.length===revisions.length ? revisions.slice(0,pageOffset) : [],detail);
}

const preparedAppIndexWrite = (revision: DecodedAppendAppIndexEntryRevisionV1) => ({
  scopeUuid: revision.scopeUuid, indexDefinitionId: revision.identity.indexDefinitionId,
  tableId: revision.identity.tableId, keyCodecVersion: ORDERED_INDEX_KEY_CODEC_VERSION_V1,
  physicalSpecSha256: revision.physicalSpecSha256, encodedKey: revision.keyBytes,
  keySha256: revision.keySha256, rowId: orderedIndexRowIdHexV1ToBytes(revision.identity.rowId),
  commitSeq: revision.commitSeq, isTombstone: revision.kind === "tombstone",
} satisfies Required<typeof fxAppIndexEntryRevisions.$inferInsert>);

const prepareDecodedAppIndexRevisionApplicationEffect = Effect.fnUntraced(function* (
  tx: AppIndexEntryTransaction,
  revisions: ReadonlyArray<DecodedAppendAppIndexEntryRevisionV1>,
  evidence?: readonly (AppIndexMembershipHeadEvidence | undefined)[],
): Effect.fn.Return<PreparedAppIndexRevisionApplication, AppendAppIndexEntryRevisionV1Error> {
  if (revisions.length > MAX_APP_INDEX_WRITE_ROWS) return yield* Effect.fail(new InvalidAppIndexEntryInputError("rowCountExceeded"));
  const heads: (AppIndexMembershipHeadV1 | null)[] = [];
  if (evidence?.some(value => value !== undefined)) {
    if (evidence.length !== revisions.length) return yield* Effect.fail(corruption("membership proof count differs"));
    for (let ordinal = 0; ordinal < revisions.length; ordinal++) {
      const revision = revisions[ordinal];
      const handle = evidence[ordinal];
      const issued = handle === undefined ? undefined : membershipHeadEvidence.get(handle);
      if (revision === undefined || issued?.tx !== tx || issued.clockIdentity === undefined ||
        issued.clockIdentity !== exactScopeWriteClockObservationIdentity(tx, revision.identity.scopeId))
        return yield* Effect.fail(corruption("membership proof is not current for this transaction"));
      const position = issued.positions.get(indexPositionKey(revision.scopeUuid, revision.identity));
      if (position === undefined || position.mutationEpoch !== indexPositionMutationEpoch(tx, indexPositionKey(revision.scopeUuid, revision.identity)) ||
        position.tableId !== revision.identity.tableId || !bytesEqualFullScan(position.physicalSpecSha256, revision.physicalSpecSha256))
        return yield* Effect.fail(corruption("membership proof does not cover this exact index position"));
      heads.push(position.head);
    }
  } else heads.push(...yield* readDecodedMembershipHeadsEffect(tx, revisions));
  const transitions: {
    revision: DecodedAppendAppIndexEntryRevisionV1;
    prior: CommitSeq | null;
  }[] = [];
  for (let i = 0; i < revisions.length; i += 1) {
    const revision = revisions[i];
    const head = heads[i];
    if (revision === undefined || head === undefined)
      return yield* Effect.fail(corruption("missing membership transition"));
    if (head?.commitSeq === revision.commitSeq)
      return yield* Effect.fail(
        new AppIndexEntryRevisionAlreadyExistsError(
          revision.identity,
          revision.commitSeq,
        ),
      );
    if (
      (head !== null && head.commitSeq >= revision.commitSeq) ||
      (revision.kind === "live"
        ? head?.isTombstone === false
        : head === null || head.isTombstone)
    )
      return yield* Effect.fail(
        new AppIndexEntryTransitionConflictError(
          revision.identity,
          revision.commitSeq,
          head?.commitSeq ?? null,
        ),
      );
    transitions.push({ revision, prior: head?.commitSeq ?? null });
  }
  // Preparation consumes only the exact membership positions it will mutate.
  // Other accepted packets in this transaction retain their original proof;
  // overlapping packets and repeated preparation cannot borrow it again.
  invalidateAppIndexMembershipPositionsInTransaction(tx, revisions);
  return { transitions, values: transitions.map(({ revision, prior }) => ({
    prior, historical: revision.historical, row: preparedAppIndexWrite(revision),
  })) };
}, work => observeExecution("AppIndexEntries.prepareDecodedApplication", work));

export interface PreparedAppIndexRevisionApplication {
  readonly transitions: readonly Readonly<{ revision: DecodedAppendAppIndexEntryRevisionV1; prior: CommitSeq | null }>[];
  readonly values: readonly Readonly<{ row: ReturnType<typeof preparedAppIndexWrite>; prior: CommitSeq | null; historical: boolean }>[];
}

export function preparedAppIndexApplicationFailure(cause: unknown, prepared: PreparedAppIndexRevisionApplication, pageOffset: number, detail: string) {
  if (!Number.isSafeInteger(pageOffset) || pageOffset < 0 || pageOffset % 32 !== 0 || pageOffset >= prepared.transitions.length)
    return new AppIndexEntryWritePersistenceError(cause);
  const batch = prepared.transitions.slice(pageOffset, pageOffset + 32);
  return indexBatchFailure(cause, batch,
    pageOffset + batch.length === prepared.transitions.length ? prepared.transitions.slice(0, pageOffset) : [], detail);
}

const appendDecodedAppIndexEntryRevisionsEffect = Effect.fn("AppIndexEntries.applyBatch")(function* (
  tx: AppIndexEntryTransaction, revisions: readonly DecodedAppendAppIndexEntryRevisionV1[],
  evidence?: readonly (AppIndexMembershipHeadEvidence | undefined)[],
  publicationObservation?: PointCommitPublicationObservation,
): Effect.fn.Return<ReadonlyArray<AppIndexEntryRevisionV1>, AppendAppIndexEntryRevisionV1Error> {
  const prepared = yield* prepareDecodedAppIndexRevisionApplicationEffect(tx, revisions, evidence);
  const transitions = prepared.transitions;
  const schemaName = yield* Effect.fromResult(requireAdmittedTargetInstallationSchema(tx)).pipe(
    Effect.mapError(cause => new AppIndexEntryWritePersistenceError(cause)));
  for (let offset = 0; offset < transitions.length; offset += 32) {
    const batch = transitions.slice(offset, offset + 32);
    const verification = offset + batch.length === transitions.length ? transitions.slice(0, offset) : [];
    const statement = buildAppIndexBatchStatement(batch.map(({ revision, prior }) => ({
      prior, historical: revision.historical, row: preparedAppIndexWrite(revision),
    })), schemaName, verification.map(({ revision }) => preparedAppIndexWrite(revision)));
    const result = yield* Effect.uninterruptible(Effect.tryPromise({
      try: () => tx.execute(statement), catch: cause => indexBatchFailure(cause, batch, verification),
    }));
    const returned = rowsFromDriverExecuteResult(result, () => { throw corruption("index application result has no rows"); });
    if (returned.length !== 1) return yield* Effect.fail(corruption("index application proof count differs"));
    const proof = yield* Effect.fromResult(decodeIndexBatchSuccess(returned[0])).pipe(
      Effect.mapError(cause => corruption("index application proof does not decode", cause)));
    if (proof.ordinal !== batch.length) return yield* Effect.fail(corruption("index application proof size differs"));
    if (publicationObservation?.detail) {
      publicationObservation.record({ kind: "batch", owner: "indexRevisions",
        counts: { rows: batch.length, canonicalBytes: batch.reduce((total, entry) => total + entry.revision.keyBytes.byteLength, 0) } });
      const creates = batch.filter(entry => entry.revision.kind === "live").length;
      if (creates > 0) publicationObservation.record({ kind: "batch", owner: "indexCreates", counts: { rows: creates } });
      if (creates < batch.length) publicationObservation.record({ kind: "batch", owner: "indexDeletes", counts: { rows: batch.length - creates } });
    }
  }
  return revisions.map(projectRevision);
});

interface AppendBackfilledAppIndexEntryRevisionV1Input {
  readonly kind: "live" | "tombstone";
  readonly scopeId: ScopeId;
  readonly scopeUuid: ScopeUuidV1;
  readonly definition: LocatedAppIndexDefinitionV1;
  readonly encodedKey: OrderedIndexKeyBytesHexV1;
  readonly rowId: OrderedIndexRowIdHexV1;
  readonly commitSeq: CommitSeq;
}

/**
 * Package-internal backfill primitive. The builder authenticates historical
 * row/fact epochs and owns the current scope-clock fence. Membership stores
 * only its transition sequence and stable row identity.
 */
export const appendBuiltAppIndexEntryRevisionInTransactionEffect = Effect.fn(
  "AppIndexEntries.appendBuiltInTransaction",
)(function* (
  tx: AppIndexEntryTransaction,
  input: AppendBackfilledAppIndexEntryRevisionV1Input,
): Effect.fn.Return<
  AppIndexEntryRevisionV1,
  AppendAppIndexEntryRevisionV1Error
> {
  const revision = yield* decodeBackfilledAppendInputEffect(tx, input);
  const written = yield* appendDecodedAppIndexEntryRevisionsEffect(tx, [revision]);
  const result = written[0];
  if (result === undefined) return yield* Effect.fail(corruption("backfill revision missing"));
  return result;
});

export interface AppIndexEntryPositionV1 {
  readonly definition: LocatedAppIndexDefinitionV1;
  readonly encodedKey: OrderedIndexKeyBytesHexV1;
  readonly rowId: OrderedIndexRowIdHexV1;
}
export interface AppIndexMembershipHeadV1 {
  readonly commitSeq: CommitSeq;
  readonly isTombstone: boolean;
}
interface DecodedMembershipPosition {
  readonly identity: AppIndexEntryIdentityV1;
  readonly scopeUuid: ScopeUuidV1;
  readonly physicalSpec: AppOrderedIndexPhysicalSpecV1;
  readonly physicalSpecSha256: Uint8Array;
  readonly keyBytes: Uint8Array;
}
const MembershipHeadEnvelopeSchema = Schema.Struct({
  ordinal: Schema.String,
  currentCommitSeq: Schema.NullOr(Schema.String),
  commitSeqText: Schema.NullOr(Schema.String),
});
const decodeMembershipHeadEnvelope = Schema.decodeUnknownEffect(
  MembershipHeadEnvelopeSchema,
);

export interface AppIndexMembershipHeadEvidence { readonly _tag: "AppIndexMembershipHeadEvidence" }
const membershipHeadEvidence = new WeakMap<AppIndexMembershipHeadEvidence, Readonly<{
  tx: AppIndexEntryTransaction; clockIdentity: symbol | undefined;
  positions: ReadonlyMap<string, AcceptedAppIndexMembershipPosition>;
}>>();

interface AcceptedAppIndexMembershipPosition {
  readonly mutationEpoch: number;
  readonly head: AppIndexMembershipHeadV1 | null; readonly tableId: CatalogTableId;
  readonly physicalSpecSha256: Uint8Array;
  readonly acceptedKey?: Readonly<{ physicalSpec: AppOrderedIndexPhysicalSpecV1; keyBytes: Uint8Array; keySha256: Uint8Array }>;
}

export interface AppIndexKeyTransitionObligation {
  readonly definition: LocatedAppIndexDefinitionV1;
  readonly rowId: OrderedIndexRowIdHexV1;
  readonly priorCommitSeq: CommitSeq | null;
  readonly priorKey: OrderedIndexKeyHexV1 | null;
  readonly finalKey: OrderedIndexKeyHexV1 | null;
}
export interface AppIndexKeyTransition extends AppIndexKeyTransitionObligation {
  readonly build: IndexBuildStateRecord;
}
export class AppIndexTransitionLimitExceededError extends Data.TaggedError("AppIndexTransitionLimitExceededError")<{
  readonly observed: number; readonly maximum: number;
}> {}
export class AppIndexTransitionAcceptanceError extends Data.TaggedError("AppIndexTransitionAcceptanceError")<{
  readonly reason: "invalidBatch" | "buildInvalid" | "transitionInvalid"; readonly ordinal: number; readonly cause: unknown;
}> {}
const decodeIndexTransitionProof = Schema.decodeUnknownResult(Schema.Struct({
  reason: Schema.Literals(["transition", "accepted"]), pair_ordinal: Schema.NullOr(Schema.Number), key_ordinal: Schema.NullOr(Schema.Number),
  transition_kind: Schema.NullOr(Schema.Literals(["live", "tombstone"])), prior_commit_seq: Schema.NullOr(Schema.BigIntFromString),
  prior_is_tombstone: Schema.NullOr(Schema.Boolean), emitted_count: Schema.Number,
}), { onExcessProperty: "error" });
const decodeIndexTransitionRefusal = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Struct({
  reason: Schema.Literals(["invalidBatch", "buildInvalid", "storedCorruption", "transitionInvalid", "limitExceeded"]),
  ordinal: Schema.Number, observed: Schema.Number,
})), { onExcessProperty: "error" });

const acceptPreparedAppIndexKeyTransitionResult = Effect.fnUntraced(function* (
  tx: AppIndexEntryTransaction, scopeId: ScopeId, scopeUuid: ScopeUuidV1,
  pairs: readonly (AppIndexKeyTransition | AppIndexKeyTransitionObligation)[],
  byPosition: ReadonlyMap<string, DecodedMembershipPosition>, keyDigests: ReadonlyMap<OrderedIndexKeyHexV1, Uint8Array>,
  epoch: number, clockIdentity: symbol | undefined, result: unknown,
) {
    if (indexMutationEpoch(tx) !== epoch || exactScopeWriteClockObservationIdentity(tx, scopeId) !== clockIdentity)
      return yield* Effect.fail(corruption("index transition acceptance lifetime differs"));
  const rows = yield* Effect.fromResult(captureDriverRowsResult(result));
  const selected: { kind: "live" | "tombstone"; definition: LocatedAppIndexDefinitionV1; encodedKey: OrderedIndexKeyHexV1; rowId: OrderedIndexRowIdHexV1 }[] = [];
  const issued = new Map<string, AcceptedAppIndexMembershipPosition>();
  let terminal = false;
  for (const [ordinal, raw] of rows.entries()) {
    const proof = yield* Effect.fromResult(decodeIndexTransitionProof(raw).pipe(Result.mapError(cause => corruption("index transition result invalid", cause))));
    if (proof.reason === "accepted") {
      if (ordinal !== rows.length-1 || proof.emitted_count !== selected.length || proof.pair_ordinal !== null || proof.key_ordinal !== null ||
        proof.transition_kind !== null || proof.prior_commit_seq !== null || proof.prior_is_tombstone !== null)
        return yield* Effect.fail(corruption("index transition terminal count differs"));
      terminal = true;
      continue;
    }
    const pair = proof.pair_ordinal !== null && Number.isSafeInteger(proof.pair_ordinal) && proof.pair_ordinal >= 0 ? pairs[proof.pair_ordinal] : undefined;
    const key = pair === undefined ? null : proof.key_ordinal === 0 ? pair.priorKey : proof.key_ordinal === 1 ? pair.finalKey : null;
    if (pair === undefined || key === null || proof.transition_kind === null || proof.emitted_count !== selected.length+1 ||
      (proof.transition_kind === "tombstone" && proof.key_ordinal !== 0) ||
      (proof.prior_commit_seq === null ? proof.prior_is_tombstone !== null : proof.prior_commit_seq <= 0n || proof.prior_is_tombstone === null))
      return yield* Effect.fail(corruption("index transition does not match canonical obligation"));
    if ((proof.key_ordinal === 0 && proof.transition_kind === "live" && (pair.priorKey !== pair.finalKey || proof.prior_commit_seq !== null)) ||
      (proof.transition_kind === "tombstone" && (pair.priorKey === pair.finalKey || proof.prior_commit_seq === null || proof.prior_is_tombstone !== false ||
        pair.priorCommitSeq === null || proof.prior_commit_seq > pair.priorCommitSeq)) ||
      (proof.key_ordinal === 1 && (pair.priorKey === pair.finalKey || (proof.prior_commit_seq !== null && proof.prior_is_tombstone !== true))))
      return yield* Effect.fail(corruption("selected index transition proof is unreachable"));
    if (pair.definition.access.kind === "by_creation_time" && proof.key_ordinal === 1 && proof.prior_commit_seq !== null)
      return yield* Effect.fail(corruption("new intrinsic membership has a prior revision"));
    const identity = { scopeId: scopeId, indexDefinitionId: pair.definition.indexDefinitionId, tableId: pair.definition.access.tableId, encodedKey: key, rowId: pair.rowId };
    const positionKey = indexPositionKey(scopeUuid, identity); const position = byPosition.get(positionKey);
    if (position === undefined || issued.has(positionKey)) return yield* Effect.fail(corruption("index transition selected position repeated or missing"));
    const priorCommitSeq = proof.prior_commit_seq === null ? null : yield* Effect.fromResult(decodeCommitSeqResult(proof.prior_commit_seq)
      .pipe(Result.mapError(cause => corruption("index transition prior revision is invalid", cause))));
    const keySha256 = keyDigests.get(key);
    if (keySha256 === undefined) return yield* Effect.fail(corruption("accepted index key digest missing"));
    issued.set(positionKey, Object.freeze({ tableId: identity.tableId, mutationEpoch: indexPositionMutationEpoch(tx, positionKey),
      physicalSpecSha256: position.physicalSpecSha256,
      acceptedKey: Object.freeze({ physicalSpec: position.physicalSpec, keyBytes: position.keyBytes, keySha256 }),
      head: priorCommitSeq === null || proof.prior_is_tombstone === null ? null
        : { commitSeq: priorCommitSeq, isTombstone: proof.prior_is_tombstone } }));
    selected.push({ kind: proof.transition_kind, definition: pair.definition, encodedKey: key, rowId: pair.rowId });
  }
  if (!terminal) return yield* Effect.fail(corruption("missing index transition terminal proof"));
  const evidence = Object.freeze({ _tag: "AppIndexMembershipHeadEvidence" as const });
  membershipHeadEvidence.set(evidence, { tx, clockIdentity: exactScopeWriteClockObservationIdentity(tx, scopeId), positions: issued });
  return Object.freeze(selected.map(action => Object.freeze({ ...action, membershipHeadEvidence: evidence })));
});

/** Actual membership chooses writes. Only selected tuples are returned, and
 * their current predecessor enters the existing transaction-bound issuer. */
export const prepareAppIndexKeyTransitionAcceptanceInTransactionEffect = Effect.fnUntraced(function* (
  tx: AppIndexEntryTransaction, input: { readonly scopeId: ScopeId; readonly pairs: readonly (AppIndexKeyTransition | AppIndexKeyTransitionObligation)[]; readonly maximumActions: number },
) {
  const positions = input.pairs.flatMap(pair => [pair.priorKey, pair.finalKey].flatMap(encodedKey => encodedKey === null ? [] :
    [{ definition: pair.definition, encodedKey, rowId: pair.rowId }]));
  const decoded = yield* decodeMembershipPositionsEffect(tx, { scopeId: input.scopeId, positions });
  const byPosition = new Map(decoded.map(position => [indexPositionKey(position.scopeUuid, position.identity), position]));
  const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(input.scopeId).pipe(Result.mapError(cause => corruption("invalid transition scope", cause))));
  if (decoded.length === 0 && input.pairs.length > 0) yield* requireScopeUuidEffect(tx, input.scopeId, scope);
  const previous: (Uint8Array | null)[] = []; const final: (Uint8Array | null)[] = [];
  const previousSha: (Uint8Array | null)[] = []; const finalSha: (Uint8Array | null)[] = [];
  const specs: Uint8Array[] = [];
  const keyDigests = new Map<OrderedIndexKeyHexV1, Uint8Array>();
  for (const pair of input.pairs) {
    if ((pair.definition.access.kind !== "developer" && pair.definition.access.kind !== "by_creation_time") ||
      ("build" in pair && (pair.build.scopeId !== input.scopeId || pair.build.indexDefinitionId !== pair.definition.indexDefinitionId)))
      return yield* Effect.fail(corruption("index transition build identity differs"));
    specs.push(appIndexPhysicalSpecSha256HexV1ToBytes(pair.definition.physicalSpecSha256Hex));
    const oldBytes = pair.priorKey === null ? null : orderedIndexKeyBytesHexV1ToBytes(pair.priorKey);
    const newBytes = pair.finalKey === null ? null : orderedIndexKeyBytesHexV1ToBytes(pair.finalKey);
    previous.push(oldBytes); final.push(newBytes);
    for (const [key, bytes] of [[pair.priorKey, oldBytes], [pair.finalKey, newBytes]] as const) {
      if (key !== null && bytes !== null && !keyDigests.has(key))
        keyDigests.set(key, yield* sha256Effect(bytes, "read"));
    }
    previousSha.push(pair.priorKey === null ? null : keyDigests.get(pair.priorKey) ?? null);
    finalSha.push(pair.finalKey === null ? null : keyDigests.get(pair.finalKey) ?? null);
  }
  const schemaName = yield* Effect.fromResult(requireAdmittedTargetInstallationSchema(tx).pipe(Result.mapError(cause => new AppIndexEntryReadPersistenceError("scanCurrent", cause))));
  const scalar = applicationIndexTransitionScalarArray; const bytes = applicationIndexTransitionByteArray;
  const pairs = input.pairs; const columns = fxAppIndexEntryRevisions; const builds = fxSystemIndexBuildStates;
  const keyParameters = sql`      ${scalar(pairs.map(pair => pair.definition.indexDefinitionId), "integer", columns.indexDefinitionId)},
      ${scalar(pairs.map(pair => pair.definition.access.kind), "text", builds.scopeId)},
      ${scalar(pairs.map(pair => pair.definition.access.tableId), "integer", columns.tableId)},
      ${scalar(pairs.map(() => ORDERED_INDEX_KEY_CODEC_VERSION_V1), "integer", columns.keyCodecVersion)},
      ${bytes(specs, columns.physicalSpecSha256)}, ${bytes(pairs.map(pair => orderedIndexRowIdHexV1ToBytes(pair.rowId)), columns.rowId)},
      ${bytes(previous, columns.encodedKey)}, ${bytes(previousSha, columns.keySha256)}, ${bytes(final, columns.encodedKey)}, ${bytes(finalSha, columns.keySha256)},
      ${scalar(pairs.map(pair => pair.priorCommitSeq), "bigint", columns.commitSeq)}`;
  const parameters = sql`      ${sql.param(input.scopeId, builds.scopeId)}::text, ${sql.param(scope.scopeUuid, columns.scopeUuid)}::uuid,
      ${keyParameters},
      ${scalar(pairs.map(pair => "build" in pair ? pair.build.attemptFence : null), "bigint", builds.attemptFence)},
      ${scalar(pairs.map(pair => "build" in pair ? pair.build.epoch : null), "text", builds.epoch)},
      ${scalar(pairs.map(pair => "build" in pair ? pair.build.storageGenerationFence : null), "bigint", builds.storageGenerationFence)}, ${input.maximumActions}::integer`;
  const statement = sql`select reason, pair_ordinal, key_ordinal, transition_kind, prior_commit_seq::text, prior_is_tombstone, emitted_count
    from ${sql.identifier(schemaName)}.fx_accept_app_index_transitions(${parameters})`;
  const epoch = indexMutationEpoch(tx);
  const clockIdentity = exactScopeWriteClockObservationIdentity(tx, input.scopeId);
  const mapFailure = (cause: unknown) => {
    const detail = applicationDomainFailureDetail(cause, "fx_accept_app_index_transitions");
    if (detail === null) return new AppIndexEntryReadPersistenceError("scanCurrent", cause);
    return Result.match(decodeIndexTransitionRefusal(detail), { onFailure: () => new AppIndexEntryReadPersistenceError("scanCurrent", cause), onSuccess: proof => {
      if (!Number.isSafeInteger(proof.ordinal) || proof.ordinal < 0 || proof.ordinal >= Math.max(pairs.length, 1) ||
        !Number.isSafeInteger(proof.observed) || proof.observed < 0) return new AppIndexEntryReadPersistenceError("scanCurrent", cause);
      if (proof.reason === "limitExceeded") return proof.observed > input.maximumActions
        ? new AppIndexTransitionLimitExceededError({ observed: proof.observed, maximum: input.maximumActions }) : new AppIndexEntryReadPersistenceError("scanCurrent", cause);
      return proof.reason === "storedCorruption" ? corruption("index transition stored membership invalid", cause)
        : new AppIndexTransitionAcceptanceError({ reason: proof.reason, ordinal: proof.ordinal, cause });
    } });
  };
  const accept = (result: unknown) => acceptPreparedAppIndexKeyTransitionResult(
    tx, input.scopeId, scope.scopeUuid, pairs, byPosition, keyDigests, epoch, clockIdentity, result);
  return Object.freeze({ parameters, keyParameters, statement, accept, mapFailure });
});

export const acceptAppIndexKeyTransitionsInTransactionEffect = Effect.fn("AppIndexEntries.acceptKeyTransitions")(function* (
  tx: AppIndexEntryTransaction, input: { readonly scopeId: ScopeId; readonly pairs: readonly AppIndexKeyTransition[]; readonly maximumActions: number },
) {
  const prepared = yield* prepareAppIndexKeyTransitionAcceptanceInTransactionEffect(tx, input);
  const result = yield* Effect.uninterruptible(Effect.tryPromise({ try: () => tx.execute(prepared.statement), catch: prepared.mapFailure }));
  return yield* prepared.accept(result);
});

/** Authenticate latest membership and its exact current pointer before omitting a write. */
export const readAppIndexMembershipHeadsInTransactionEffect = Effect.fn(
  "AppIndexEntries.readMembershipHeads",
)(function* (
  tx: AppIndexEntryTransaction,
  input: {
    readonly scopeId: ScopeId;
    readonly positions: ReadonlyArray<AppIndexEntryPositionV1>;
  },
): Effect.fn.Return<
  Readonly<{ heads: ReadonlyArray<AppIndexMembershipHeadV1 | null>; evidence: AppIndexMembershipHeadEvidence }>,
  ReadAppIndexRangeV1Error
> {
  const decoded = yield* decodeMembershipPositionsEffect(tx, input);
  const scopeId = input.scopeId;
  const heads = yield* readDecodedMembershipHeadsEffect(tx, decoded);
  const positions = new Map<string, AcceptedAppIndexMembershipPosition>();
  for (let ordinal = 0; ordinal < decoded.length; ordinal++) {
    const position = decoded[ordinal];
    const head = heads[ordinal];
    if (position === undefined || head === undefined) return yield* Effect.die(new Error("Membership proof lost a position"));
    const key = indexPositionKey(position.scopeUuid, position.identity);
    positions.set(key,
      Object.freeze({ head, tableId: position.identity.tableId, mutationEpoch: indexPositionMutationEpoch(tx, key),
        physicalSpecSha256: new Uint8Array(position.physicalSpecSha256) }));
  }
  const evidence = Object.freeze({ _tag: "AppIndexMembershipHeadEvidence" as const });
  membershipHeadEvidence.set(evidence, Object.freeze({ tx, clockIdentity: exactScopeWriteClockObservationIdentity(tx, scopeId), positions }));
  return Object.freeze({ heads, evidence });
});

const decodeMembershipPositionsEffect = Effect.fnUntraced(function* (
  tx: AppIndexEntryTransaction, input: { readonly scopeId: ScopeId; readonly positions: readonly AppIndexEntryPositionV1[] },
) {
  const scopeId = input.scopeId;
  const definitions = new Map<
    LocatedAppIndexDefinitionV1,
    PreparedIndexReadDefinition
  >();
  let scopeUuid: ScopeUuidV1 | undefined;
  const decoded: DecodedMembershipPosition[] = [];
  for (const position of input.positions) {
    const {
      definition: locatedDefinition,
      encodedKey: inputKey,
      rowId: inputRowId,
    } = position;
    let definition = definitions.get(locatedDefinition);
    if (definition === undefined) {
      const captured = yield* Effect.fromResult(
        captureIndexReadDefinitionResult(scopeId, locatedDefinition),
      );
      definition = yield* prepareIndexReadDefinitionEffect(captured);
      definitions.set(locatedDefinition, definition);
    }
    if (scopeUuid === undefined) {
      scopeUuid = yield* requireScopeUuidEffect(
        tx,
        definition.scopeId,
        definition.scopeProjection,
      );
    }
    const encodedKey = yield* Effect.fromResult(
      decodeWriteFieldResult(
        decodeOrderedKeyResult(inputKey),
        "invalidEncodedKey",
      ),
    );
    yield* Effect.try({try:()=>decodeAppOrderedIndexKeyV1({spec:definition.physicalSpec,encodedKey}),catch:cause=>new InvalidAppIndexEntryInputError("invalidEncodedKey",cause)});
    const rowId = yield* Effect.fromResult(
      decodeWriteFieldResult(
        decodeOrderedRowIdResult(inputRowId),
        "invalidRowId",
      ),
    );
    decoded.push({
      identity: {
        scopeId,
        indexDefinitionId: definition.indexDefinitionId,
        tableId: locatedDefinition.access.tableId,
        encodedKey,
        rowId,
      },
      scopeUuid,
      physicalSpec: definition.physicalSpec,
      physicalSpecSha256: definition.physicalSpecSha256,
      keyBytes: orderedIndexKeyBytesHexV1ToBytes(encodedKey),
    });
  }
  return decoded;
}, work => observeExecution("AppIndexEntries.prepareMembershipPositions", work));

const readDecodedMembershipHeadsEffect = Effect.fn(
  "AppIndexEntries.readDecodedMembershipHeads",
)(function* (
  tx: AppIndexEntryTransaction,
  positions: ReadonlyArray<DecodedMembershipPosition>,
): Effect.fn.Return<
  ReadonlyArray<AppIndexMembershipHeadV1 | null>,
  ReadAppIndexRangeV1Error
> {
  const heads: (AppIndexMembershipHeadV1 | null)[] = [];
  for (let offset = 0; offset < positions.length; offset += 32) {
    const batch = positions.slice(offset, offset + 32);
    const values = sql.join(
      batch.map(
        (position, ordinal) =>
          sql`(${ordinal}::integer, ${position.scopeUuid}::uuid, ${position.identity.indexDefinitionId}::integer, ${position.keyBytes}::bytea, ${orderedIndexRowIdHexV1ToBytes(position.identity.rowId)}::bytea)`,
      ),
      sql`, `,
    );
    const statement = sql`
        with requested(ordinal, scope_uuid, index_definition_id, encoded_key, row_id) as (values ${values})
        select requested.ordinal::text as "ordinal", current_entry.commit_seq::text as "currentCommitSeq",
          latest.table_id::text as "tableIdText", latest.key_codec_version::text as "keyCodecVersionText",
          latest.physical_spec_sha256 as "physicalSpecSha256", latest.encoded_key as "encodedKeyBytes",
          latest.key_sha256 as "keySha256", latest.row_id as "rowIdBytes",
          latest.commit_seq::text as "commitSeqText", latest.is_tombstone as "isTombstone"
        from requested
        left join fx_app_index_entry_current as current_entry on
          current_entry.scope_uuid = requested.scope_uuid and current_entry.index_definition_id = requested.index_definition_id
          and current_entry.encoded_key = requested.encoded_key and current_entry.row_id = requested.row_id
        left join lateral (
          select revision.* from fx_app_index_entry_rev as revision
          where revision.scope_uuid = requested.scope_uuid and revision.index_definition_id = requested.index_definition_id
            and revision.encoded_key = requested.encoded_key and revision.row_id = requested.row_id
          order by revision.commit_seq desc limit 1
        ) as latest on true order by requested.ordinal`;
    const query = tx.execute(statement);
    const result = yield* Effect.uninterruptible(
      Effect.tryPromise({
        try: () => query,
        catch: (cause) =>
          new AppIndexEntryReadPersistenceError("scanCurrent", cause),
      }),
    );
    const rows = yield* Effect.fromResult(captureDriverRowsResult(result));
    if (rows.length !== batch.length)
      return yield* Effect.fail(
        corruption("membership head result count differs"),
      );
    for (let ordinal = 0; ordinal < batch.length; ordinal += 1) {
      const position = batch[ordinal];
      if (position === undefined)
        return yield* Effect.fail(corruption("membership position missing"));
      const raw = rows[ordinal];
      const envelope = yield* decodeMembershipHeadEnvelope(raw).pipe(
        Effect.mapError(cause => corruption("membership head envelope invalid", cause)));
      if (envelope.ordinal !== String(ordinal))
        return yield* Effect.fail(
          corruption("membership position order differs"),
        );
      if (envelope.commitSeqText === null) {
        if (envelope.currentCommitSeq !== null)
          return yield* Effect.fail(
            corruption("current pointer has no membership history"),
          );
        heads.push(null);
        continue;
      }
      const value = yield* decodeStoredMembershipEffect(raw).pipe(
        Effect.mapError(cause => corruption("membership row does not decode", cause)));
      const membership = yield* Effect.fromResult(
        captureRangeRowResult(
          position.physicalSpec,
          position.physicalSpecSha256,
          value,
        ),
      );
      const digest = yield* sha256Effect(membership.keyBytes, "read");
      if (
        membership.tableId !== position.identity.tableId ||
        membership.rowId !== position.identity.rowId ||
        membership.encodedKey !== position.identity.encodedKey ||
        !bytesEqualFullScan(digest, membership.keySha256) ||
        (membership.isTombstone
          ? envelope.currentCommitSeq !== null
          : envelope.currentCommitSeq !== String(membership.commitSeq))
      ) {
        return yield* Effect.fail(
          corruption("latest membership evidence or current pointer differs"),
        );
      }
      heads.push(
        Object.freeze({
          commitSeq: membership.commitSeq,
          isTombstone: membership.isTombstone,
        }),
      );
    }
  }
  return Object.freeze(heads);
});

export const scanAppIndexAtSnapshotInTransactionEffect = Effect.fnUntraced(function* (
  tx: AppIndexEntryTransaction,
  input: ScanAppIndexAtSnapshotV1Input,
  observer?: Parameters<typeof observeDrizzleRawQuery<"scanCurrent">>[2],
): Effect.fn.Return<AppIndexRangePageV1, ReadAppIndexRangeV1Error> {
  const prepared = yield* Effect.fromResult(prepareAppIndexSnapshotReadResult(input));
  yield* requireScopeUuidEffect(tx, prepared.scopeId, { scopeUuid: prepared.scopeUuid });
  const query = readSnapshotRange(tx, { scopeUuid: prepared.scopeUuid, indexDefinitionId: prepared.indexDefinitionId,
    snapshotCommitSeq: prepared.snapshotCommitSeq, start: prepared.bounds.startInclusive ?? null,
    end: prepared.bounds.endExclusive ?? null, afterKey: prepared.after?.keyBytes ?? null,
    afterRow: prepared.after?.rowIdBytes ?? null, limit: prepared.limit });
  observeDrizzleRawQuery("scanCurrent", query, observer);
  const driverResult = yield* Effect.uninterruptible(Effect.tryPromise({ try: () => query,
    catch: cause => new AppIndexEntryReadPersistenceError("scanSnapshot", cause) }));
  const rows = yield* Effect.fromResult(captureDriverRowsResult(driverResult));
  return yield* decodeCapturedAppIndexSnapshotPageEffect(prepared, rows);
}, work => observeExecution("AppIndexEntries.scanAtSnapshotInTransaction", work));

export const scanCurrentAppIndexInTransactionEffect = Effect.fnUntraced(function* (
  tx: AppIndexEntryTransaction,
  input: ScanCurrentAppIndexV1Input,
  observer?: Parameters<typeof observeDrizzleRawQuery<"scanCurrent">>[2],
): Effect.fn.Return<AppIndexRangePageV1, ReadAppIndexRangeV1Error> {
  const decoded = yield* decodeRangeReadEffect(tx, input);
  return yield* executeAndDecodeRangeEffect(
    tx,
    decoded,
    readCurrentRange(tx, decoded),
    "scanCurrent",
    observer,
  );
}, work => observeExecution("AppIndexEntries.scanCurrentInTransaction", work));

const decodePageBatchEnvelopeEffect = Schema.decodeUnknownEffect(Schema.Struct({
  ordinal: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)), present: Schema.NullOr(Schema.Boolean),
}));

/** Bounded ordinal predicates, including empty predicates. Preparation failures
 * and stored body decoding remain in demand order; the trusted consumer can
 * reject one observation before a later stored body is decoded. */
export const consumeCurrentAppIndexPagesInTransactionEffect = Effect.fnUntraced(
  function* <Failure, Requirements>(tx: AppIndexEntryTransaction, inputs: readonly ScanCurrentAppIndexV1Input[],
    error: (cause: ReadAppIndexRangeV1Error) => Failure,
    consume: (ordinal: number, page: AppIndexRangePageV1) => Effect.Effect<void, Failure, Requirements>,
  ): Effect.fn.Return<void, Failure, Requirements> {
    for (let offset = 0; offset < inputs.length;) {
      const prepared: DecodedAppIndexRangeReadV1[] = [];
      let outputBound = 0;
      let preparationFailure: ReadAppIndexRangeV1Error | undefined;
      while (offset + prepared.length < inputs.length && prepared.length < 32) {
        const input = inputs[offset + prepared.length];
        if (input === undefined) return yield* Effect.die(new Error("Index batch lost a demand"));
        const bound = (input.limit + 1) * (2048 + 256);
        if (prepared.length > 0 && outputBound + bound > 262_144) break;
        const previous = prepared[0];
        const decoded = yield* Effect.result(decodeRangeReadEffect(tx, input,
          previous === undefined ? undefined : { scopeId: previous.scopeId, scopeUuid: previous.scopeUuid }));
        if (Result.isFailure(decoded)) { preparationFailure = decoded.failure; break; }
        prepared.push(decoded.success);
        outputBound += bound;
      }
      if (prepared.length > 0) {
        const result = yield* Effect.uninterruptible(runDrizzleStatementEffect(readCurrentDemandPages(tx, {
          // Fresh scalar records from already decoded owner inputs, never a
          // foreign JSON value or reusable storage/authority verdict.
          demands: JSON.stringify(prepared.map(input => ({
            scope_uuid: input.scopeUuid, definition_id: input.indexDefinitionId,
            shape: (input.bounds.startInclusive === undefined ? 0 : 1) |
              (input.bounds.endExclusive === undefined ? 0 : 2) | (input.after === undefined ? 0 : 4),
            start_hex: input.bounds.startInclusive === undefined ? null : encodeBytesToLowercaseHex(input.bounds.startInclusive),
            end_hex: input.bounds.endExclusive === undefined ? null : encodeBytesToLowercaseHex(input.bounds.endExclusive),
            after_key_hex: input.after === undefined ? null : encodeBytesToLowercaseHex(input.after.keyBytes),
            after_row_hex: input.after === undefined ? null : encodeBytesToLowercaseHex(input.after.rowIdBytes),
            page_limit: input.limit + 1,
          }))),
        }), cause => new AppIndexEntryReadPersistenceError("scanCurrent", cause))).pipe(Effect.mapError(error));
        const rows = yield* Effect.fromResult(captureDriverRowsResult(result)).pipe(Effect.mapError(error));
        const grouped: unknown[][] = prepared.map(() => []);
        for (const raw of rows) {
          const envelope = yield* decodePageBatchEnvelopeEffect(raw).pipe(Effect.mapError(cause =>
            error(corruption("invalid index batch envelope", cause))));
          const group = grouped[envelope.ordinal];
          if (group === undefined) return yield* Effect.fail(error(corruption("unrequested index batch ordinal")));
          group.push(raw);
        }
        for (let ordinal = 0; ordinal < prepared.length; ordinal++) {
          const input = prepared[ordinal];
          const group = grouped[ordinal];
          if (input === undefined || group === undefined || group.length === 0)
            return yield* Effect.fail(error(corruption("missing index batch ordinal")));
          const entries: AppIndexRangeEntryV1[] = [];
          for (const raw of group) {
            const envelope = yield* decodePageBatchEnvelopeEffect(raw).pipe(Effect.mapError(cause =>
              error(corruption("invalid index batch envelope", cause))));
            if (envelope.present === null) {
              if (group.length !== 1) return yield* Effect.fail(error(corruption("duplicate empty index batch ordinal")));
            } else if (envelope.present === true) entries.push(yield* decodeRangeRowEffect(input, raw).pipe(Effect.mapError(error)));
            else return yield* Effect.fail(error(corruption("invalid index batch presence")));
          }
          if (entries.length > input.limit + 1) return yield* Effect.fail(error(corruption("index batch exceeded ordinal bound")));
          const page = projectRangePage(input.limit, entries);
          yield* consume(offset + ordinal, page);
        }
        offset += prepared.length;
      }
      if (preparationFailure !== undefined) return yield* Effect.fail(error(preparationFailure));
    }
  }, work => observeExecution("AppIndexEntries.consumeCurrentPages", work));

/** Reuse the bounded current-index reader for an index copied into the
 * target-side activation. This never opens the control catalog at settlement. */
export const scanCurrentPublicationIndexInTransactionEffect = Effect.fnUntraced(function* (
  tx: AppIndexEntryTransaction,
  input: PublicationIndexRangeInput,
): Effect.fn.Return<AppIndexRangePageV1, ReadAppIndexRangeV1Error> {
  const decoded = yield* decodeRangeReadEffect(tx, input);
  return yield* executeAndDecodeRangeEffect(tx, decoded, readCurrentRange(tx, decoded), "scanCurrent");
}, work => observeExecution("AppIndexEntries.scanCurrentPublicationIndex", work));

/** Bounded cardinality probe over the same current index range used by the
 * page reader. A transition can refuse over-budget fan-out before writing any
 * derived revisions. The result is capped at maximumEntries + 1; it is not an
 * unbounded count or a substitute for page-by-page row validation. */
export const countCurrentAppIndexRangeUpToLimitInTransactionEffect = Effect.fnUntraced(function* (
  tx: AppIndexEntryTransaction,
  input: Omit<ScanCurrentAppIndexV1Input, "after" | "limit"> & { readonly maximumEntries: number },
): Effect.fn.Return<number, ReadAppIndexRangeV1Error> {
  if (!Number.isSafeInteger(input.maximumEntries) || input.maximumEntries < 1 || input.maximumEntries > 65_535)
    return yield* Effect.fail(new InvalidAppIndexEntryInputError("invalidLimit"));
  const decoded = yield* decodeRangeReadEffect(tx, { ...input, limit: 1 });
  const shape = (decoded.bounds.startInclusive === undefined ? 0 : 1) | (decoded.bounds.endExclusive === undefined ? 0 : 2);
  const read = currentRangeCountReads[shape];
  if (read === undefined) return yield* Effect.die(new Error("Current range count shape is unavailable"));
  const query = read(tx, { scopeUuid: decoded.scopeUuid, indexDefinitionId: decoded.indexDefinitionId,
    start: decoded.bounds.startInclusive, end: decoded.bounds.endExclusive, limit: input.maximumEntries + 1 });
  const driverResult = yield* Effect.uninterruptible(runDrizzleStatementEffect(query,
    cause => new AppIndexEntryReadPersistenceError("scanCurrent", cause)));
  const rows = yield* Effect.fromResult(captureDriverRowsResult(driverResult));
  if (rows.length !== 1)
    return yield* Effect.fail(new AppIndexEntryStorageCorruptionError("invalid bounded range count"));
  const row = yield* Effect.fromResult(decodeBoundedRangeCountRow(rows[0])).pipe(Effect.mapError(cause =>
    new AppIndexEntryStorageCorruptionError("invalid bounded range count", { cause })));
  const count = Number(row.countText);
  if (!Number.isSafeInteger(count) || count > input.maximumEntries + 1)
    return yield* Effect.fail(new AppIndexEntryStorageCorruptionError("out-of-range bounded count"));
  return count;
}, work => observeExecution("AppIndexEntries.countCurrentRangeUpToLimit", work));

const indexMutationEpochs = new WeakMap<AppIndexEntryTransaction, number>();
const indexMutationEpoch = (tx: AppIndexEntryTransaction) => indexMutationEpochs.get(tx) ?? 0;
const indexPositionMutationEpochs = new WeakMap<AppIndexEntryTransaction, Map<string, number>>();
const indexPositionMutationEpoch = (tx: AppIndexEntryTransaction, position: string) => indexPositionMutationEpochs.get(tx)?.get(position) ?? 0;

/** Existing writers supply authenticated exact positions before applying their
 * prepared mutation. Fixed publication uses this same owner for intrinsic
 * tuples applied inside its installed program. This grants no read or write. */
export function invalidateAppIndexMembershipPositionsInTransaction(tx: AppIndexEntryTransaction,
  positions: readonly Pick<DecodedMembershipPosition, "scopeUuid" | "identity">[]) {
  const epochs = indexPositionMutationEpochs.get(tx) ?? new Map<string, number>();
  const selected = new Set<string>();
  for (const position of positions) {
    const key = indexPositionKey(position.scopeUuid, position.identity);
    if (selected.has(key)) continue;
    selected.add(key);
    epochs.set(key, (epochs.get(key) ?? 0) + 1);
  }
  indexPositionMutationEpochs.set(tx, epochs);
  // Broad reverse-membership captures and pending native SQL acceptance still
  // bind the whole frontier, so any preparation retains global invalidation.
  indexMutationEpochs.set(tx, indexMutationEpoch(tx) + 1);
}

type CapturedPublicationMembershipRow = Readonly<{ raw: unknown; present: boolean | null }>;
type CapturedPublicationMemberships = { active: boolean;
  readonly tx: AppIndexEntryTransaction; readonly scopeId: ScopeId; readonly epoch: number;
  readonly clockIdentity: ReturnType<typeof exactScopeWriteClockObservationIdentity>;
  readonly decoded: DecodedAppIndexRangeReadV1; readonly rowIds: readonly OrderedIndexRowIdHexV1[];
  readonly groups: readonly (readonly CapturedPublicationMembershipRow[])[];
};

const readCapturedPublicationRowOrdinal = Effect.fnUntraced(function* <Failure>(
  capture: CapturedPublicationMemberships, ordinal: number, error: (cause: ReadAppIndexRangeV1Error) => Failure,
): Effect.fn.Return<readonly AppIndexRangeEntryV1[], Failure> {
  if (!capture.active || capture.epoch !== indexMutationEpoch(capture.tx) ||
    capture.clockIdentity !== exactScopeWriteClockObservationIdentity(capture.tx, capture.scopeId))
    return yield* Effect.fail(error(corruption("reverse membership capture is closed")));
  const rows = capture.groups[ordinal];
  if (rows === undefined || rows.length === 0 || rows.length > 3)
    return yield* Effect.fail(error(corruption("reverse membership ordinal bound differs")));
  const entries: AppIndexRangeEntryV1[] = [];
  for (const row of rows) {
    if (row.present === null) {
      if (rows.length !== 1) return yield* Effect.fail(error(corruption("reverse membership empty ordinal duplicated")));
    } else {
      // Body decoding and hashing stay lazy, after the consumer reaches this ordinal.
      const entry = yield* decodeRangeRowEffect(capture.decoded, row.raw).pipe(Effect.mapError(error));
      if (entry.rowId !== capture.rowIds[ordinal]) return yield* Effect.fail(error(corruption("reverse membership row differs")));
      entries.push(entry);
    }
  }
  if (entries.length > 2) return yield* Effect.fail(error(corruption("one row has more than two current index entries")));
  return Object.freeze(entries);
}, work => observeExecution("AppIndexEntries.readPublicationRowOrdinal", work, "caller"));

/** Prefetch fixed reverse memberships; only the trusted callback may decode
 * an ordinal, so historical/lowering failures precede later membership bodies. */
export const withCurrentPublicationIndexRowsInTransactionEffect = Effect.fnUntraced(
  function* <Value, Failure, Requirements>(tx: AppIndexEntryTransaction, input: {
    readonly scopeId: ScopeId; readonly publicationIndex: StrongReferenceActivationProjection["reverseIndex"];
    readonly rowIds: readonly OrderedIndexRowIdHexV1[];
  }, error: (cause: ReadAppIndexRangeV1Error) => Failure,
    consume: (read: (ordinal: number) => Effect.Effect<readonly AppIndexRangeEntryV1[], Failure>) => Effect.Effect<Value, Failure, Requirements>,
  ): Effect.fn.Return<Value, Failure, Requirements> {
    if (input.rowIds.length > 32) return yield* Effect.fail(error(new InvalidAppIndexEntryInputError("invalidBatch")));
    const decoded = yield* decodeRangeReadEffect(tx, { scopeId: input.scopeId, publicationIndex: input.publicationIndex,
      bounds: {}, limit: 2 }).pipe(Effect.mapError(error));
    const rowIds = yield* Effect.fromResult(Result.gen(function* () {
      const decodedRows: OrderedIndexRowIdHexV1[] = [];
      for (const rowId of input.rowIds) decodedRows.push(yield* decodeOrderedRowIdResult(rowId).pipe(
        Result.mapError(cause => new InvalidAppIndexEntryInputError("invalidRowId", cause))));
      return decodedRows;
    }).pipe(Result.mapError(error)));
    if (new Set(rowIds).size !== rowIds.length) return yield* Effect.fail(error(new InvalidAppIndexEntryInputError("invalidBatch")));
    const values = sql.join(rowIds.map((rowId, ordinal) => sql`(${ordinal}::integer, ${orderedIndexRowIdHexV1ToBytes(rowId)}::bytea)`), sql`, `);
    const result = rowIds.length === 0 ? [] : yield* Effect.uninterruptible(runDrizzleStatementEffect(tx.execute(sql`
      with requested(ordinal, row_id) as (values ${values})
      select requested.ordinal as "ordinal", member.* from requested left join lateral (
        select true as "present", revision.table_id::text as "tableIdText", revision.key_codec_version::text as "keyCodecVersionText",
          revision.physical_spec_sha256 as "physicalSpecSha256", revision.encoded_key as "encodedKeyBytes",
          revision.key_sha256 as "keySha256", revision.row_id as "rowIdBytes", revision.commit_seq::text as "commitSeqText",
          revision.is_tombstone as "isTombstone"
        from fx_app_index_entry_current as current_entry join fx_app_index_entry_rev as revision
          on revision.scope_uuid = current_entry.scope_uuid and revision.index_definition_id = current_entry.index_definition_id
          and revision.encoded_key = current_entry.encoded_key and revision.row_id = current_entry.row_id
          and revision.commit_seq = current_entry.commit_seq
        where current_entry.scope_uuid = ${decoded.scopeUuid} and current_entry.index_definition_id = ${decoded.indexDefinitionId}
          and current_entry.row_id = requested.row_id order by current_entry.encoded_key limit 3
      ) as member on true order by requested.ordinal, member."encodedKeyBytes"
    `), cause => new AppIndexEntryReadPersistenceError("scanCurrent", cause))).pipe(Effect.mapError(error));
    const rawRows = yield* Effect.fromResult(captureDriverRowsResult(result)).pipe(Effect.mapError(error));
    const groups: CapturedPublicationMembershipRow[][] = rowIds.map(() => []);
    for (const raw of rawRows) {
      const envelope = yield* decodePageBatchEnvelopeEffect(raw).pipe(Effect.mapError(cause =>
        error(corruption("reverse membership envelope invalid", cause))));
      const group = groups[envelope.ordinal];
      if (group === undefined) return yield* Effect.fail(error(corruption("reverse membership has an unrequested ordinal")));
      group.push({ raw, present: envelope.present });
    }
    const capture: CapturedPublicationMemberships = { active: true, tx, scopeId: input.scopeId,
      epoch: indexMutationEpoch(tx), clockIdentity: exactScopeWriteClockObservationIdentity(tx, input.scopeId),
      decoded, rowIds, groups };
    const read = (ordinal: number) => readCapturedPublicationRowOrdinal(capture, ordinal, error);
    return yield* Effect.suspend(() => consume(read)).pipe(Effect.ensuring(Effect.sync(() => { capture.active = false; })));
  }, work => observeExecution("AppIndexEntries.withPublicationRowMemberships", work, "caller"));

type ReadCurrentAppIndexEntriesForRowV1Input = {
  readonly scopeId: ScopeId;
  readonly rowId: OrderedIndexRowIdHexV1;
} & ({ readonly definition: LocatedAppIndexDefinitionV1 } |
  { readonly publicationIndex: StrongReferenceActivationProjection["reverseIndex"] });

const readCurrentRowRange = defineNativeMetadataRead(db => db.execute(sql`
    select
      revision.table_id::text as "tableIdText",
      revision.key_codec_version::text as "keyCodecVersionText",
      revision.physical_spec_sha256 as "physicalSpecSha256",
      revision.encoded_key as "encodedKeyBytes",
      revision.key_sha256 as "keySha256",
      revision.row_id as "rowIdBytes",
      revision.commit_seq::text as "commitSeqText",
      revision.is_tombstone as "isTombstone"
    from fx_app_index_entry_current as current_entry
    join fx_app_index_entry_rev as revision
      on revision.scope_uuid = current_entry.scope_uuid
      and revision.index_definition_id = current_entry.index_definition_id
      and revision.encoded_key = current_entry.encoded_key
      and revision.row_id = current_entry.row_id
      and revision.commit_seq = current_entry.commit_seq
    where current_entry.scope_uuid = ${sql.placeholder("scopeUuid")}
      and current_entry.index_definition_id = ${sql.placeholder("indexDefinitionId")}
      and current_entry.row_id = ${sql.placeholder("rowId")}
    order by current_entry.encoded_key asc
    limit 3
  `), "raw");

/** Package-internal bounded C08 validation read for one authoritative row. */
export const readCurrentAppIndexEntriesForRowInTransactionEffect = Effect.fnUntraced(function* (
  tx: AppIndexEntryTransaction,
  input: ReadCurrentAppIndexEntriesForRowV1Input,
): Effect.fn.Return<
  ReadonlyArray<AppIndexRangeEntryV1>,
  ReadAppIndexRangeV1Error
> {
  const decoded = yield* decodeRangeReadEffect(tx, { ...input, bounds: {}, limit: 2 });
  const rowId = yield* Effect.fromResult(
    decodeOrderedRowIdResult(input.rowId),
  ).pipe(
    Effect.mapError(() => new InvalidAppIndexEntryInputError("invalidRowId")),
  );
  const rowIdBytes = orderedIndexRowIdHexV1ToBytes(rowId);
  const statement = readCurrentRowRange(tx, { scopeUuid: decoded.scopeUuid, indexDefinitionId: decoded.indexDefinitionId, rowId: rowIdBytes });
  const page = yield* executeAndDecodeRangeEffect(
    tx,
    decoded,
    statement,
    "scanCurrent",
  );
  if (!page.isDone) {
    return yield* Effect.fail(
      new AppIndexEntryStorageCorruptionError(
        "one row has more than two current index entries",
      ),
    );
  }
  return page.entries;
}, work => observeExecution("AppIndexEntries.readCurrentForRowInTransaction", work));

function captureAppendInputResult(
  input: AppendAppIndexEntryRevisionV1Input | AppendPublicationIndexEntryRevisionInput,
): Result.Result<
  DecodedAppendAppIndexEntryCapture,
  InvalidAppIndexEntryInputError
> {
  return Result.gen(function* () {
    if (input.kind !== "live" && input.kind !== "tombstone") {
      return yield* Result.fail(
        new InvalidAppIndexEntryInputError("invalidKind"),
      );
    }
    const scopeId = yield* decodeWriteFieldResult(
      decodeScopeIdResult(input.scopeId),
      "invalidScopeId",
    );
    if ("definition" in input &&
      (!isLocatedAppIndexDefinitionV1(input.definition) || input.definition.scopeId !== scopeId))
      return yield* Result.fail(new InvalidAppIndexEntryInputError("invalidLocatedDefinition"));
    const indexDefinitionId = "reference" in input
      ? input.reference.reverseIndex.indexDefinitionId : input.definition.indexDefinitionId;
    const tableId = "reference" in input ? input.reference.sourceTableId : input.definition.access.tableId;
    const physicalSpec = "reference" in input ? input.reference.reverseIndex.physicalSpec : input.definition.physicalSpec;
    const encodedKey = yield* decodeWriteFieldResult(
      decodeOrderedKeyResult(input.encodedKey),
      "invalidEncodedKey",
    );
    if (encodedKey.length === 0) {
      return yield* Result.fail(
        new InvalidAppIndexEntryInputError("invalidEncodedKey"),
      );
    }
    yield* Result.try({
      try: () => decodeAppOrderedIndexKeyV1({ spec: physicalSpec, encodedKey }),
      catch: (cause) =>
        new InvalidAppIndexEntryInputError("invalidEncodedKey", cause),
    });
    const rowId = yield* decodeWriteFieldResult(
      decodeOrderedRowIdResult(input.rowId),
      "invalidRowId",
    );
    const writeEpoch = yield* decodeWriteFieldResult(
      decodeScopeEpochResult(input.writeEpoch),
      "invalidWriteEpoch",
    );
    const commitSeq = yield* decodeWriteFieldResult(
      decodeCommitSeqResult(input.commitSeq),
      "invalidCommitSeq",
    );
    if (commitSeq < 1n) {
      return yield* Result.fail(
        new InvalidAppIndexEntryInputError("invalidCommitSeq"),
      );
    }
    const scopeProjection = yield* projectScopeIdUuidV1Result(scopeId).pipe(
      Result.mapError(
        (cause) => new InvalidAppIndexEntryInputError("invalidScopeId", cause),
      ),
    );
    const epochProjection = yield* projectScopeEpochUuidV1Result(
      writeEpoch,
    ).pipe(
      Result.mapError(
        (cause) =>
          new InvalidAppIndexEntryInputError("invalidWriteEpoch", cause),
      ),
    );
    return Object.freeze({
      kind: input.kind,
      physicalSpec,
      ...( "reference" in input ? { expectedPhysicalSpecSha256Hex: input.reference.reverseIndex.physicalSpecSha256Hex } : {}),
      identity: Object.freeze({
        scopeId,
        indexDefinitionId,
        tableId,
        encodedKey,
        rowId,
      }),
      scopeProjection,
      writeEpochUuid: epochProjection.epochUuid,
      commitSeq,
      keyBytes: orderedIndexKeyBytesHexV1ToBytes(encodedKey),
    });
  });
}

interface DecodedAppendAppIndexEntryCapture {
  readonly kind: "live" | "tombstone";
  readonly identity: AppIndexEntryIdentityV1;
  readonly scopeProjection: ScopeIdUuidProjectionV1;
  readonly writeEpochUuid: ScopeEpochUuidV1;
  readonly commitSeq: CommitSeq;
  readonly physicalSpec: AppOrderedIndexPhysicalSpecV1;
  readonly expectedPhysicalSpecSha256Hex?: string;
  readonly keyBytes: Uint8Array;
}

const decodeBackfilledAppendInputEffect = Effect.fn(
  "AppIndexEntries.decodeBackfilledAppendInput",
)(function* (
  tx: AppIndexEntryTransaction,
  input: AppendBackfilledAppIndexEntryRevisionV1Input,
): Effect.fn.Return<
  DecodedAppendAppIndexEntryRevisionV1,
  | InvalidAppIndexEntryInputError
  | AppIndexEntryScopeAuthorityUnavailableError
  | AppIndexEntryHashError
  | AppIndexEntryReadPersistenceError
> {
  const captured = Result.gen(function* () {
    if (input.kind !== "live" && input.kind !== "tombstone") {
      return yield* Result.fail(
        new InvalidAppIndexEntryInputError("invalidKind"),
      );
    }
    const scopeId = yield* decodeWriteFieldResult(
      decodeScopeIdResult(input.scopeId),
      "invalidScopeId",
    );
    const scopeUuid = yield* decodeWriteFieldResult(
      decodeScopeUuidResult(input.scopeUuid),
      "invalidScopeId",
    );
    const expectedScope = yield* projectScopeIdUuidV1Result(scopeId).pipe(
      Result.mapError(
        (cause) => new InvalidAppIndexEntryInputError("invalidScopeId", cause),
      ),
    );
    if (scopeUuid !== expectedScope.scopeUuid) {
      return yield* Result.fail(
        new InvalidAppIndexEntryInputError("invalidScopeId"),
      );
    }
    if (
      !isLocatedAppIndexDefinitionV1(input.definition) ||
      input.definition.scopeId !== scopeId
    ) {
      return yield* Result.fail(
        new InvalidAppIndexEntryInputError("invalidLocatedDefinition"),
      );
    }
    const encodedKey = yield* decodeWriteFieldResult(
      decodeOrderedKeyResult(input.encodedKey),
      "invalidEncodedKey",
    );
    if (encodedKey.length === 0) {
      return yield* Result.fail(
        new InvalidAppIndexEntryInputError("invalidEncodedKey"),
      );
    }
    yield* Result.try({
      try: () =>
        decodeAppOrderedIndexKeyV1({
          spec: input.definition.physicalSpec,
          encodedKey,
        }),
      catch: (cause) =>
        new InvalidAppIndexEntryInputError("invalidEncodedKey", cause),
    });
    const rowId = yield* decodeWriteFieldResult(
      decodeOrderedRowIdResult(input.rowId),
      "invalidRowId",
    );
    const commitSeq = yield* decodeWriteFieldResult(
      decodeCommitSeqResult(input.commitSeq),
      "invalidCommitSeq",
    );
    if (commitSeq < 1n) {
      return yield* Result.fail(
        new InvalidAppIndexEntryInputError("invalidCommitSeq"),
      );
    }
    return Object.freeze({
      kind: input.kind,
      identity: Object.freeze({
        scopeId,
        indexDefinitionId: input.definition.indexDefinitionId,
        tableId: input.definition.access.tableId,
        encodedKey,
        rowId,
      }),
      scopeUuid,
      commitSeq,
      physicalSpec: input.definition.physicalSpec,
      keyBytes: orderedIndexKeyBytesHexV1ToBytes(encodedKey),
    });
  });
  const value = yield* Effect.fromResult(captured);
  yield* requireScopeUuidEffect(tx, value.identity.scopeId, {
    scopeUuid: value.scopeUuid,
  });
  const canonicalPhysicalSpec = yield* Effect.tryPromise({
    try: () => canonicalizeAppIndexPhysicalSpecV1(value.physicalSpec),
    catch: (cause) => new AppIndexEntryHashError("append", cause),
  });
  const keySha256 = yield* sha256Effect(value.keyBytes, "append");
  return Object.freeze({
    historical: true,
    kind: value.kind,
    identity: value.identity,
    scopeUuid: value.scopeUuid,
    commitSeq: value.commitSeq,
    physicalSpec: value.physicalSpec,
    physicalSpecSha256: appIndexPhysicalSpecSha256HexV1ToBytes(
      canonicalPhysicalSpec.sha256Hex,
    ),
    keyBytes: value.keyBytes,
    keySha256,
  });
});

function captureIndexReadDefinitionResult(
  inputScopeId: ScopeId,
  definition: LocatedAppIndexDefinitionV1,
) {
  return Result.gen(function* () {
    const scopeId = yield* decodeReadFieldResult(
      decodeScopeIdResult(inputScopeId),
      "invalidScopeId",
    );
    const scopeProjection = yield* projectScopeIdUuidV1Result(scopeId).pipe(
      Result.mapError(
        (cause) => new InvalidAppIndexEntryInputError("invalidScopeId", cause),
      ),
    );
    if (
      !isLocatedAppIndexDefinitionV1(definition) ||
      definition.scopeId !== scopeId
    ) {
      return yield* Result.fail(
        new InvalidAppIndexEntryInputError("invalidLocatedDefinition"),
      );
    }
    return Object.freeze({
      scopeId,
      scopeProjection,
      indexDefinitionId: definition.indexDefinitionId,
      physicalSpec: definition.physicalSpec,
      specification: Object.freeze({ kind: "catalog" as const, sha256Hex: definition.physicalSpecSha256Hex }),
    });
  });
}

// The named public range operation owns tracing. These private preparation
// steps retain their Effects without allocating another caller stack/span.
const prepareIndexReadDefinitionEffect = Effect.fnUntraced(function* (
  captured: CapturedIndexReadDefinition,
): Effect.fn.Return<PreparedIndexReadDefinition, AppIndexEntryHashError> {
  // Located catalog definitions already authenticate their detached, deeply
  // frozen specification against canonical bytes and its digest. Publication
  // selectors are raw inputs and retain their complete canonical proof.
  const physicalSpecSha256Hex = captured.specification.kind === "catalog"
    ? captured.specification.sha256Hex
    : (yield* Effect.tryPromise({
      try: () => canonicalizeAppIndexPhysicalSpecV1(captured.physicalSpec),
      catch: (cause) => new AppIndexEntryHashError("read", cause),
    })).sha256Hex;
  return Object.freeze({
    scopeId: captured.scopeId,
    scopeProjection: captured.scopeProjection,
    indexDefinitionId: captured.indexDefinitionId,
    physicalSpec: captured.physicalSpec,
    physicalSpecSha256: appIndexPhysicalSpecSha256HexV1ToBytes(
      physicalSpecSha256Hex,
    ),
  });
});

const decodeRangeReadEffect = Effect.fnUntraced(
  function* (
    tx: AppIndexEntryTransaction,
    input: AppIndexRangeReadV1Base | PublicationIndexRangeInput,
    observedScope?: Readonly<{ scopeId: ScopeId; scopeUuid: ScopeUuidV1 }>,
  ): Effect.fn.Return<DecodedAppIndexRangeReadV1, ReadAppIndexRangeV1Error> {
    const captured = yield* Effect.fromResult(
      decodeRangeReadInputResult<CapturedIndexReadDefinition>(input, () => "publicationIndex" in input
        ? Result.gen(function* () {
          const scopeId = yield* decodeReadFieldResult(decodeScopeIdResult(input.scopeId), "invalidScopeId");
          const scopeProjection = yield* projectScopeIdUuidV1Result(scopeId).pipe(Result.mapError(cause =>
            new InvalidAppIndexEntryInputError("invalidScopeId", cause)));
          const indexDefinitionId = yield* decodeReadFieldResult(
            decodeIndexDefinitionIdResult(input.publicationIndex.indexDefinitionId), "invalidLocatedDefinition");
          return Object.freeze({ scopeId, scopeProjection, indexDefinitionId,
            physicalSpec: input.publicationIndex.physicalSpec,
            specification: Object.freeze({ kind: "publication" as const }) });
        })
        : captureIndexReadDefinitionResult(input.scopeId, input.definition)),
    );
    const definition = yield* prepareIndexReadDefinitionEffect(captured);
    if ("publicationIndex" in input) {
      const digest = yield* Effect.fromResult(decodePhysicalSpecDigestResult(
        input.publicationIndex.physicalSpecSha256Hex).pipe(Result.mapError(cause =>
          new AppIndexEntryStorageCorruptionError("invalid activation index digest", { cause }))));
      if (!bytesEqualFullScan(definition.physicalSpecSha256, appIndexPhysicalSpecSha256HexV1ToBytes(digest)))
        return yield* Effect.fail(new AppIndexEntryStorageCorruptionError("activation index digest mismatch"));
    }
    const scopeUuid = observedScope?.scopeId === captured.scopeId && observedScope.scopeUuid === captured.scopeProjection.scopeUuid
      ? observedScope.scopeUuid : yield* requireScopeUuidEffect(tx, captured.scopeId, captured.scopeProjection);
    return Object.freeze({
      scopeId: captured.scopeId,
      scopeUuid,
      indexDefinitionId: captured.indexDefinitionId,
      physicalSpec: captured.physicalSpec,
      physicalSpecSha256: definition.physicalSpecSha256,
      bounds: captured.bounds,
      ...(captured.after === undefined ? {} : { after: captured.after }),
      limit: captured.limit,
    });
  },
);

function decodeRangeReadInputResult<Definition extends CapturedIndexReadDefinition>(
  input: Pick<AppIndexRangeReadV1Base, "scopeId" | "bounds" | "after" | "limit">,
  captureDefinition: () => Result.Result<Definition, InvalidAppIndexEntryInputError>,
): Result.Result<
  Omit<CapturedIndexReadDefinition, "specification"> & { readonly specification: Definition["specification"] } &
    Pick<DecodedAppIndexRangeReadV1, "bounds" | "after" | "limit">,
  InvalidAppIndexEntryInputError
> {
  return Result.gen(function* () {
    if (!isNonArrayRecord(input.bounds)) {
      return yield* Result.fail(
        new InvalidAppIndexEntryInputError("invalidBounds"),
      );
    }
    const boundKeys = Object.keys(input.bounds);
    if (
      boundKeys.some(
        (key) => key !== "startInclusive" && key !== "endExclusive",
      )
    ) {
      return yield* Result.fail(
        new InvalidAppIndexEntryInputError("invalidBounds"),
      );
    }
    const definition = yield* captureDefinition();
    const startInclusive =
      input.bounds.startInclusive === undefined
        ? undefined
        : yield* decodeReadFieldResult(
            decodeOrderedBoundResult(input.bounds.startInclusive),
            "invalidBounds",
          );
    const endExclusive =
      input.bounds.endExclusive === undefined
        ? undefined
        : yield* decodeReadFieldResult(
            decodeOrderedBoundResult(input.bounds.endExclusive),
            "invalidBounds",
          );
    const startBytes =
      startInclusive === undefined
        ? undefined
        : orderedIndexBoundHexV1ToBytes(startInclusive);
    const endBytes =
      endExclusive === undefined
        ? undefined
        : orderedIndexBoundHexV1ToBytes(endExclusive);
    if (
      startBytes !== undefined &&
      endBytes !== undefined &&
      compareBytes(startBytes, endBytes) > 0
    ) {
      return yield* Result.fail(
        new InvalidAppIndexEntryInputError("invalidBounds"),
      );
    }
    if (input.after !== undefined && !isNonArrayRecord(input.after)) {
      return yield* Result.fail(
        new InvalidAppIndexEntryInputError("invalidCursor"),
      );
    }
    const after =
      input.after === undefined
        ? undefined
        : yield* decodeCursorResult(input.after, definition.physicalSpec);
    if (
      after !== undefined &&
      ((startBytes !== undefined &&
        compareBytes(after.keyBytes, startBytes) < 0) ||
        (endBytes !== undefined && compareBytes(after.keyBytes, endBytes) >= 0))
    ) {
      return yield* Result.fail(
        new InvalidAppIndexEntryInputError("invalidCursor"),
      );
    }
    if (
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > MAX_APP_INDEX_RANGE_PAGE_SIZE_V1
    ) {
      return yield* Result.fail(
        new InvalidAppIndexEntryInputError("invalidLimit"),
      );
    }
    return Object.freeze({
      scopeId: definition.scopeId,
      scopeProjection: definition.scopeProjection,
      indexDefinitionId: definition.indexDefinitionId,
      physicalSpec: definition.physicalSpec,
      specification: definition.specification,
      bounds: Object.freeze({
        ...(startBytes === undefined ? {} : { startInclusive: startBytes }),
        ...(endBytes === undefined ? {} : { endExclusive: endBytes }),
      }),
      ...(after === undefined ? {} : { after }),
      limit: input.limit,
    });
  });
}

function decodeCursorResult(
  cursor: AppIndexRangeCursorV1,
  physicalSpec: AppOrderedIndexPhysicalSpecV1,
): Result.Result<
  NonNullable<DecodedAppIndexRangeReadV1["after"]>,
  InvalidAppIndexEntryInputError
> {
  return Result.gen(function* () {
    const encodedKey = yield* decodeReadFieldResult(
      decodeOrderedKeyResult(cursor.encodedKey),
      "invalidCursor",
    );
    if (encodedKey.length === 0) {
      return yield* Result.fail(
        new InvalidAppIndexEntryInputError("invalidCursor"),
      );
    }
    yield* Result.try({
      try: () => decodeAppOrderedIndexKeyV1({ spec: physicalSpec, encodedKey }),
      catch: (cause) =>
        new InvalidAppIndexEntryInputError("invalidCursor", cause),
    });
    const rowId = yield* decodeReadFieldResult(
      decodeOrderedRowIdResult(cursor.rowId),
      "invalidCursor",
    );
    return Object.freeze({
      encodedKey,
      keyBytes: orderedIndexKeyBytesHexV1ToBytes(encodedKey),
      rowId,
      rowIdBytes: orderedIndexRowIdHexV1ToBytes(rowId),
    });
  });
}

export interface PreparedAppIndexSnapshotRead extends DecodedAppIndexRangeReadV1 { readonly snapshotCommitSeq: CommitSeq; }

/** Input compilation is detached; it never grants database authority. */
export const prepareAppIndexSnapshotReadResult = (
  input: ScanAppIndexAtSnapshotV1Input,
): Result.Result<PreparedAppIndexSnapshotRead, InvalidAppIndexEntryInputError> => Result.gen(function* () {
  const snapshotCommitSeq = yield* decodeReadFieldResult(decodeCommitSeqResult(input.snapshotCommitSeq), "invalidSnapshotCommitSeq");
  const captured = yield* decodeRangeReadInputResult(input,
    () => captureIndexReadDefinitionResult(input.scopeId, input.definition));
  // This input accepts only genuine catalog definitions. Their original issuer
  // established the canonical specification and digest; raw publication inputs
  // elsewhere still require prepareIndexReadDefinitionEffect's real SHA.
  return Object.freeze({ scopeId: captured.scopeId, scopeUuid: captured.scopeProjection.scopeUuid,
    indexDefinitionId: captured.indexDefinitionId, physicalSpec: captured.physicalSpec,
    physicalSpecSha256: appIndexPhysicalSpecSha256HexV1ToBytes(captured.specification.sha256Hex), bounds: captured.bounds,
    ...(captured.after === undefined ? {} : { after: captured.after }), limit: captured.limit, snapshotCommitSeq });
});

export interface AppIndexSnapshotReadExpressions {
  readonly scopeUuid: SQL; readonly indexDefinitionId: SQL; readonly snapshotCommitSeq: SQL;
  readonly start: SQL; readonly end: SQL; readonly afterKey: SQL; readonly afterRow: SQL; readonly limit: SQL;
}

/** Trusted located-target compilation only, with fixed storage function/projection. */
export function buildPreparedAppIndexSnapshotReadStatement(schemaName: string | undefined, parameters: AppIndexSnapshotReadExpressions): SQL {
  const reader = schemaName === undefined ? sql`fx_read_snapshot_index_page` : sql`${sql.identifier(schemaName)}.fx_read_snapshot_index_page`;
  return sql`select r.ordinal, r.table_id_text as "tableIdText", r.key_codec_version_text as "keyCodecVersionText",
    r.physical_spec_sha256 as "physicalSpecSha256", r.encoded_key_bytes as "encodedKeyBytes",
    r.key_sha256 as "keySha256", r.row_id_bytes as "rowIdBytes", r.commit_seq_text as "commitSeqText", r.is_tombstone as "isTombstone"
    from ${reader}(${parameters.scopeUuid}::uuid, ${parameters.indexDefinitionId}::integer,
      ${parameters.snapshotCommitSeq}::bigint, ${parameters.start}::bytea,
      ${parameters.end}::bytea, ${parameters.afterKey}::bytea,
      ${parameters.afterRow}::bytea, ${parameters.limit}::integer) r order by r.ordinal`;
}


export function buildAppIndexSnapshotReadStatement(input: PreparedAppIndexSnapshotRead, schemaName?: string): SQL {
  return buildPreparedAppIndexSnapshotReadStatement(schemaName, { scopeUuid: sql`${input.scopeUuid}`, indexDefinitionId: sql`${input.indexDefinitionId}`,
    snapshotCommitSeq: sql`${input.snapshotCommitSeq}`, start: sql`${input.bounds.startInclusive ?? null}`, end: sql`${input.bounds.endExclusive ?? null}`,
    afterKey: sql`${input.after?.keyBytes ?? null}`, afterRow: sql`${input.after?.rowIdBytes ?? null}`, limit: sql`${input.limit}` });
}

const readSnapshotRange = defineNativeMetadataRead(db => db.execute(buildPreparedAppIndexSnapshotReadStatement(undefined, {
  scopeUuid: sql`${sql.placeholder("scopeUuid")}`, indexDefinitionId: sql`${sql.placeholder("indexDefinitionId")}`,
  snapshotCommitSeq: sql`${sql.placeholder("snapshotCommitSeq")}`, start: sql`${sql.placeholder("start")}`,
  end: sql`${sql.placeholder("end")}`, afterKey: sql`${sql.placeholder("afterKey")}`,
  afterRow: sql`${sql.placeholder("afterRow")}`, limit: sql`${sql.placeholder("limit")}`,
})), "raw");

// There are exactly eight current-range shapes. Only predicate presence is
// retained; every scope/key/cursor/bound and lookahead limit binds per call.
const currentRangeReads = Array.from({ length: 8 }, (_, shape) => defineNativeMetadataRead(db =>
  db.execute(buildPreparedCurrentRangeStatement({
    scopeUuid: sql`${sql.placeholder("scopeUuid")}`, indexDefinitionId: sql`${sql.placeholder("indexDefinitionId")}`,
    bounds: { ...(shape & 1 ? { startInclusive: sql`${sql.placeholder("start")}` } : {}),
      ...(shape & 2 ? { endExclusive: sql`${sql.placeholder("end")}` } : {}) },
    ...(shape & 4 ? { after: { keyBytes: sql`${sql.placeholder("afterKey")}`, rowIdBytes: sql`${sql.placeholder("afterRow")}` } } : {}),
    limit: sql`${sql.placeholder("limit")}`,
  })), "raw"));

const currentRangeCountReads = Array.from({ length: 4 }, (_, shape) => defineNativeMetadataRead(db => {
  const predicates = rangePredicates("current_entry", { bounds: {
    ...(shape & 1 ? { startInclusive: sql`${sql.placeholder("start")}` } : {}),
    ...(shape & 2 ? { endExclusive: sql`${sql.placeholder("end")}` } : {}),
  } });
  predicates.unshift(sql`current_entry.scope_uuid = ${sql.placeholder("scopeUuid")}`,
    sql`current_entry.index_definition_id = ${sql.placeholder("indexDefinitionId")}`);
  return db.execute(sql`select count(*)::text as "countText" from (
    select 1 from fx_app_index_entry_current as current_entry
    where ${sql.join(predicates, sql` and `)} limit ${sql.placeholder("limit")}
  ) as bounded`);
}, "raw"));

function readCurrentRange(tx: AppIndexEntryTransaction, input: DecodedAppIndexRangeReadV1) {
  const shape = (input.bounds.startInclusive === undefined ? 0 : 1) |
    (input.bounds.endExclusive === undefined ? 0 : 2) | (input.after === undefined ? 0 : 4);
  const read = currentRangeReads[shape];
  // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: invariant - the three predicate bits select one of eight code-defined range readers; a missing reader is an internal construction defect.
  if (read === undefined) throw new Error("Current range shape is unavailable");
  return read(tx, { scopeUuid: input.scopeUuid, indexDefinitionId: input.indexDefinitionId,
    start: input.bounds.startInclusive, end: input.bounds.endExclusive, afterKey: input.after?.keyBytes,
    afterRow: input.after?.rowIdBytes, limit: input.limit + 1 });
}

const SnapshotIndexOrdinalSchema = Schema.Struct({ ordinal: Schema.Number });
const decodeSnapshotIndexOrdinalEffect = Schema.decodeUnknownEffect(SnapshotIndexOrdinalSchema);
export const decodeCapturedAppIndexSnapshotPageEffect = Effect.fnUntraced(function* (
  input: PreparedAppIndexSnapshotRead, rows: readonly unknown[],
): Effect.fn.Return<AppIndexRangePageV1, ReadAppIndexRangeV1Error> {
  const decoded: AppIndexRangeEntryV1[] = [];
  for (let ordinal = 0; ordinal < rows.length; ordinal++) {
    const entry = yield* Effect.suspend(() => {
      const row = rows[ordinal];
      return decodeSnapshotIndexOrdinalEffect(row).pipe(Effect.mapError(cause =>
        corruption("snapshot membership ordinal does not decode", cause)), Effect.flatMap(envelope =>
          envelope.ordinal !== ordinal ? Effect.fail(corruption("snapshot membership ordinal differs"))
            : decodeRangeRowEffect(input, row)));
    });
    decoded.push(entry);
  }
  if (decoded.length > input.limit + 1) return yield* Effect.fail(corruption("snapshot membership exceeds page lookahead"));
  return projectRangePage(input.limit, decoded);
}, work => observeExecution("AppIndexEntries.decodeCapturedSnapshotPage", work));

type CurrentRangeExpressions = Readonly<{ scopeUuid: SQL; indexDefinitionId: SQL;
  bounds: Readonly<{ startInclusive?: SQL; endExclusive?: SQL }>;
  after?: Readonly<{ keyBytes: SQL; rowIdBytes: SQL }>; limit: SQL }>;

function buildDemandPointerStatement(shape: number): SQL {
  const input: CurrentRangeExpressions = {
    scopeUuid: sql`d.scope_uuid`, indexDefinitionId: sql`d.definition_id`,
    bounds: {
      ...(shape & 1 ? { startInclusive: sql`decode(d.start_hex, 'hex')` } : {}),
      ...(shape & 2 ? { endExclusive: sql`decode(d.end_hex, 'hex')` } : {}),
    },
    ...(shape & 4 ? { after: { keyBytes: sql`decode(d.after_key_hex, 'hex')`, rowIdBytes: sql`decode(d.after_row_hex, 'hex')` } } : {}),
    limit: sql`d.page_limit`,
  };
  return buildCurrentPointerStatement(input,
    [sql`d.shape = ${sql.raw(String(shape))}`, ...rangePredicates("current_entry", input)]);
}

// One code-defined query for every bounded demand vector. Eight one-time-gated
// shapes keep bounds/cursors as index conditions rather than nullable filters.
// Only predicate presence selects a branch; all values bind freshly per demand.
const readCurrentDemandPages = defineNativeMetadataRead(db => db.execute(sql`
  select (d.ordinal - 1)::integer as "ordinal", member.*
  from rows from (jsonb_to_recordset(${sql.placeholder("demands")}::jsonb) as
    (scope_uuid uuid, definition_id integer, start_hex text, end_hex text,
      after_key_hex text, after_row_hex text, page_limit integer, shape integer)) with ordinality
    as d(scope_uuid, definition_id, start_hex, end_hex, after_key_hex, after_row_hex, page_limit, shape, ordinal)
  left join lateral (
    select true as "present", page.* from (${buildCurrentRevisionStatement(
      sql.join(Array.from({ length: 8 }, (_, shape) => sql`(${buildDemandPointerStatement(shape)})`), sql` union all `),
    )}) as page
  ) as member on true
  order by "ordinal", "encodedKeyBytes", "rowIdBytes"
`), "raw", "fx_index_demands");

function buildPreparedCurrentRangeStatement(input: CurrentRangeExpressions,
  predicates = rangePredicates("current_entry", input)): SQL {
  return buildCurrentRevisionStatement(buildCurrentPointerStatement(input, predicates));
}

function buildCurrentPointerStatement(input: CurrentRangeExpressions,
  predicates = rangePredicates("current_entry", input)): SQL {
  predicates.unshift(
    sql`current_entry.scope_uuid = ${input.scopeUuid}`,
    sql`current_entry.index_definition_id = ${input.indexDefinitionId}`,
  );
  return sql`
    select current_entry.scope_uuid, current_entry.index_definition_id,
        current_entry.encoded_key, current_entry.row_id, current_entry.commit_seq
      from fx_app_index_entry_current as current_entry
      where ${sql.join(predicates, sql` and `)}
      order by current_entry.encoded_key asc, current_entry.row_id asc
      limit ${input.limit}
  `;
}

function buildCurrentRevisionStatement(pointerStatement: SQL): SQL {
  return sql`
    with page as materialized (${pointerStatement})
    select
      current_entry.encoded_key as "currentEncodedKeyBytes",
      current_entry.row_id as "currentRowIdBytes",
      revision.table_id::text as "tableIdText",
      revision.key_codec_version::text as "keyCodecVersionText",
      revision.physical_spec_sha256 as "physicalSpecSha256",
      revision.encoded_key as "encodedKeyBytes",
      revision.key_sha256 as "keySha256",
      revision.row_id as "rowIdBytes",
      revision.commit_seq::text as "commitSeqText",
      revision.is_tombstone as "isTombstone"
    from page as current_entry
    left join lateral (
      with matched_revision as materialized (
        select stored.* from fx_app_index_entry_rev as stored
        where stored.scope_uuid = current_entry.scope_uuid
          and stored.index_definition_id = current_entry.index_definition_id
          and stored.encoded_key = current_entry.encoded_key
          and stored.row_id = current_entry.row_id
          and stored.commit_seq = current_entry.commit_seq
      )
      select matched_revision.* from matched_revision
    ) as revision on true
    order by current_entry.encoded_key asc, current_entry.row_id asc
  `;
}

function rangePredicates(
  owner: "revision" | "current_entry",
  input: Pick<DecodedAppIndexRangeReadV1, "bounds" | "after"> | Pick<CurrentRangeExpressions, "bounds" | "after">,
): SQL[] {
  const key =
    owner === "revision"
      ? sql`revision.encoded_key`
      : sql`current_entry.encoded_key`;
  const rowId =
    owner === "revision" ? sql`revision.row_id` : sql`current_entry.row_id`;
  const predicates: SQL[] = [];
  if (input.bounds.startInclusive !== undefined) {
    predicates.push(sql`${key} >= ${input.bounds.startInclusive}`);
  }
  if (input.bounds.endExclusive !== undefined) {
    predicates.push(sql`${key} < ${input.bounds.endExclusive}`);
  }
  if (input.after !== undefined) {
    predicates.push(
      sql`(${key}, ${rowId}) > (${input.after.keyBytes}, ${input.after.rowIdBytes})`,
    );
  }
  return predicates;
}

/** Classify only the known invalid-wrapper sentinel; getter exceptions remain defects. */
function captureDriverRowsResult(
  value: unknown,
): Result.Result<ReadonlyArray<unknown>, AppIndexEntryStorageCorruptionError> {
  const invalid = corruption("membership driver result has no rows");
  try {
    return Result.succeed(
      rowsFromDriverExecuteResult(value, () => {
        // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: invariant - this exact sentinel is immediately converted to typed corruption; getter defects escape unchanged
        throw invalid;
      }),
    );
  } catch (cause) {
    // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: invariant - exceptions from driver wrapper getters preserve their original defect identity
    if (cause !== invalid) throw cause;
    return Result.fail(invalid);
  }
}

const executeAndDecodeRangeEffect = Effect.fnUntraced(function* (
  tx: AppIndexEntryTransaction,
  input: DecodedAppIndexRangeReadV1,
  statement: SQL | ReturnType<typeof readCurrentRange>,
  operation: AppIndexEntryReadPersistenceError["operation"],
  observer?: Parameters<typeof observeDrizzleRawQuery<"scanCurrent">>[2],
): Effect.fn.Return<AppIndexRangePageV1, ReadAppIndexRangeV1Error> {
  const query = "getQuery" in statement ? statement : tx.execute(statement);
  observeDrizzleRawQuery("scanCurrent", query, observer);
  const driverResult = yield* Effect.uninterruptible(
    Effect.tryPromise({
      try: () => query,
      catch: (cause) => new AppIndexEntryReadPersistenceError(operation, cause),
    }),
  );
  const rows = yield* Effect.fromResult(captureDriverRowsResult(driverResult));
  const decoded: AppIndexRangeEntryV1[] = [];
  for (let ordinal = 0; ordinal < rows.length; ordinal++) {
    decoded.push(yield* Effect.suspend(() => decodeRangeRowEffect(input, rows[ordinal])));
  }
  return projectRangePage(input.limit, decoded);
}, work => observeExecution("AppIndexEntries.executeAndDecodeRange", work));

function projectRangePage(limit: number, decoded: readonly AppIndexRangeEntryV1[]): AppIndexRangePageV1 {
  const isDone = decoded.length <= limit;
  const entries = Object.freeze(decoded.slice(0, limit));
  const last = entries.at(-1);
  const continueCursor = isDone || last === undefined ? null : Object.freeze({ encodedKey: last.encodedKey, rowId: last.rowId });
  return Object.freeze({ entries, isDone, continueCursor });
}

// Per-row decoding is covered by the named SQL/range operation; preserve every
// key/specification/digest check without a separate stack/span for each row.
const decodeRangeRowEffect = Effect.fnUntraced(
  function* (
    input: DecodedAppIndexRangeReadV1,
    value: unknown,
  ): Effect.fn.Return<
    AppIndexRangeEntryV1,
    AppIndexEntryHashError | AppIndexEntryStorageCorruptionError
  > {
    const row = yield* decodeStoredMembershipEffect(value).pipe(
      Effect.mapError(cause => corruption("membership row does not decode", cause)));
    const captured = yield* Effect.fromResult(captureLiveRangeRowResult(input, row));
    return yield* decodeCapturedRangeRowEffect(input, captured);
  },
);

function captureLiveRangeRowResult(input: DecodedAppIndexRangeReadV1, value: typeof StoredMembershipSchema.Type) {
  return captureRangeRowResult(input.physicalSpec, input.physicalSpecSha256, value).pipe(Result.flatMap(captured =>
    captured.isTombstone ? Result.fail(corruption("visible range row is a tombstone")) : Result.succeed(captured)));
}

const decodeCapturedRangeRowEffect = Effect.fnUntraced(
  function* (input: DecodedAppIndexRangeReadV1,
    captured: Result.Result.Success<ReturnType<typeof captureLiveRangeRowResult>>,
  ): Effect.fn.Return<AppIndexRangeEntryV1, AppIndexEntryHashError | AppIndexEntryStorageCorruptionError> {
    const observedSha256 = yield* sha256Effect(captured.keyBytes, "read");
    if (!bytesEqualFullScan(observedSha256, captured.keySha256)) {
      return yield* Effect.fail(
        new AppIndexEntryStorageCorruptionError(
          "key digest does not match key bytes",
        ),
      );
    }
    return Object.freeze({
      scopeId: input.scopeId,
      scopeUuid: input.scopeUuid,
      indexDefinitionId: input.indexDefinitionId,
      tableId: captured.tableId,
      encodedKey: captured.encodedKey,
      rowId: captured.rowId,
      commitSeq: captured.commitSeq,
      keyCodecVersion: ORDERED_INDEX_KEY_CODEC_VERSION_V1,
      keySha256: new Uint8Array(captured.keySha256),
      physicalSpecSha256: new Uint8Array(captured.physicalSpecSha256),
    });
  },
);

const StoredMembershipSchema = Schema.Struct({
  tableIdText: Schema.String,
  keyCodecVersionText: Schema.String,
  physicalSpecSha256: Schema.Uint8Array,
  encodedKeyBytes: Schema.Uint8Array,
  keySha256: Schema.Uint8Array,
  rowIdBytes: Schema.Uint8Array,
  commitSeqText: Schema.String,
  isTombstone: Schema.Boolean,
});
const decodeStoredMembershipEffect = Schema.decodeUnknownEffect(
  StoredMembershipSchema,
);

function captureRangeRowResult(
  physicalSpec: AppOrderedIndexPhysicalSpecV1,
  expectedPhysicalSpecSha256: Uint8Array,
  value: typeof StoredMembershipSchema.Type,
): Result.Result<
  {
    readonly tableId: CatalogTableId;
    readonly encodedKey: OrderedIndexKeyBytesHexV1;
    readonly keyBytes: Uint8Array;
    readonly keySha256: Uint8Array;
    readonly physicalSpecSha256: Uint8Array;
    readonly rowId: AppRowIdHexV1;
    readonly commitSeq: CommitSeq;
    readonly isTombstone: boolean;
  },
  AppIndexEntryStorageCorruptionError
> {
  return Result.gen(function* () {
    const tableIdText = yield* canonicalIntegerResult(value.tableIdText);
    const tableId = yield* decodeStoredResult(decodeTableIdResult(tableIdText));
    const codecVersion = yield* canonicalIntegerResult(
      value.keyCodecVersionText,
    );
    if (codecVersion !== ORDERED_INDEX_KEY_CODEC_VERSION_V1) {
      return yield* Result.fail(corruption("key codec version is invalid"));
    }
    if (
      !isUint8Array(value.physicalSpecSha256) ||
      value.physicalSpecSha256.byteLength !== 32
    ) {
      return yield* Result.fail(corruption("physical-spec digest is invalid"));
    }
    const physicalSpecSha256 = new Uint8Array(value.physicalSpecSha256);
    if (!bytesEqualFullScan(physicalSpecSha256, expectedPhysicalSpecSha256)) {
      return yield* Result.fail(
        corruption(
          "physical-spec digest does not match the located definition",
        ),
      );
    }
    if (!isUint8Array(value.encodedKeyBytes)) {
      return yield* Result.fail(corruption("encoded key bytes are invalid"));
    }
    const keyBytes = new Uint8Array(value.encodedKeyBytes);
    const encodedKey = yield* Result.try({
      try: () => orderedIndexKeyBytesHexV1FromBytes(keyBytes),
      catch: () => corruption("encoded key bytes do not decode"),
    });
    if (encodedKey.length === 0) {
      return yield* Result.fail(corruption("encoded key is empty"));
    }
    yield* Result.try({
      try: () => decodeAppOrderedIndexKeyV1({ spec: physicalSpec, encodedKey }),
      catch: (cause) =>
        corruption(
          "encoded key does not match the physical specification",
          cause,
        ),
    });
    if (!isUint8Array(value.keySha256) || value.keySha256.byteLength !== 32) {
      return yield* Result.fail(corruption("key digest is invalid"));
    }
    const rowId = yield* orderedIndexRowIdHexV1FromBytesResult(
      value.rowIdBytes,
    ).pipe(Result.mapError(() => corruption("row identity is invalid")));
    const commitSeqText = yield* canonicalBigIntResult(value.commitSeqText);
    const commitSeq = yield* decodeStoredResult(
      decodeCommitSeqResult(commitSeqText),
    );
    if (commitSeq < 1n) {
      return yield* Result.fail(corruption("commit sequence is not positive"));
    }

    return Object.freeze({
      tableId,
      encodedKey,
      keyBytes,
      keySha256: new Uint8Array(value.keySha256),
      physicalSpecSha256,
      rowId,
      commitSeq,
      isTombstone: value.isTombstone,
    });
  });
}

const readScopeUuid = defineNativeMetadataRead(db => db.select({ scopeUuid: fxSystemScopeClocks.scopeUuid })
  .from(fxSystemScopeClocks).innerJoin(fxSystemScopeExecutionAuthorities, eq(fxSystemScopeExecutionAuthorities.scopeId, fxSystemScopeClocks.scopeId))
  .where(eq(fxSystemScopeClocks.scopeId, sql.placeholder("scopeId"))).limit(1));

const requireScopeUuidEffect = Effect.fnUntraced(
  function* (
    tx: AppIndexEntryTransaction,
    scopeId: ScopeId,
    projection: { readonly scopeUuid: ScopeUuidV1 },
  ): Effect.fn.Return<
    ScopeUuidV1,
    | AppIndexEntryScopeAuthorityUnavailableError
    | AppIndexEntryReadPersistenceError
  > {
    const observed = readProtectedScopeReadIdentity(tx, scopeId);
    if (observed !== undefined) {
      const live = yield* Effect.fromResult(requireProtectedScopeReadIdentity(tx, observed).pipe(
        Result.mapError(() => new AppIndexEntryScopeAuthorityUnavailableError(scopeId))));
      if (live.scopeUuid !== projection.scopeUuid)
        return yield* Effect.fail(new AppIndexEntryScopeAuthorityUnavailableError(scopeId));
      return live.scopeUuid;
    }
    const finite = readFiniteExecutionAuthorityObservation(tx, scopeId);
    if (finite !== undefined) {
      const live = yield* Effect.fromResult(requireFiniteExecutionAuthorityObservation(tx, finite).pipe(
        Result.mapError(() => new AppIndexEntryScopeAuthorityUnavailableError(scopeId))));
      if (live.scopeId !== scopeId || live.scopeUuid !== projection.scopeUuid)
        return yield* Effect.fail(new AppIndexEntryScopeAuthorityUnavailableError(scopeId));
      return live.scopeUuid;
    }
    const query = readScopeUuid(tx, { scopeId });
    const rows = yield* Effect.uninterruptible(
      Effect.tryPromise({
        try: () => query,
        catch: (cause) =>
          new AppIndexEntryReadPersistenceError("readScopeAuthority", cause),
      }),
    );
    if (rows[0]?.scopeUuid !== projection.scopeUuid) {
      return yield* Effect.fail(
        new AppIndexEntryScopeAuthorityUnavailableError(scopeId),
      );
    }
    return projection.scopeUuid;
  }, work => observeExecution("AppIndexEntries.requireScopeUuid", work),
);

function projectRevision(
  revision: DecodedAppendAppIndexEntryRevisionV1,
): AppIndexEntryRevisionV1 {
  return Object.freeze({
    kind: revision.kind,
    ...revision.identity,
    scopeUuid: revision.scopeUuid,
    commitSeq: revision.commitSeq,
    keyCodecVersion: ORDERED_INDEX_KEY_CODEC_VERSION_V1,
    keySha256: new Uint8Array(revision.keySha256),
    physicalSpecSha256: new Uint8Array(revision.physicalSpecSha256),
  });
}

function decodeWriteFieldResult<Value>(
  result: Result.Result<Value, unknown>,
  issue: InvalidAppIndexEntryInputIssue,
): Result.Result<Value, InvalidAppIndexEntryInputError> {
  return result.pipe(
    Result.mapError(
      (cause) => new InvalidAppIndexEntryInputError(issue, cause),
    ),
  );
}

function decodeReadFieldResult<Value>(
  result: Result.Result<Value, unknown>,
  issue: InvalidAppIndexEntryInputIssue,
): Result.Result<Value, InvalidAppIndexEntryInputError> {
  return decodeWriteFieldResult(result, issue);
}

function decodeStoredResult<Value>(
  result: Result.Result<Value, unknown>,
): Result.Result<Value, AppIndexEntryStorageCorruptionError> {
  return result.pipe(
    Result.mapError((cause) =>
      corruption("stored row column does not decode", cause),
    ),
  );
}

function canonicalIntegerResult(
  value: unknown,
): Result.Result<number, AppIndexEntryStorageCorruptionError> {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    return Result.fail(corruption("stored integer text is not canonical"));
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    return Result.fail(
      corruption("stored integer text exceeds the safe range"),
    );
  }
  return Result.succeed(parsed);
}

function canonicalBigIntResult(
  value: unknown,
): Result.Result<bigint, AppIndexEntryStorageCorruptionError> {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    return Result.fail(corruption("stored bigint text is not canonical"));
  }
  return Result.succeed(BigInt(value));
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const count = Math.min(left.byteLength, right.byteLength);
  for (let index = 0; index < count; index += 1) {
    const leftByte = left[index];
    const rightByte = right[index];
    if (leftByte !== rightByte) return (leftByte ?? 0) - (rightByte ?? 0);
  }
  return left.byteLength - right.byteLength;
}

function corruption(
  reason: string,
  cause?: unknown,
): AppIndexEntryStorageCorruptionError {
  return new AppIndexEntryStorageCorruptionError(
    reason,
    cause === undefined ? undefined : { cause },
  );
}

const sha256Effect = Effect.fnUntraced(function* (
  bytes: Uint8Array,
  operation: AppIndexEntryHashError["operation"],
): Effect.fn.Return<Uint8Array, AppIndexEntryHashError> {
  const owned = new Uint8Array(bytes);
  const digest = yield* Effect.tryPromise({
    try: async () =>
      new Uint8Array(await crypto.subtle.digest("SHA-256", owned.buffer)),
    catch: (cause) => new AppIndexEntryHashError(operation, cause),
  });
  if (digest.byteLength !== 32)
    return yield* Effect.fail(
      new AppIndexEntryHashError(
        operation,
        new Error(`SHA-256 returned ${digest.byteLength} bytes`),
      ),
    );
  return digest;
}, work => observeExecution("AppIndexEntries.sha256", work));
