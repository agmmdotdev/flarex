import { fxSystemScopeExecutionAuthorities } from "./schema";
import { closeExactAttemptScopeClockObservation, readExactScopeWriteClockObservation } from "./scopeClock";
import type { PointCommitPublicationObservation } from "./pointCommitPublicationObservation";
import {
  bytesEqualFullScan,
  isUint8Array,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { and, eq, or, isNull, sql } from "drizzle-orm";
import { Effect, Option, Result, Schema } from "effect";
import { MAX_POINT_COMMIT_MATERIAL_ROWS_V1 } from "flarex-protocol/commit-protocol";
import {
  AppRowIdHexV1Schema,
  appRowIdHexV1FromBytesResult,
  appRowIdHexV1ToBytes,
  type AppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import {
  CatalogTableIdSchema,
  CatalogUniqueConstraintDefinitionIdSchema,
  type CatalogTableId,
} from "flarex-protocol/catalog";
import {
  MAX_ORDERED_INDEX_KEY_BYTES_V1,
  decodeOrderedIndexComponentsV1,
  orderedIndexKeyBytesHexV1FromBytes,
  type OrderedIndexKeyHexV1,
} from "flarex-protocol/ordered-index";
import {
  ScopeEpochSchema,
  CommitSeqSchema,
  ScopeIdSchema,
  ScopeUuidV1Schema,
  projectScopeIdUuidV1Result,
  type CommitSeq,
  type ScopeEpoch,
  type ScopeId,
  type ScopeUuidV1,
} from "flarex-protocol/storage-authority";

import {
  APP_UNIQUE_KEY_CODEC_VERSION_V1,
  MAX_APP_UNIQUE_KEY_COMPONENTS_V1,
  canonicalizeAppUniqueKeyV1Result,
  decodeAppUniqueConstraintIdV1Result,
  type AppUniqueConstraintIdV1,
  type AppUniqueKeyProjectionV1,
  type CanonicalAppUniqueKeyClaimV1,
  type CanonicalAppUniqueKeyV1,
  type InvalidAppUniqueKeyContractV1Error,
} from "./appUniqueKeyContract";
import type { FlarexMetadataTransaction } from "./metadataTransaction";
import { decodeCapturedPublishedCurrentAppRowEffect, projectBoundedCurrentAppRowPoint,
  type AppRowRevisionV1, type CurrentAppRowReadLimits, type ReadAppRowError } from "./appRows";
import { observeDrizzleQuery } from "./drizzleQueryObservation";
import { requireAdmittedTargetInstallationSchema } from "./installationLifecycle";
import { applicationDomainFailureDetail, buildAppUniqueBatchStatement, buildAppUniqueMutationStatement, buildAppUniqueOwnerAcceptanceStatement,
  type AppUniqueAbsentOwner } from "./applicationDocumentMaterialization/domainApplication";
import { rowsFromDriverExecuteResult } from "./driverExecuteResult";
import {
  fxAppRowRevisions,
  fxAppRowCurrent,
  fxAppUniqueKeys,
  fxSystemScopeClocks,
  fxSystemCommitAppRowChanges,
  fxSystemUniqueConstraintBuilds,
} from "./schema";

export type AppUniqueKeyTransaction = FlarexMetadataTransaction;

export interface ApplyAppUniqueKeyMutationV1Input {
  readonly scopeId: ScopeId;
  readonly constraintId: AppUniqueConstraintIdV1;
  readonly tableId: CatalogTableId;
  readonly rowId: AppRowIdHexV1;
  readonly writeEpoch: ScopeEpoch;

  readonly previous: AppUniqueKeyProjectionV1 | null;
  readonly next: AppUniqueKeyProjectionV1 | null;
}

export interface AppUniqueKeyClaimV1 {
  readonly scopeId: ScopeId;
  readonly scopeUuid: ScopeUuidV1;
  readonly constraintId: AppUniqueConstraintIdV1;
  readonly localeKey: string;
  readonly encodedKey: OrderedIndexKeyHexV1;
  readonly canonicalKeySha256: Uint8Array;
  readonly tableId: CatalogTableId;
  readonly rowId: AppRowIdHexV1;
}

export interface ApplyAppUniqueKeyMutationV1Result {
  readonly status: "claimed" | "unchanged" | "released" | "omitted";
  readonly claim: AppUniqueKeyClaimV1 | null;
}

export interface EnsureAppUniqueKeyBackfillClaimV1Input {
  readonly scopeId: ScopeId;
  readonly constraintId: AppUniqueConstraintIdV1;
  readonly tableId: CatalogTableId;
  readonly rowId: AppRowIdHexV1;
  readonly authorityEpoch: ScopeEpoch;

  readonly claim: AppUniqueKeyProjectionV1;
}

export interface EnsureAppUniqueKeyBackfillClaimV1Result {
  readonly status: "claimed" | "replayed";
  readonly claim: AppUniqueKeyClaimV1;
}

export interface ValidateAppUniqueKeyClaimV1Input {
  readonly scopeId: ScopeId;
  readonly constraintId: AppUniqueConstraintIdV1;
  readonly tableId: CatalogTableId;
  readonly rowId: AppRowIdHexV1;
  readonly authorityEpoch: ScopeEpoch;
  readonly expected: AppUniqueKeyProjectionV1 | null;
}

export type ValidateAppUniqueKeyClaimV1Result = Readonly<
  | { readonly status: "matched" }
  | {
      readonly status: "mismatched";
      readonly reason:
        "missingClaim" | "unexpectedClaim" | "claimIdentityMismatch";
    }
>;

export type InvalidAppUniqueKeyMutationV1Issue =
  | "rowCountExceeded"
  | "invalidScopeId"
  | "invalidConstraintId"
  | "invalidTableId"
  | "invalidRowId"
  | "invalidWriteEpoch"
  | "invalidTransition"
  | "invalidPreviousKey"
  | "invalidNextKey"
  | "invalidBatch";

export class InvalidAppUniqueKeyMutationV1Error extends Error {
  readonly _tag = "InvalidAppUniqueKeyMutationV1Error" as const;

  constructor(
    readonly issue: InvalidAppUniqueKeyMutationV1Issue,
    readonly cause?: unknown,
  ) {
    super(`Invalid app unique-key mutation input: ${issue}.`, { cause });
    this.name = "InvalidAppUniqueKeyMutationV1Error";
  }
}

export class AppUniqueKeyScopeAuthorityUnavailableError extends Error {
  readonly _tag = "AppUniqueKeyScopeAuthorityUnavailableError" as const;

  constructor(
    readonly scopeId: ScopeId,
    readonly reason: "missing" | "staleEpoch" | "identityMismatch",
  ) {
    super(`App unique-key scope authority is ${reason}: ${scopeId}.`);
    this.name = "AppUniqueKeyScopeAuthorityUnavailableError";
  }
}

export class AppUniqueKeyParentRowError extends Error {
  readonly _tag = "AppUniqueKeyParentRowError" as const;

  constructor(
    readonly scopeId: ScopeId,
    readonly tableId: CatalogTableId,
    readonly rowId: AppRowIdHexV1,

    readonly reason: "missing" | "tombstonedClaim",
  ) {
    super(
      `App unique-key parent row is ${reason} at ${scopeId}/${tableId}/${rowId}.`,
    );
    this.name = "AppUniqueKeyParentRowError";
  }
}

export class AppUniqueKeyConflictError extends Error {
  readonly _tag = "AppUniqueKeyConflictError" as const;

  constructor(
    readonly constraintId: AppUniqueConstraintIdV1,
    readonly localeKey: string,
    readonly ownerTableId: CatalogTableId,
    readonly ownerRowId: AppRowIdHexV1,
  ) {
    super(
      `App unique key is already owned by ${ownerTableId}/${ownerRowId} ` +
        `for constraint ${constraintId}/${localeKey || "<default>"}.`,
    );
    this.name = "AppUniqueKeyConflictError";
  }
}

export class CanonicalAppUniqueKeyHashCollisionError extends Error {
  readonly _tag = "CanonicalAppUniqueKeyHashCollisionError" as const;

  constructor(
    readonly constraintId: AppUniqueConstraintIdV1,
    readonly localeKey: string,
  ) {
    super(
      `Canonical app unique keys have equal SHA-256 but unequal bytes for ` +
        `${constraintId}/${localeKey || "<default>"}.`,
    );
    this.name = "CanonicalAppUniqueKeyHashCollisionError";
  }
}

export class AppUniqueKeyPreviousClaimMismatchError extends Error {
  readonly _tag = "AppUniqueKeyPreviousClaimMismatchError" as const;

  constructor(
    readonly constraintId: AppUniqueConstraintIdV1,
    readonly rowId: AppRowIdHexV1,
  ) {
    super(
      `Previous app unique-key ownership does not match ${constraintId}/${rowId}.`,
    );
    this.name = "AppUniqueKeyPreviousClaimMismatchError";
  }
}

export class AppUniqueKeyBackfillClaimMismatchError extends Error {
  readonly _tag = "AppUniqueKeyBackfillClaimMismatchError" as const;

  constructor(
    readonly constraintId: AppUniqueConstraintIdV1,
    readonly rowId: AppRowIdHexV1,
  ) {
    super(
      `Backfilled app unique-key ownership does not match ${constraintId}/${rowId}.`,
    );
    this.name = "AppUniqueKeyBackfillClaimMismatchError";
  }
}

export class AppUniqueKeyHashError extends Error {
  readonly _tag = "AppUniqueKeyHashError" as const;

  constructor(readonly cause: unknown) {
    super("App unique-key SHA-256 failed.", { cause });
    this.name = "AppUniqueKeyHashError";
  }
}

export class AppUniqueKeyStorageCorruptionError extends Error {
  readonly _tag = "AppUniqueKeyStorageCorruptionError" as const;

  constructor(
    readonly reason: string,
    options?: ErrorOptions,
  ) {
    super(`App unique-key storage is invalid: ${reason}.`, options);
    this.name = "AppUniqueKeyStorageCorruptionError";
  }
}

export class AppUniqueKeyPersistenceError extends Error {
  readonly _tag = "AppUniqueKeyPersistenceError" as const;

  constructor(readonly cause: unknown) {
    super("App unique-key persistence operation failed.", { cause });
    this.name = "AppUniqueKeyPersistenceError";
  }
}

export type ApplyAppUniqueKeyMutationV1Error =
  | InvalidAppUniqueKeyMutationV1Error
  | AppUniqueKeyScopeAuthorityUnavailableError
  | AppUniqueKeyParentRowError
  | AppUniqueKeyConflictError
  | CanonicalAppUniqueKeyHashCollisionError
  | AppUniqueKeyPreviousClaimMismatchError
  | AppUniqueKeyHashError
  | AppUniqueKeyStorageCorruptionError
  | AppUniqueKeyPersistenceError;

export type EnsureAppUniqueKeyBackfillClaimV1Error =
  | InvalidAppUniqueKeyMutationV1Error
  | AppUniqueKeyScopeAuthorityUnavailableError
  | AppUniqueKeyParentRowError
  | AppUniqueKeyConflictError
  | CanonicalAppUniqueKeyHashCollisionError
  | AppUniqueKeyBackfillClaimMismatchError
  | AppUniqueKeyHashError
  | AppUniqueKeyStorageCorruptionError
  | AppUniqueKeyPersistenceError;

export type ValidateAppUniqueKeyClaimV1Error =
  | InvalidAppUniqueKeyMutationV1Error
  | AppUniqueKeyScopeAuthorityUnavailableError
  | AppUniqueKeyHashError
  | AppUniqueKeyStorageCorruptionError
  | AppUniqueKeyPersistenceError;

export type AppUniqueKeySha256V1 = (bytes: Uint8Array) => Promise<Uint8Array>;

interface DecodedMutationV1 {
  readonly localeKey: string;
  readonly scopeId: ScopeId;
  readonly scopeUuid: ScopeUuidV1;
  readonly constraintId: AppUniqueConstraintIdV1;
  readonly tableId: CatalogTableId;
  readonly rowId: AppRowIdHexV1;
  readonly rowIdBytes: Uint8Array;
  readonly writeEpoch: ScopeEpoch;

  readonly previous: HashedClaimV1 | null;
  readonly next: HashedClaimV1 | null;
}

interface CapturedMutationV1 {
  readonly localeKey: string;
  readonly scopeId: ScopeId;
  readonly expectedScopeUuid: ScopeUuidV1;
  readonly constraintId: AppUniqueConstraintIdV1;
  readonly tableId: CatalogTableId;
  readonly rowId: AppRowIdHexV1;
  readonly rowIdBytes: Uint8Array;
  readonly writeEpoch: ScopeEpoch;

  readonly previous: CanonicalAppUniqueKeyClaimV1 | null;
  readonly next: CanonicalAppUniqueKeyClaimV1 | null;
}

interface HashedClaimV1 extends CanonicalAppUniqueKeyClaimV1 {
  readonly canonicalKeySha256: Uint8Array;
}

interface DecodedValidationInputV1 {
  readonly scopeId: ScopeId;
  readonly expectedScopeUuid: ScopeUuidV1;
  readonly constraintId: AppUniqueConstraintIdV1;
  readonly tableId: CatalogTableId;
  readonly rowId: AppRowIdHexV1;
  readonly rowIdBytes: Uint8Array;
  readonly authorityEpoch: ScopeEpoch;
  readonly expected: CanonicalAppUniqueKeyClaimV1 | null;
}

const StoredClaimSchema = Schema.Struct({
  scopeUuid: ScopeUuidV1Schema,
  constraintId: CatalogUniqueConstraintDefinitionIdSchema,
  localeKey: Schema.String,
  keyCodecVersion: Schema.Literal(APP_UNIQUE_KEY_CODEC_VERSION_V1),
  encodedKey: Schema.Uint8Array.check(
    Schema.makeFilter(
      (value) =>
        value.byteLength >= 1 &&
        value.byteLength <= MAX_ORDERED_INDEX_KEY_BYTES_V1,
    ),
  ),
  canonicalKeySha256: Schema.Uint8Array.check(
    Schema.makeFilter((value) => value.byteLength === 32),
  ),
  tableId: CatalogTableIdSchema,
  rowId: Schema.Uint8Array.check(
    Schema.makeFilter((value) => value.byteLength === 16),
  ),
});
const decodeStoredClaimRowResult =
  Schema.decodeUnknownResult(StoredClaimSchema);
const decodeSlotCorrelationEnvelope = Schema.decodeUnknownResult(Schema.Struct({ claim: Schema.Struct({
  scopeUuid: StoredClaimSchema.fields.scopeUuid,
  constraintId: StoredClaimSchema.fields.constraintId,
  localeKey: StoredClaimSchema.fields.localeKey,
  canonicalKeySha256: StoredClaimSchema.fields.canonicalKeySha256,
}) }));
const OwnerPositionsSchema = Schema.Array(
  Schema.Struct({
    constraintId: CatalogUniqueConstraintDefinitionIdSchema,
    tableId: CatalogTableIdSchema,
    rowId: AppRowIdHexV1Schema,
    componentCount: Schema.Number.check(
      Schema.makeFilter(
        (value) =>
          Number.isInteger(value) &&
          value >= 1 &&
          value <= MAX_APP_UNIQUE_KEY_COMPONENTS_V1 + 1,
      ),
    ),
  }),
).check(Schema.makeFilter((value) => value.length <= MAX_POINT_COMMIT_MATERIAL_ROWS_V1));
const decodeOwnerPositionsResult =
  Schema.decodeUnknownResult(OwnerPositionsSchema);

type StoredClaimRow = typeof fxAppUniqueKeys.$inferSelect;

const MATCHED_VALIDATION = Object.freeze({ status: "matched" as const });
const MAX_APP_UNIQUE_WRITE_MUTATIONS = 512;

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
const decodeRowIdResult = Schema.decodeUnknownResult(
  Schema.toType(AppRowIdHexV1Schema),
);

/** Transaction-only set application. Failures must escape to the settlement owner. */
export const prepareAppUniqueMutationApplicationEffect = Effect.fn(
  "AppUniqueKeys.prepareMutationApplication",
)(function* (
  tx: AppUniqueKeyTransaction,
  inputs: readonly ApplyAppUniqueKeyMutationV1Input[],
  sha256: AppUniqueKeySha256V1 = liveSha256,
) {
  if (inputs.length > MAX_APP_UNIQUE_WRITE_MUTATIONS) return yield* Effect.fail(invalid("rowCountExceeded"));
  const captured: CapturedMutationV1[] = [];
  const owners = new Set<string>();
  for (const input of inputs) {
    const value = yield* Effect.fromResult(decodeMutationInputResult(input));
    const first = captured[0];
    const owner = mutationOwnerKey(value);
    if (
      owners.has(owner) ||
      (first !== undefined &&
        (value.scopeId !== first.scopeId ||
          value.writeEpoch !== first.writeEpoch))
    )
      return yield* Effect.fail(invalid("invalidBatch"));
    owners.add(owner);
    captured.push(value);
  }
  const first = captured[0];
  if (first === undefined) return prepareUniqueApplication([]);
  const scopeUuid = yield* requireScopeAuthorityEffect(
    tx,
    first.scopeId,
    first.expectedScopeUuid,
    first.writeEpoch,
  );
  const mutations: DecodedMutationV1[] = [];
  for (const value of captured) {
    mutations.push({
      ...value,
      scopeUuid,
      previous:
        value.previous === null
          ? null
          : yield* hashClaimEffect(value.previous, sha256),
      next:
        value.next === null ? null : yield* hashClaimEffect(value.next, sha256),
    });
  }
  return prepareUniqueApplication(mutations);
});

export interface PreparedAppUniqueMutationApplication {
  readonly mutations: readonly DecodedMutationV1[];
  readonly owners: readonly AppUniqueAbsentOwner[];
  readonly previous: readonly (StoredClaimRow | null)[];
  readonly next: readonly (StoredClaimRow | null)[];
  readonly releases: readonly StoredClaimRow[];
  readonly claims: readonly StoredClaimRow[];
  readonly retainedClaims: readonly StoredClaimRow[];
  readonly absentOwners: readonly AppUniqueAbsentOwner[];
  readonly results: readonly ApplyAppUniqueKeyMutationV1Result[];
}

/** These canonical keys originate at the selected immutable definition owner;
 * allocation of the transaction's write epoch remains a separate operation. */
export interface AppUniqueCanonicalTransition {
  readonly constraintId: AppUniqueConstraintIdV1; readonly tableId: CatalogTableId; readonly rowId: AppRowIdHexV1;
  readonly localeKey: string;
  readonly previous: CanonicalAppUniqueKeyV1 | null; readonly next: CanonicalAppUniqueKeyV1 | null;
  readonly rowPrevCommitSeq: CommitSeq | null;
}
const decodeUniqueOwnerAcceptance = Schema.decodeUnknownResult(Schema.Struct({ reason: Schema.Literal("accepted"), owners: Schema.Number }), { onExcessProperty: "error" });
const decodeUniqueApplicationDriverRows = Schema.decodeUnknownResult(Schema.Struct({ rows: Schema.Array(Schema.Unknown) }));
const decodeUniqueOwnerRefusal = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Struct({
  reason: Schema.Literals(["invalidBatch", "storedCorruption", "previousMismatch"]), ordinal: Schema.Number,
})), { onExcessProperty: "error" });

export const acceptAppUniqueOriginalOwnersInTransactionEffect = Effect.fn("AppUniqueKeys.acceptOriginalOwners")(function* (
  tx: AppUniqueKeyTransaction, scopeId: ScopeId, writeEpoch: ScopeEpoch, pairs: readonly AppUniqueCanonicalTransition[],
) {
  if (pairs.length === 0) return;
  const projection = yield* Effect.fromResult(projectScopeIdUuidV1Result(scopeId).pipe(Result.mapError(cause => invalid("invalidScopeId", cause))));
  const scopeUuid = yield* requireScopeAuthorityEffect(tx, scopeId, projection.scopeUuid, writeEpoch);
  const owners: AppUniqueAbsentOwner[] = pairs.map((pair, ordinal) => ({ scopeUuid, constraintId: pair.constraintId,
    localeKey: pair.localeKey, tableId: pair.tableId, rowId: appRowIdHexV1ToBytes(pair.rowId), ordinal }));
  const schemaName = yield* Effect.fromResult(requireAdmittedTargetInstallationSchema(tx).pipe(Result.mapError(cause => new AppUniqueKeyPersistenceError(cause))));
  const statement = buildAppUniqueOwnerAcceptanceStatement(owners, pairs.map(pair => pair.previous?.kind === "claim" ? pair.previous.canonicalKeyBytes : null),
    pairs.map(pair => pair.rowPrevCommitSeq), schemaName);
  const result = yield* Effect.uninterruptible(Effect.tryPromise({ try: () => tx.execute(statement), catch: cause => {
    const detail = applicationDomainFailureDetail(cause, "fx_accept_app_unique_owners");
    if (detail === null) return new AppUniqueKeyPersistenceError(cause);
    return Result.match(decodeUniqueOwnerRefusal(detail), { onFailure: () => new AppUniqueKeyPersistenceError(cause), onSuccess: proof =>
      Number.isSafeInteger(proof.ordinal) && proof.ordinal >= 0 && proof.ordinal < pairs.length
        ? new AppUniqueKeyStorageCorruptionError("original unique owner differs", { cause }) : new AppUniqueKeyPersistenceError(cause) });
  } }));
  const { rows } = yield* Effect.fromResult(decodeUniqueApplicationDriverRows(result)
    .pipe(Result.mapError(cause => new AppUniqueKeyPersistenceError(cause))));
  if (rows.length !== 1) return yield* Effect.fail(new AppUniqueKeyPersistenceError(result));
  const proof = yield* Effect.fromResult(decodeUniqueOwnerAcceptance(rows[0]).pipe(Result.mapError(cause => new AppUniqueKeyPersistenceError(cause))));
  if (proof.owners !== pairs.length) return yield* Effect.fail(new AppUniqueKeyPersistenceError(proof));
});

export const prepareAppUniqueCanonicalMutationApplicationEffect = Effect.fn("AppUniqueKeys.bindCanonicalMutationApplication")(function* (
  tx: AppUniqueKeyTransaction, scopeId: ScopeId, writeEpoch: ScopeEpoch, pairs: readonly AppUniqueCanonicalTransition[],
  sha256: AppUniqueKeySha256V1 = liveSha256,
) {
  if (pairs.length > MAX_APP_UNIQUE_WRITE_MUTATIONS) return yield* Effect.fail(invalid("rowCountExceeded"));
  if (pairs.length === 0) return prepareUniqueApplication([]);
  const projection = yield* Effect.fromResult(projectScopeIdUuidV1Result(scopeId).pipe(Result.mapError(cause => invalid("invalidScopeId", cause))));
  const scopeUuid = yield* requireScopeAuthorityEffect(tx, scopeId, projection.scopeUuid, writeEpoch);
  const owners = new Set<string>(); const mutations: DecodedMutationV1[] = [];
  for (const pair of pairs) {
    const constraintId = yield* Effect.fromResult(decodeAppUniqueConstraintIdV1Result(pair.constraintId).pipe(Result.mapError(cause => invalid("invalidConstraintId", cause))));
    const tableId = yield* Effect.fromResult(decodeTableIdResult(pair.tableId).pipe(Result.mapError(cause => invalid("invalidTableId", cause))));
    const rowId = yield* Effect.fromResult(decodeRowIdResult(pair.rowId).pipe(Result.mapError(cause => invalid("invalidRowId", cause))));
    const previous = pair.previous?.kind === "claim" ? pair.previous : null;
    const next = pair.next?.kind === "claim" ? pair.next : null;
    if ((pair.previous !== null && pair.previous.localeKey !== pair.localeKey) ||
      (pair.next !== null && pair.next.localeKey !== pair.localeKey)) return yield* Effect.fail(invalid("invalidTransition"));
    const localeKey = pair.localeKey;
    const hashedPrevious = previous === null ? null : yield* hashClaimEffect(previous, sha256);
    const hashedNext = next === null ? null : previous !== null && next.encodedKey === previous.encodedKey
      ? hashedPrevious : yield* hashClaimEffect(next, sha256);
    const mutation = { scopeId, expectedScopeUuid: projection.scopeUuid, scopeUuid, constraintId, tableId, rowId,
      rowIdBytes: appRowIdHexV1ToBytes(rowId), writeEpoch, localeKey,
      previous: hashedPrevious, next: hashedNext };
    const key = mutationOwnerKey(mutation);
    if (owners.has(key)) return yield* Effect.fail(invalid("invalidBatch"));
    owners.add(key); mutations.push(mutation);
  }
  return prepareUniqueApplication(mutations);
});

function storedMutationClaim(mutation: DecodedMutationV1, claim: HashedClaimV1 | null): StoredClaimRow | null {
  return claim === null ? null : {
    scopeUuid: mutation.scopeUuid, constraintId: mutation.constraintId, localeKey: claim.localeKey,
    canonicalKeySha256: claim.canonicalKeySha256, keyCodecVersion: APP_UNIQUE_KEY_CODEC_VERSION_V1,
    encodedKey: claim.canonicalKeyBytes, tableId: mutation.tableId, rowId: mutation.rowIdBytes,
  };
}

function isUniqueMutationProofPage(offset: number, count: number, size: number): boolean {
  return Number.isSafeInteger(offset) && offset >= 0 && offset % 32 === 0 && Number.isSafeInteger(count) &&
    count > 0 && count <= 32 && count === Math.min(32, size - offset);
}

function prepareUniqueApplication(mutations: readonly DecodedMutationV1[]): PreparedAppUniqueMutationApplication {
  const owners = mutations.map((mutation, ordinal) => ({ scopeUuid: mutation.scopeUuid, constraintId: mutation.constraintId,
    localeKey: mutation.localeKey, tableId: mutation.tableId, rowId: mutation.rowIdBytes, ordinal }));
  const previous = mutations.map(mutation => storedMutationClaim(mutation, mutation.previous));
  const next = mutations.map(mutation => storedMutationClaim(mutation, mutation.next));
  const releases: StoredClaimRow[] = []; const claims: StoredClaimRow[] = [];
  const retainedClaims: StoredClaimRow[] = []; const absentOwners: AppUniqueAbsentOwner[] = [];
  const results: ApplyAppUniqueKeyMutationV1Result[] = [];
  for (const [ordinal, mutation] of mutations.entries()) {
    const previousRow = previous[ordinal]; const nextRow = next[ordinal];
    if (mutation.previous !== null && mutation.next !== null && sameClaimSlot(mutation.previous, mutation.next)) {
      if (previousRow !== undefined && previousRow !== null) retainedClaims.push(previousRow);
      results.push(projectMutation("unchanged", mutation));
    } else {
      if (previousRow !== undefined && previousRow !== null) releases.push(previousRow);
      if (nextRow !== undefined && nextRow !== null) {
        claims.push(nextRow); retainedClaims.push(nextRow); results.push(projectMutation("claimed", mutation));
      } else {
        const owner = owners[ordinal]; if (owner !== undefined) absentOwners.push(owner);
        results.push({ status: mutation.previous === null ? "omitted" : "released", claim: null });
      }
    }
  }
  return { mutations, owners, previous, next, releases, claims, retainedClaims, absentOwners, results };
}

const decodeUniqueMutationSuccess = Schema.decodeUnknownResult(Schema.Struct({ reason: Schema.Literal("accepted"), mutations: Schema.Number }), { onExcessProperty: "error" });
const decodeUniqueMutationRefusal = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Union([
  Schema.Struct({ kind: Schema.Literal("admission"), reason: Schema.Literals(["invalidBatch", "parentMissing", "parentTombstone", "storedCorruption", "hashCollision", "previousMismatch", "claimConflict"]),
    stage: Schema.Literals(["parent", "stored", "destination", "previous"]), ordinal: Schema.Number,
    actualTableId: Schema.NullOr(Schema.Number), actualRowIdHex: Schema.NullOr(Schema.String) }),
  Schema.Struct({ kind: Schema.Literal("proof"), releaseOffset: Schema.Number, releaseCount: Schema.Number,
    claimOffset: Schema.Number, claimCount: Schema.Number, detail: Schema.String }),
])), { onExcessProperty: "error" });

export function preparedAppUniqueApplicationFailure(cause: unknown, prepared: PreparedAppUniqueMutationApplication, capturedDetail?: string): ApplyAppUniqueKeyMutationV1Error {
  const detail = capturedDetail ?? applicationDomainFailureDetail(cause, "fx_apply_app_unique_mutations");
  if (detail === null) return new AppUniqueKeyPersistenceError(cause);
  return Result.match(decodeUniqueMutationRefusal(detail), {
    onFailure: () => new AppUniqueKeyPersistenceError(cause),
    onSuccess: verdict => {
      if (verdict.kind === "proof") {
        const combined = prepared.releases.length <= 32 && prepared.claims.length <= 32 && prepared.releases.length + prepared.claims.length > 0;
        const emptyRelease = verdict.releaseOffset === 0 && verdict.releaseCount === 0;
        const emptyClaim = verdict.claimOffset === 0 && verdict.claimCount === 0;
        const noWrites = prepared.releases.length === 0 && prepared.claims.length === 0;
        const reachable = combined
          ? verdict.releaseOffset === 0 && verdict.claimOffset === 0 &&
            verdict.releaseCount === prepared.releases.length && verdict.claimCount === prepared.claims.length
          : noWrites ? prepared.absentOwners.length > 0 && emptyRelease && emptyClaim
            : (emptyClaim && isUniqueMutationProofPage(verdict.releaseOffset, verdict.releaseCount, prepared.releases.length)) ||
              (emptyRelease && isUniqueMutationProofPage(verdict.claimOffset, verdict.claimCount, prepared.claims.length));
        if (!reachable) return new AppUniqueKeyPersistenceError(cause);
        const releases = prepared.releases.slice(verdict.releaseOffset, verdict.releaseOffset + verdict.releaseCount);
        const claims = prepared.claims.slice(verdict.claimOffset, verdict.claimOffset + verdict.claimCount);
        const final = combined || (prepared.claims.length === 0 ? verdict.releaseOffset + verdict.releaseCount === prepared.releases.length
          : verdict.claimCount > 0 && verdict.claimOffset + verdict.claimCount === prepared.claims.length);
        const verifyReleases = !final || combined ? [] : prepared.claims.length === 0 ? prepared.releases.slice(0, verdict.releaseOffset) : prepared.releases;
        const verifyClaims = final ? prepared.retainedClaims.filter(row => !claims.includes(row)) : [];
        return uniqueBatchFailure(cause, releases, claims, prepared.mutations, verifyReleases, verifyClaims,
          final ? prepared.absentOwners : [], verdict.detail);
      }
      const mutation = Number.isSafeInteger(verdict.ordinal) && verdict.ordinal >= 0 ? prepared.mutations[verdict.ordinal] : undefined;
      if (mutation === undefined) return new AppUniqueKeyPersistenceError(cause);
      if (verdict.reason !== "claimConflict" && (verdict.actualTableId !== null || verdict.actualRowIdHex !== null)) return new AppUniqueKeyPersistenceError(cause);
      switch (verdict.reason) {
        case "invalidBatch": return verdict.stage === "stored" ? invalid("invalidBatch") : new AppUniqueKeyPersistenceError(cause);
        case "storedCorruption": return corruption("unique admission stored evidence is inconsistent", cause);
        case "parentMissing": return verdict.stage !== "parent" || mutation.next === null ? new AppUniqueKeyPersistenceError(cause)
          : new AppUniqueKeyParentRowError(mutation.scopeId, mutation.tableId, mutation.rowId, "missing");
        case "parentTombstone": return verdict.stage !== "parent" || mutation.next === null ? new AppUniqueKeyPersistenceError(cause)
          : new AppUniqueKeyParentRowError(mutation.scopeId, mutation.tableId, mutation.rowId, "tombstonedClaim");
        case "previousMismatch": return verdict.stage === "previous" ? new AppUniqueKeyPreviousClaimMismatchError(mutation.constraintId, mutation.rowId)
          : new AppUniqueKeyPersistenceError(cause);
        case "hashCollision": {
          const claim = verdict.stage === "destination" ? mutation.next : verdict.stage === "previous" ? mutation.previous : null;
          return claim === null ? new AppUniqueKeyPersistenceError(cause) : new CanonicalAppUniqueKeyHashCollisionError(mutation.constraintId, claim.localeKey);
        }
        case "claimConflict": return Result.match(Result.gen(function* () {
          const tableId = yield* decodeTableIdResult(verdict.actualTableId);
          const rowId = yield* decodeRowIdResult(verdict.actualRowIdHex);
          return verdict.stage !== "destination" || mutation.next === null ? new AppUniqueKeyPersistenceError(cause)
            : new AppUniqueKeyConflictError(mutation.constraintId, mutation.next.localeKey, tableId, rowId);
        }), { onFailure: () => new AppUniqueKeyPersistenceError(cause), onSuccess: value => value });
      }
    },
  });
}
export const applyAppUniqueKeyMutationsInTransactionEffect = Effect.fn("AppUniqueKeys.applyMutationsInTransaction")(function* (
  tx: AppUniqueKeyTransaction, inputs: readonly ApplyAppUniqueKeyMutationV1Input[],
  sha256: AppUniqueKeySha256V1 = liveSha256, publicationObservation?: PointCommitPublicationObservation,
) {
  const prepared = yield* prepareAppUniqueMutationApplicationEffect(tx, inputs, sha256);
  return yield* applyPreparedAppUniqueMutationApplicationEffect(tx, prepared, publicationObservation);
}, (effect, tx) => effect.pipe(Effect.onError(() => Effect.sync(() => closeExactAttemptScopeClockObservation(tx)))));

export const applyPreparedAppUniqueMutationApplicationEffect = Effect.fn("AppUniqueKeys.applyPreparedMutationsInTransaction")(function* (
  tx: AppUniqueKeyTransaction, prepared: PreparedAppUniqueMutationApplication, publicationObservation?: PointCommitPublicationObservation,
) {
  if (prepared.mutations.length === 0) return [];
  const schemaName = yield* Effect.fromResult(requireAdmittedTargetInstallationSchema(tx).pipe(Result.mapError(cause => new AppUniqueKeyPersistenceError(cause))));
  const statement = buildAppUniqueMutationStatement(prepared, schemaName);
  const result = yield* Effect.uninterruptible(Effect.tryPromise({
    try: () => tx.execute(statement),
    catch: cause => preparedAppUniqueApplicationFailure(cause, prepared),
  }));
  const { rows } = yield* Effect.fromResult(decodeUniqueApplicationDriverRows(result)
    .pipe(Result.mapError(cause => corruption("unique application result has no rows", cause))));
  if (rows.length !== 1) return yield* Effect.fail(corruption("unique application result cardinality"));
  const accepted = yield* Effect.fromResult(decodeUniqueMutationSuccess(rows[0]).pipe(Result.mapError(cause => corruption("unique application result is malformed", cause))));
  if (accepted.mutations !== prepared.mutations.length) return yield* Effect.fail(corruption("unique application result count mismatch"));
  recordPreparedAppUniqueApplication(prepared, publicationObservation);
  return prepared.results;
}, (effect, tx) => effect.pipe(Effect.onError(() => Effect.sync(() => closeExactAttemptScopeClockObservation(tx)))));

export function recordPreparedAppUniqueApplication(prepared: PreparedAppUniqueMutationApplication, observation?: PointCommitPublicationObservation): void {
  if (!observation?.detail) return;
  for (const [owner, rows] of [["uniqueReleases", prepared.releases], ["uniqueClaims", prepared.claims]] as const)
    for (let offset = 0; offset < rows.length; offset += 32) {
      const batch = rows.slice(offset, offset + 32);
      observation.record({ kind: "batch", owner, counts: { rows: batch.length,
        canonicalBytes: batch.reduce((total, row) => total + row.encodedKey.byteLength, 0) } });
    }
}

const applyUniqueBatch = Effect.fn("AppUniqueKeys.applyFixedBatch")(function* (
  tx: AppUniqueKeyTransaction, releaseBatch: readonly StoredClaimRow[], claimBatch: readonly StoredClaimRow[], mutations: readonly DecodedMutationV1[],
  verificationReleases: readonly StoredClaimRow[] = [], verificationClaims: readonly StoredClaimRow[] = [],
  absentOwners: readonly AppUniqueAbsentOwner[] = [],
) {
  const schemaName = yield* Effect.fromResult(requireAdmittedTargetInstallationSchema(tx).pipe(
    Result.mapError(cause => new AppUniqueKeyPersistenceError(cause))));
    const statement = buildAppUniqueBatchStatement(releaseBatch, claimBatch, schemaName, verificationReleases, verificationClaims, absentOwners);
    const result = yield* Effect.uninterruptible(Effect.tryPromise({
      try: () => tx.execute(statement),
      catch: cause => uniqueBatchFailure(cause, releaseBatch, claimBatch, mutations, verificationReleases, verificationClaims, absentOwners),
    }));
    const rows = rowsFromDriverExecuteResult(result, () => { throw corruption("unique application result has no rows"); });
    if (rows.length !== 1) return yield* Effect.fail(corruption("unique application result cardinality"));
    const accepted = yield* Effect.fromResult(decodeUniqueBatchSuccess(rows[0]).pipe(
      Result.mapError(cause => corruption("unique application result is malformed", cause))));
    if (accepted.ordinal !== releaseBatch.length + claimBatch.length)
      return yield* Effect.fail(corruption("unique application result count mismatch"));
});
const decodeUniqueBatchRefusal = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Struct({
  reason: Schema.Literals(["invalidBatch", "parentMissing", "parentTombstone", "releaseMismatch", "storedCorruption", "claimConflict"]),
  phase: Schema.Literals(["release", "claim", "absentOwner"]),
  stage: Schema.Literals(["write", "verify"]),
  ordinal: Schema.Number, actualTableId: Schema.NullOr(Schema.Number), actualRowIdHex: Schema.NullOr(Schema.String),
  actualKeyHex: Schema.NullOr(Schema.String), actualCodec: Schema.NullOr(Schema.Number),
})), { onExcessProperty: "error" });
const decodeUniqueBatchSuccess = Schema.decodeUnknownResult(Schema.Struct({
  reason: Schema.Literal("accepted"), ordinal: Schema.Number, actualTableId: Schema.Null,
  actualRowId: Schema.Null, actualKey: Schema.Null, actualCodec: Schema.Null,
}), { onExcessProperty: "error" });
function uniqueBatchFailure(cause: unknown, releases: readonly StoredClaimRow[], claims: readonly StoredClaimRow[], mutations: readonly DecodedMutationV1[],
  verificationReleases: readonly StoredClaimRow[], verificationClaims: readonly StoredClaimRow[], absentOwners: readonly AppUniqueAbsentOwner[], capturedDetail?: string) {
  const detail = capturedDetail ?? applicationDomainFailureDetail(cause, "fx_apply_app_unique_batch");
  if (detail === null) return new AppUniqueKeyPersistenceError(cause);
  return Result.match(decodeUniqueBatchRefusal(detail), {
    onFailure: () => new AppUniqueKeyPersistenceError(cause),
    onSuccess: verdict => {
    if (verdict.phase === "absentOwner") {
      const expected = absentOwners.find(owner => owner.ordinal === verdict.ordinal);
      const mutation = Number.isSafeInteger(verdict.ordinal) && verdict.ordinal >= 0 ? mutations[verdict.ordinal] : undefined;
      if (verdict.stage !== "verify" || verdict.reason !== "storedCorruption" || expected === undefined ||
        mutation === undefined || mutation.next !== null || expected.scopeUuid !== mutation.scopeUuid ||
        storedOwnerKey(expected) !== mutationOwnerKey(mutation) || verdict.actualTableId !== null ||
        verdict.actualRowIdHex !== null || verdict.actualKeyHex !== null || verdict.actualCodec !== null)
        return new AppUniqueKeyPersistenceError(cause);
      return corruption("expected absent unique owner has a stored claim after application", cause);
    }
    if (verdict.stage === "verify" && verdict.reason !== "storedCorruption") return new AppUniqueKeyPersistenceError(cause);
    const selected = verdict.phase === "release" ? verdict.stage === "verify" ? [...verificationReleases, ...releases] : releases
      : verdict.stage === "verify" ? [...verificationClaims, ...claims] : claims;
    const expected = selected[verdict.ordinal];
    if (!Number.isSafeInteger(verdict.ordinal) || expected === undefined)
      return new AppUniqueKeyPersistenceError(cause);
    const mutation = mutations.find(value => mutationOwnerKey(value) === storedOwnerKey(expected));
    if (mutation === undefined) return new AppUniqueKeyPersistenceError(cause);
    switch (verdict.reason) {
      case "invalidBatch": return invalid("invalidBatch");
      case "storedCorruption": return corruption("stored unique application proof differs from prepared claim", cause);
      case "releaseMismatch": return new AppUniqueKeyPreviousClaimMismatchError(mutation.constraintId, mutation.rowId);
      case "parentMissing": return new AppUniqueKeyParentRowError(mutation.scopeId, mutation.tableId, mutation.rowId, "missing");
      case "parentTombstone": return new AppUniqueKeyParentRowError(mutation.scopeId, mutation.tableId, mutation.rowId, "tombstonedClaim");
      case "claimConflict": {
        return Result.match(Result.gen(function* () {
          const tableId = yield* decodeTableIdResult(verdict.actualTableId);
          const rowId = yield* decodeRowIdResult(verdict.actualRowIdHex);
          if (verdict.actualKeyHex === null || !/^(?:[0-9a-f]{2})+$/.test(verdict.actualKeyHex) ||
            verdict.actualCodec !== APP_UNIQUE_KEY_CODEC_VERSION_V1)
            return new AppUniqueKeyPersistenceError(cause);
          const encoded = orderedIndexKeyBytesHexV1FromBytes(expected.encodedKey);
          return encoded !== verdict.actualKeyHex
            ? new CanonicalAppUniqueKeyHashCollisionError(mutation.constraintId, expected.localeKey)
            : new AppUniqueKeyConflictError(mutation.constraintId, expected.localeKey, tableId, rowId);
        }), { onFailure: () => new AppUniqueKeyPersistenceError(cause), onSuccess: conflict => conflict });
      }
    }
    },
  });
}


function mutationOwnerKey(
  mutation: CapturedMutationV1 | DecodedMutationV1,
): string {
  return JSON.stringify([
    mutation.constraintId,
    mutation.localeKey,
    mutation.tableId,
    [...mutation.rowIdBytes],
  ]);
}

function storedOwnerKey(row: Pick<StoredClaimRow, "constraintId" | "localeKey" | "tableId" | "rowId">): string {
  return JSON.stringify([
    row.constraintId,
    row.localeKey,
    row.tableId,
    [...row.rowId],
  ]);
}

function claimSlotKey(
  constraintId: AppUniqueConstraintIdV1,
  claim: HashedClaimV1,
): string {
  return JSON.stringify([
    constraintId,
    claim.localeKey,
    [...claim.canonicalKeySha256],
  ]);
}

/**
 * Transaction-only S11 reconciliation primitive for a bounded C08 backfill.
 * It requires a live current parent row, claims an absent slot,
 * and treats only an identical current claim as replay. It never advances or
 * releases ownership; normal point-commit mutation remains the sole online
 * transition owner.
 */
export const ensureAppUniqueKeyBackfillClaimInTransactionEffect = Effect.fn(
  "AppUniqueKeys.ensureBackfillClaimInTransaction",
)(function* (
  tx: AppUniqueKeyTransaction,
  input: EnsureAppUniqueKeyBackfillClaimV1Input,
  sha256: AppUniqueKeySha256V1 = liveSha256,
): Effect.fn.Return<
  EnsureAppUniqueKeyBackfillClaimV1Result,
  EnsureAppUniqueKeyBackfillClaimV1Error
> {
  const mutation = yield* prepareMutationEffect(
    tx,
    {
      scopeId: input.scopeId,
      constraintId: input.constraintId,
      tableId: input.tableId,
      rowId: input.rowId,
      writeEpoch: input.authorityEpoch,
      previous: null,
      next: input.claim,
    },
    sha256,
  );
  const claim = mutation.next;
  if (claim === null) {
    return yield* Effect.fail(
      new InvalidAppUniqueKeyMutationV1Error("invalidNextKey"),
    );
  }
  const storedSlot = yield* readClaimSlotForUpdateEffect(tx, mutation, claim);
  if (storedSlot !== null) {
    yield* Effect.fromResult(
      compareStoredKeyResult(storedSlot, claim, mutation.constraintId),
    );
    const decoded = yield* Effect.fromResult(
      decodeStoredClaimResult(mutation.scopeId, storedSlot, claim),
    );
    if (
      decoded.tableId !== mutation.tableId ||
      decoded.rowId !== mutation.rowId
    ) {
      return yield* Effect.fail(
        new AppUniqueKeyConflictError(
          mutation.constraintId,
          claim.localeKey,
          decoded.tableId,
          decoded.rowId,
        ),
      );
    }
    return Object.freeze({ status: "replayed", claim: decoded });
  }

  const ownerRows = yield* persistenceEffect(
    tx
      .select()
      .from(fxAppUniqueKeys)
      .where(
        and(
          eq(fxAppUniqueKeys.scopeUuid, mutation.scopeUuid),
          eq(fxAppUniqueKeys.constraintId, mutation.constraintId),
          eq(fxAppUniqueKeys.localeKey, claim.localeKey),
          eq(fxAppUniqueKeys.tableId, mutation.tableId),
          eq(fxAppUniqueKeys.rowId, mutation.rowIdBytes),
        ),
      )
      .limit(2)
      .for("update"),
  );
  if (ownerRows.length > 1) {
    return yield* Effect.fail(
      corruption("one owner has multiple current claims"),
    );
  }
  if (ownerRows[0] !== undefined) {
    return yield* Effect.fail(
      new AppUniqueKeyBackfillClaimMismatchError(
        mutation.constraintId,
        mutation.rowId,
      ),
    );
  }

  yield* applyUniqueBatch(tx, [], [{
      scopeUuid: mutation.scopeUuid,
      constraintId: mutation.constraintId,
      localeKey: claim.localeKey,
      canonicalKeySha256: claim.canonicalKeySha256,
      keyCodecVersion: APP_UNIQUE_KEY_CODEC_VERSION_V1,
      encodedKey: claim.canonicalKeyBytes,
      tableId: mutation.tableId,
      rowId: mutation.rowIdBytes,
    }], [mutation]).pipe(Effect.mapError(cause => cause instanceof AppUniqueKeyPreviousClaimMismatchError
      ? new AppUniqueKeyBackfillClaimMismatchError(mutation.constraintId, mutation.rowId) : cause));
  return Object.freeze({
    status: "claimed",
    claim: projectMutation("claimed", mutation).claim!,
  });
});

/**
 * Transaction-only S11 validation primitive for the bounded C08 validation
 * pass. Its caller first rejects claims outside the definition's exact locale
 * and table dimensions; this operation then requires exact key ownership or
 * exact absence without mutating claim ownership.
 */
export const validateAppUniqueKeyClaimInTransactionEffect = Effect.fn(
  "AppUniqueKeys.validateClaimInTransaction",
)(function* (
  tx: AppUniqueKeyTransaction,
  input: ValidateAppUniqueKeyClaimV1Input,
  sha256: AppUniqueKeySha256V1 = liveSha256,
): Effect.fn.Return<
  ValidateAppUniqueKeyClaimV1Result,
  ValidateAppUniqueKeyClaimV1Error
> {
  const decoded = yield* Effect.fromResult(decodeValidationInputResult(input));
  const scopeUuid = yield* requireScopeAuthorityEffect(
    tx,
    decoded.scopeId,
    decoded.expectedScopeUuid,
    decoded.authorityEpoch,
  );
  const rows = yield* persistenceEffect(
    tx
      .select()
      .from(fxAppUniqueKeys)
      .where(
        and(
          eq(fxAppUniqueKeys.scopeUuid, scopeUuid),
          eq(fxAppUniqueKeys.constraintId, decoded.constraintId),
          eq(fxAppUniqueKeys.localeKey, ""),
          eq(fxAppUniqueKeys.tableId, decoded.tableId),
          eq(fxAppUniqueKeys.rowId, decoded.rowIdBytes),
        ),
      )
      .limit(2)
      .for("update"),
  );
  if (rows.length > 1) {
    return yield* Effect.fail(
      corruption("one definition/row owner has multiple current claims"),
    );
  }
  const stored = rows[0];
  if (stored === undefined) {
    return decoded.expected === null
      ? MATCHED_VALIDATION
      : Object.freeze({
          status: "mismatched" as const,
          reason: "missingClaim" as const,
        });
  }
  const actual = yield* Effect.fromResult(
    decodeStoredValidationClaimResult(stored),
  );
  const actualDigest = yield* hashBytesEffect(actual.encodedKeyBytes, sha256);
  if (!bytesEqualFullScan(actualDigest, actual.canonicalKeySha256)) {
    return yield* Effect.fail(
      corruption("stored canonical key digest does not match encoded bytes"),
    );
  }
  if (decoded.expected === null) {
    return Object.freeze({
      status: "mismatched" as const,
      reason: "unexpectedClaim" as const,
    });
  }
  const expected = yield* hashClaimEffect(decoded.expected, sha256);
  return actual.scopeUuid === scopeUuid &&
    actual.constraintId === decoded.constraintId &&
    actual.localeKey === expected.localeKey &&
    actual.tableId === decoded.tableId &&
    actual.rowId === decoded.rowId &&
    bytesEqualFullScan(actual.encodedKeyBytes, expected.canonicalKeyBytes) &&
    bytesEqualFullScan(actual.canonicalKeySha256, expected.canonicalKeySha256)
    ? MATCHED_VALIDATION
    : Object.freeze({
        status: "mismatched" as const,
        reason: "claimIdentityMismatch" as const,
      });
});

const prepareMutationEffect = Effect.fn("AppUniqueKeys.prepareMutation")(
  function* (
    tx: AppUniqueKeyTransaction,
    input: ApplyAppUniqueKeyMutationV1Input,
    sha256: AppUniqueKeySha256V1,
  ) {
    const captured = yield* Effect.fromResult(decodeMutationInputResult(input));
    const scopeUuid = yield* requireScopeAuthorityEffect(
      tx,
      captured.scopeId,
      captured.expectedScopeUuid,
      captured.writeEpoch,
    );
    const previous =
      captured.previous === null
        ? null
        : yield* hashClaimEffect(captured.previous, sha256);
    const next =
      captured.next === null
        ? null
        : yield* hashClaimEffect(captured.next, sha256);
    const mutation: DecodedMutationV1 = Object.freeze({
      ...captured,
      scopeUuid,
      previous,
      next,
    });
    if (next !== null) yield* requireLiveParentRowEffect(tx, mutation);
    return mutation;
  },
);

const requireScopeAuthorityEffect = Effect.fn(
  "AppUniqueKeys.requireScopeAuthority",
)(function* (
  tx: AppUniqueKeyTransaction,
  scopeId: ScopeId,
  expectedScopeUuid: ScopeUuidV1,
  expectedEpoch: ScopeEpoch,
) {
  const observed = readExactScopeWriteClockObservation(tx, scopeId);
  const scope = observed === undefined ? yield* persistenceEffect(
    tx
      .select({
        scopeUuid: fxSystemScopeClocks.scopeUuid,
        epoch: fxSystemScopeExecutionAuthorities.epoch,
      })
      .from(fxSystemScopeClocks).innerJoin(fxSystemScopeExecutionAuthorities, eq(fxSystemScopeExecutionAuthorities.scopeId, fxSystemScopeClocks.scopeId))
      .where(eq(fxSystemScopeClocks.scopeId, scopeId))
      .limit(1),
  ) : [{ scopeUuid: expectedScopeUuid, epoch: observed.epoch }];
  const authority = scope[0];
  if (authority === undefined) {
    return yield* Effect.fail(
      new AppUniqueKeyScopeAuthorityUnavailableError(scopeId, "missing"),
    );
  }
  const scopeUuid = yield* Effect.fromResult(
    decodeScopeUuidResult(authority.scopeUuid).pipe(
      Result.flatMap((value) =>
        value === expectedScopeUuid
          ? Result.succeed(value)
          : Result.fail(
              new AppUniqueKeyScopeAuthorityUnavailableError(
                scopeId,
                "identityMismatch",
              ),
            ),
      ),
      Result.mapError((error) =>
        error instanceof AppUniqueKeyScopeAuthorityUnavailableError
          ? error
          : new AppUniqueKeyScopeAuthorityUnavailableError(
              scopeId,
              "identityMismatch",
            ),
      ),
    ),
  );
  if (authority.epoch !== expectedEpoch) {
    return yield* Effect.fail(
      new AppUniqueKeyScopeAuthorityUnavailableError(scopeId, "staleEpoch"),
    );
  }
  return scopeUuid;
});

function decodeMutationInputResult(
  input: ApplyAppUniqueKeyMutationV1Input,
): Result.Result<CapturedMutationV1, InvalidAppUniqueKeyMutationV1Error> {
  const captured = Result.gen(function* () {
    const inputSnapshot = yield* Result.try({
      try: () =>
        Object.freeze({
          scopeId: input.scopeId,
          constraintId: input.constraintId,
          tableId: input.tableId,
          rowId: input.rowId,
          writeEpoch: input.writeEpoch,

          previous: input.previous,
          next: input.next,
        }),
      catch: (cause) => invalid("invalidTransition", cause),
    });
    const scopeId = yield* field(
      decodeScopeIdResult(inputSnapshot.scopeId),
      "invalidScopeId",
    );
    const constraintId = yield* decodeAppUniqueConstraintIdV1Result(
      inputSnapshot.constraintId,
    ).pipe(Result.mapError((cause) => invalid("invalidConstraintId", cause)));
    const tableId = yield* field(
      decodeTableIdResult(inputSnapshot.tableId),
      "invalidTableId",
    );
    const rowId = yield* field(
      decodeRowIdResult(inputSnapshot.rowId),
      "invalidRowId",
    );
    const writeEpoch = yield* field(
      decodeScopeEpochResult(inputSnapshot.writeEpoch),
      "invalidWriteEpoch",
    );
    if (inputSnapshot.previous === null && inputSnapshot.next === null)
      return yield* Result.fail(invalid("invalidTransition"));
    const previous =
      inputSnapshot.previous === null
        ? null
        : yield* canonicalizeAppUniqueKeyV1Result(inputSnapshot.previous).pipe(
            Result.mapError((cause) => invalid("invalidPreviousKey", cause)),
          );
    const next =
      inputSnapshot.next === null
        ? null
        : yield* canonicalizeAppUniqueKeyV1Result(inputSnapshot.next).pipe(
            Result.mapError((cause) => invalid("invalidNextKey", cause)),
          );
    const previousClaim = previous?.kind === "claim" ? previous : null;
    const nextClaim = next?.kind === "claim" ? next : null;
    if (
      previousClaim !== null &&
      nextClaim !== null &&
      previousClaim.localeKey !== nextClaim.localeKey
    )
      return yield* Result.fail(invalid("invalidTransition"));
    const scopeProjection = yield* projectScopeIdUuidV1Result(scopeId).pipe(
      Result.mapError((cause) => invalid("invalidScopeId", cause)),
    );
    return Object.freeze({
      scopeId,
      expectedScopeUuid: scopeProjection.scopeUuid,
      constraintId,
      tableId,
      rowId,
      rowIdBytes: appRowIdHexV1ToBytes(rowId),
      writeEpoch,
      previous: previousClaim,
      next: nextClaim,
      localeKey:
        nextClaim?.localeKey ??
        previousClaim?.localeKey ??
        next?.localeKey ??
        previous?.localeKey ??
        "",
    });
  });
  return captured;
}

function decodeValidationInputResult(
  input: ValidateAppUniqueKeyClaimV1Input,
): Result.Result<DecodedValidationInputV1, InvalidAppUniqueKeyMutationV1Error> {
  return Result.gen(function* () {
    const captured = yield* Result.try({
      try: () =>
        Object.freeze({
          scopeId: input.scopeId,
          constraintId: input.constraintId,
          tableId: input.tableId,
          rowId: input.rowId,
          authorityEpoch: input.authorityEpoch,
          expected: input.expected,
        }),
      catch: (cause) => invalid("invalidTransition", cause),
    });
    const scopeId = yield* field(
      decodeScopeIdResult(captured.scopeId),
      "invalidScopeId",
    );
    const constraintId = yield* decodeAppUniqueConstraintIdV1Result(
      captured.constraintId,
    ).pipe(Result.mapError((cause) => invalid("invalidConstraintId", cause)));
    const tableId = yield* field(
      decodeTableIdResult(captured.tableId),
      "invalidTableId",
    );
    const rowId = yield* field(
      decodeRowIdResult(captured.rowId),
      "invalidRowId",
    );
    const authorityEpoch = yield* field(
      decodeScopeEpochResult(captured.authorityEpoch),
      "invalidWriteEpoch",
    );
    const capturedExpected = captured.expected;
    const expected =
      capturedExpected === null
        ? null
        : yield* Result.gen(function* () {
            const claim = yield* canonicalizeAppUniqueKeyV1Result(
              capturedExpected,
            ).pipe(
              Result.mapError((cause) => invalid("invalidNextKey", cause)),
            );
            if (claim.kind !== "claim") {
              return yield* Result.fail(invalid("invalidNextKey"));
            }
            return claim;
          });
    const expectedScopeUuid = yield* projectScopeIdUuidV1Result(scopeId).pipe(
      Result.map((projection) => projection.scopeUuid),
      Result.mapError((cause) => invalid("invalidScopeId", cause)),
    );
    return Object.freeze({
      scopeId,
      expectedScopeUuid,
      constraintId,
      tableId,
      rowId,
      rowIdBytes: appRowIdHexV1ToBytes(rowId),
      authorityEpoch,
      expected,
    });
  });
}

const hashClaimEffect = Effect.fn("AppUniqueKeys.hashClaim")(function* (
  claim: CanonicalAppUniqueKeyClaimV1,
  sha256: AppUniqueKeySha256V1,
) {
  const digest = yield* hashBytesEffect(claim.canonicalKeyBytes, sha256);
  return Object.freeze({
    ...claim,
    canonicalKeyBytes: new Uint8Array(claim.canonicalKeyBytes),
    canonicalKeySha256: digest,
  });
});

const hashBytesEffect = Effect.fn("AppUniqueKeys.hashBytes")(function* (
  bytes: Uint8Array,
  sha256: AppUniqueKeySha256V1,
) {
  const digest = yield* Effect.tryPromise({
    try: () => sha256(new Uint8Array(bytes)),
    catch: (cause) => new AppUniqueKeyHashError(cause),
  }).pipe(Effect.uninterruptible);
  if (!isUint8ArrayWithByteLength(digest, 32)) {
    return yield* Effect.fail(
      new AppUniqueKeyHashError(
        new Error("SHA-256 adapter returned an invalid digest."),
      ),
    );
  }
  return new Uint8Array(digest);
});

const requireLiveParentRowEffect = Effect.fn(
  "AppUniqueKeys.requireLiveParentRow",
)(function* (tx: AppUniqueKeyTransaction, mutation: DecodedMutationV1) {
  const rows = yield* persistenceEffect(
    tx
      .select({ isTombstone: fxAppRowRevisions.isTombstone })
      .from(fxAppRowCurrent)
      .innerJoin(
        fxAppRowRevisions,
        and(
          eq(fxAppRowRevisions.scopeUuid, fxAppRowCurrent.scopeUuid),
          eq(fxAppRowRevisions.tableId, fxAppRowCurrent.tableId),
          eq(fxAppRowRevisions.rowId, fxAppRowCurrent.rowId),
          eq(fxAppRowRevisions.commitSeq, fxAppRowCurrent.commitSeq),
        ),
      )
      .where(
        and(
          eq(fxAppRowCurrent.scopeUuid, mutation.scopeUuid),
          eq(fxAppRowCurrent.tableId, mutation.tableId),
          eq(fxAppRowCurrent.rowId, mutation.rowIdBytes),
        ),
      )
      .limit(1),
  );
  const row = rows[0];
  if (!row)
    return yield* Effect.fail(
      new AppUniqueKeyParentRowError(
        mutation.scopeId,
        mutation.tableId,
        mutation.rowId,
        "missing",
      ),
    );
  if (typeof row.isTombstone !== "boolean")
    return yield* Effect.fail(corruption("parent tombstone flag is invalid"));
  if (row.isTombstone)
    return yield* Effect.fail(
      new AppUniqueKeyParentRowError(
        mutation.scopeId,
        mutation.tableId,
        mutation.rowId,
        "tombstonedClaim",
      ),
    );
});

const readClaimSlotForUpdateEffect = Effect.fn(
  "AppUniqueKeys.readClaimSlotForUpdate",
)(function* (
  tx: AppUniqueKeyTransaction,
  mutation: DecodedMutationV1,
  claim: HashedClaimV1,
) {
  const rows = yield* persistenceEffect(
    tx
      .select()
      .from(fxAppUniqueKeys)
      .where(
        and(
          eq(fxAppUniqueKeys.scopeUuid, mutation.scopeUuid),
          eq(fxAppUniqueKeys.constraintId, mutation.constraintId),
          eq(fxAppUniqueKeys.localeKey, claim.localeKey),
          eq(fxAppUniqueKeys.canonicalKeySha256, claim.canonicalKeySha256),
        ),
      )
      .limit(2)
      .for("update"),
  );
  if (rows.length > 1) {
    return yield* Effect.fail(
      corruption("one unique-key slot has multiple owners"),
    );
  }
  const row = rows[0];
  return row === undefined
    ? null
    : yield* Effect.fromResult(storedField(decodeStoredClaimRowResult(row)));
});

function compareStoredKeyResult(
  stored: StoredClaimRow,
  expected: HashedClaimV1,
  constraintId: AppUniqueConstraintIdV1,
): Result.Result<
  void,
  CanonicalAppUniqueKeyHashCollisionError | AppUniqueKeyStorageCorruptionError
> {
  if (
    stored.keyCodecVersion !== APP_UNIQUE_KEY_CODEC_VERSION_V1 ||
    stored.localeKey !== expected.localeKey ||
    !bytesEqualFullScan(stored.canonicalKeySha256, expected.canonicalKeySha256)
  )
    return Result.fail(corruption("stored key identity is inconsistent"));
  if (!bytesEqualFullScan(stored.encodedKey, expected.canonicalKeyBytes)) {
    return Result.fail(
      new CanonicalAppUniqueKeyHashCollisionError(
        constraintId,
        expected.localeKey,
      ),
    );
  }
  return Result.succeed(undefined);
}

function decodeStoredClaimResult(
  scopeId: ScopeId,
  stored: StoredClaimRow,
  expected: HashedClaimV1,
): Result.Result<AppUniqueKeyClaimV1, AppUniqueKeyStorageCorruptionError> {
  return decodeStoredValidationClaimResult(stored).pipe(
    Result.map((row) =>
      Object.freeze({
        scopeId,
        scopeUuid: row.scopeUuid,
        constraintId: row.constraintId,
        localeKey: row.localeKey,
        encodedKey: expected.encodedKey,
        canonicalKeySha256: new Uint8Array(row.canonicalKeySha256),
        tableId: row.tableId,
        rowId: row.rowId,
      }),
    ),
  );
}

function decodeStoredValidationClaimResult(stored: unknown) {
  return Result.gen(function* () {
    const row = yield* storedField(decodeStoredClaimRowResult(stored));
    const rowId = yield* storedField(appRowIdHexV1FromBytesResult(row.rowId));
    return Object.freeze({
      ...row,
      rowId,
      encodedKeyBytes: new Uint8Array(row.encodedKey),
      canonicalKeySha256: new Uint8Array(row.canonicalKeySha256),
    });
  });
}

const decodeSlotIdentity = Schema.decodeUnknownResult(Schema.Struct({
  scopeId: ScopeIdSchema, constraintId: CatalogUniqueConstraintDefinitionIdSchema,
}));
const decodeSlotOwnerCommitSeq = Schema.decodeUnknownResult(Schema.toType(CommitSeqSchema));

/** Bounded committed-slot lookup. The caller owns admission and transaction
 * protection; pending changes and final claiming remain with their existing owners. */
export const readAppUniqueKeySlotInTransactionEffect = Effect.fn("AppUniqueKeys.readSlot")(
  (tx: AppUniqueKeyTransaction, input: {
    readonly scopeId: ScopeId; readonly constraintId: AppUniqueConstraintIdV1; readonly key: AppUniqueKeyProjectionV1;
  }) => readSlot(tx, input),
);

type SlotReadInput = Readonly<{ scopeId: ScopeId; constraintId: AppUniqueConstraintIdV1;
  key: AppUniqueKeyProjectionV1; pendingCommitSeq?: CommitSeq }>;

const prepareSlotRead = Effect.fn("AppUniqueKeys.prepareSlotRead")(function* (input: SlotReadInput) {
  const identity = yield* Effect.fromResult(decodeSlotIdentity(input)).pipe(Effect.mapError(cause => invalid("invalidTransition", cause)));
  const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(identity.scopeId)).pipe(Effect.mapError(cause => invalid("invalidScopeId", cause)));
  const canonical = yield* Effect.fromResult(canonicalizeAppUniqueKeyV1Result(input.key)).pipe(Effect.mapError(cause => invalid("invalidNextKey", cause)));
  const expected = canonical.kind === "omitted" ? null : yield* hashClaimEffect(canonical, liveSha256);
  return { identity, scope, expected, pendingCommitSeq: input.pendingCommitSeq };
});

type PreparedSlotRead = Effect.Success<ReturnType<typeof prepareSlotRead>>;
type StoredSlot = Readonly<{ claim: typeof fxAppUniqueKeys.$inferSelect; ownerCommitSeq: CommitSeq | null;
  tombstone: boolean | null; publishedThrough: CommitSeq | null; pendingFact: boolean }>;

const authenticateSlotRead = Effect.fn("AppUniqueKeys.authenticateSlotRead")(function* (
  prepared: PreparedSlotRead, stored: StoredSlot,
) {
  const { identity, scope, expected, pendingCommitSeq } = prepared;
  if (expected === null) return yield* Effect.die(new Error("Omitted unique slot has no stored claim"));
    if (stored.ownerCommitSeq === null || stored.tombstone !== false || stored.publishedThrough === null)
      return yield* Effect.fail(corruption("slot owner is not a live revision"));
    const ownerCommitSeq = yield* Effect.fromResult(storedField(decodeSlotOwnerCommitSeq(stored.ownerCommitSeq)));
    if (ownerCommitSeq > stored.publishedThrough) {
      if (pendingCommitSeq === undefined)
        return yield* Effect.fail(corruption("slot owner is not a published live revision"));
      const pending = yield* Effect.fromResult(storedField(decodeSlotOwnerCommitSeq(pendingCommitSeq)));
      if (pending !== stored.publishedThrough + 1n || ownerCommitSeq !== pending)
        return yield* Effect.fail(corruption("slot owner is not the pending publication revision"));
    }
    const row = yield* Effect.fromResult(storedField(decodeStoredClaimRowResult(stored.claim)));
    yield* Effect.fromResult(compareStoredKeyResult(row, expected, identity.constraintId));
    const claim = yield* Effect.fromResult(decodeStoredClaimResult(identity.scopeId, row, expected));
    if (claim.scopeUuid !== scope.scopeUuid || claim.constraintId !== identity.constraintId) {
      return yield* Effect.fail(corruption("slot lookup returned a foreign identity"));
    }

  if (ownerCommitSeq > stored.publishedThrough && stored.pendingFact !== true)
    return yield* Effect.fail(corruption("pending slot owner has no publication fact"));
  return Object.freeze({ ...claim, ownerCommitSeq });
});

type SlotReadError = Effect.Error<ReturnType<typeof prepareSlotRead>> |
  Effect.Error<ReturnType<typeof authenticateSlotRead>> | AppUniqueKeyPersistenceError;
type SlotOwner = Effect.Success<ReturnType<typeof authenticateSlotRead>>;

/** One committed slot and its exact current revision share a statement cut.
 * Slot authentication precedes consumer checks and lazy canonical body decoding.
 * Pending publication ownership remains with the separate slot-batch owner. */
export const withCommittedAppUniqueKeyRowInTransactionEffect = Effect.fn("AppUniqueKeys.withCommittedOwnerRow")(
  function* <Value, Failure, Requirements>(tx: AppUniqueKeyTransaction,
    input: Omit<SlotReadInput, "pendingCommitSeq"> & CurrentAppRowReadLimits & { readonly minimumCommitSeq: CommitSeq },
    slotError: (cause: SlotReadError) => Failure, rowError: (cause: ReadAppRowError) => Failure,
    use: (capture: Readonly<{ owner: Option.Option<SlotOwner>;
      readOwner: Effect.Effect<Readonly<{ row: AppRowRevisionV1; readAt: CommitSeq }>, Failure> }>) => Effect.Effect<Value, Failure, Requirements>,
    observer?: Parameters<typeof observeDrizzleQuery<"currentCapture">>[2],
  ): Effect.fn.Return<Value, Failure, Requirements> {
    const prepared = yield* prepareSlotRead(input).pipe(Effect.mapError(slotError));
    const expected = prepared.expected;
    const query = expected === null ? undefined : tx.select({ claim: fxAppUniqueKeys,
      ownerCommitSeq: fxAppRowCurrent.commitSeq, tombstone: fxAppRowRevisions.isTombstone,
      publishedThrough: fxSystemScopeClocks.lastCommitSeq, pendingFact: sql<boolean>`false`,
      ...projectBoundedCurrentAppRowPoint(input, { commitSeq: sql`${fxSystemScopeClocks.lastCommitSeq}`,
        epoch: sql`${fxSystemScopeExecutionAuthorities.epoch}` }),
    }).from(fxAppUniqueKeys).leftJoin(fxAppRowCurrent, and(
      eq(fxAppRowCurrent.scopeUuid, fxAppUniqueKeys.scopeUuid), eq(fxAppRowCurrent.tableId, fxAppUniqueKeys.tableId),
      eq(fxAppRowCurrent.rowId, fxAppUniqueKeys.rowId),
    )).leftJoin(fxAppRowRevisions, and(
      eq(fxAppRowRevisions.scopeUuid, fxAppRowCurrent.scopeUuid), eq(fxAppRowRevisions.tableId, fxAppRowCurrent.tableId),
      eq(fxAppRowRevisions.rowId, fxAppRowCurrent.rowId), eq(fxAppRowRevisions.commitSeq, fxAppRowCurrent.commitSeq),
    )).leftJoin(fxSystemScopeClocks, eq(fxSystemScopeClocks.scopeUuid, fxAppUniqueKeys.scopeUuid)).leftJoin(fxSystemScopeExecutionAuthorities, eq(fxSystemScopeExecutionAuthorities.scopeId, fxSystemScopeClocks.scopeId)).where(and(
      eq(fxAppUniqueKeys.scopeUuid, prepared.scope.scopeUuid), eq(fxAppUniqueKeys.constraintId, prepared.identity.constraintId),
      eq(fxAppUniqueKeys.localeKey, expected.localeKey), eq(fxAppUniqueKeys.canonicalKeySha256, expected.canonicalKeySha256),
    )).limit(2);
    if (query !== undefined) observeDrizzleQuery("currentCapture", query, observer);
    const rows = query === undefined ? [] : yield* persistenceEffect(query).pipe(Effect.mapError(slotError));
    if (rows.length > 1) return yield* Effect.fail(slotError(corruption("one unique-key slot has multiple owners")));
    const stored = rows[0];
    const owner = stored === undefined ? Option.none<SlotOwner>() :
      Option.some(yield* authenticateSlotRead(prepared, stored).pipe(Effect.mapError(slotError)));
    let active = true;
    let decoded: Readonly<{ row: AppRowRevisionV1; readAt: CommitSeq }> | undefined;
    const readOwner = Effect.gen(function* () {
      if (!active || stored === undefined || Option.isNone(owner))
        return yield* Effect.fail(slotError(corruption("committed owner row capture is closed or absent")));
      if (decoded !== undefined) return decoded;
      const captured = yield* decodeCapturedPublishedCurrentAppRowEffect(
        { scopeId: input.scopeId, tableId: owner.value.tableId, rowId: owner.value.rowId }, input, stored,
      ).pipe(Effect.mapError(rowError));
      if (captured.row === null) return yield* Effect.fail(slotError(corruption("slot owner is not a live revision")));
      decoded = Object.freeze({ row: captured.row, readAt: captured.readAt });
      return decoded;
    });
    return yield* use(Object.freeze({ owner, readOwner })).pipe(
      Effect.ensuring(Effect.sync(() => { active = false; })));
  });

/** Exact slots across bounded ordinal demands. Repeated observations retain
 * their consumer order; pending owners require this publication's finished fact. */
export const withAppUniqueKeySlotsInTransactionEffect = Effect.fn("AppUniqueKeys.withSlots")(
  function* <Value, Failure, Requirements>(tx: AppUniqueKeyTransaction, inputs: readonly SlotReadInput[],
    error: (cause: SlotReadError) => Failure,
    use: (capture: Readonly<{ baseOrdinal: number; identities: readonly Result.Result<Readonly<{ tableId: CatalogTableId; rowId: AppRowIdHexV1 }> | null, SlotReadError>[];
      read: (ordinal: number) => Effect.Effect<Option.Option<SlotOwner>, Failure> }>) => Effect.Effect<Value, Failure, Requirements>,
  ): Effect.fn.Return<readonly Value[], Failure, Requirements> {
    const values: Value[] = [];
    for (let offset = 0; offset < inputs.length;) {
      const batch: PreparedSlotRead[] = [];
      let failure: Effect.Error<ReturnType<typeof prepareSlotRead>> | undefined;
      while (offset + batch.length < inputs.length && batch.length < 32) {
        const input = inputs[offset + batch.length];
        if (input === undefined) return yield* Effect.die(new Error("Unique slot batch lost a demand"));
        const result = yield* Effect.result(prepareSlotRead(input));
        if (Result.isFailure(result)) { failure = result.failure; break; }
        batch.push(result.success);
      }
      const selected = batch.filter(prepared => prepared.expected !== null);
      const rows = selected.length === 0 ? [] : yield* persistenceEffect(tx.select({ claim: fxAppUniqueKeys,
        ownerCommitSeq: fxAppRowCurrent.commitSeq, tombstone: fxAppRowRevisions.isTombstone,
        publishedThrough: fxSystemScopeClocks.lastCommitSeq,
        pendingFact: sql<boolean>`exists (select 1 from ${fxSystemCommitAppRowChanges} as fact
          where fact.scope_uuid = ${fxAppUniqueKeys.scopeUuid} and fact.commit_seq = ${fxAppRowCurrent.commitSeq}
            and fact.table_id = ${fxAppUniqueKeys.tableId} and fact.row_id = ${fxAppUniqueKeys.rowId})`,
      }).from(fxAppUniqueKeys).leftJoin(fxAppRowCurrent, and(
        eq(fxAppRowCurrent.scopeUuid, fxAppUniqueKeys.scopeUuid), eq(fxAppRowCurrent.tableId, fxAppUniqueKeys.tableId),
        eq(fxAppRowCurrent.rowId, fxAppUniqueKeys.rowId),
      )).leftJoin(fxAppRowRevisions, and(
        eq(fxAppRowRevisions.scopeUuid, fxAppRowCurrent.scopeUuid), eq(fxAppRowRevisions.tableId, fxAppRowCurrent.tableId),
        eq(fxAppRowRevisions.rowId, fxAppRowCurrent.rowId), eq(fxAppRowRevisions.commitSeq, fxAppRowCurrent.commitSeq),
      )).leftJoin(fxSystemScopeClocks, eq(fxSystemScopeClocks.scopeUuid, fxAppUniqueKeys.scopeUuid)).leftJoin(fxSystemScopeExecutionAuthorities, eq(fxSystemScopeExecutionAuthorities.scopeId, fxSystemScopeClocks.scopeId)).where(or(
        ...selected.map(prepared => and(eq(fxAppUniqueKeys.scopeUuid, prepared.scope.scopeUuid),
          eq(fxAppUniqueKeys.constraintId, prepared.identity.constraintId),
          eq(fxAppUniqueKeys.localeKey, prepared.expected!.localeKey),
          eq(fxAppUniqueKeys.canonicalKeySha256, prepared.expected!.canonicalKeySha256))),
      ))).pipe(Effect.mapError(error));
      for (const row of rows) yield* Effect.fromResult(storedField(decodeSlotCorrelationEnvelope(row)))
        .pipe(Effect.mapError(error));
      const identities = batch.map(prepared => {
        const expected = prepared.expected;
        if (expected === null) return Result.succeed(null);
        const matches = rows.filter(row => row.claim.scopeUuid === prepared.scope.scopeUuid &&
          row.claim.constraintId === prepared.identity.constraintId && row.claim.localeKey === expected.localeKey &&
          bytesEqualFullScan(row.claim.canonicalKeySha256, expected.canonicalKeySha256));
        if (matches.length > 1) return Result.fail(corruption("one unique-key slot has multiple owners"));
        const stored = matches[0];
        return stored === undefined ? Result.succeed(null) : Result.gen(function* () {
          const tableId = yield* storedField(decodeTableIdResult(stored.claim.tableId));
          const rowId = yield* storedField(appRowIdHexV1FromBytesResult(stored.claim.rowId));
          return Object.freeze({ tableId, rowId });
        });
      });
      let active = true;
      const read = Effect.fn("AppUniqueKeys.readCapturedSlotOrdinal")(function* (ordinal: number) {
        if (!active || !Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= batch.length)
          return yield* Effect.fail(error(corruption("unique slot capture is closed or ordinal is invalid")));
        const prepared = batch[ordinal];
        if (prepared === undefined) return yield* Effect.die(new Error("Unique slot batch lost a prepared demand"));
        const expected = prepared.expected;
        const matches = expected === null ? [] : rows.filter(row => row.claim.scopeUuid === prepared.scope.scopeUuid &&
          row.claim.constraintId === prepared.identity.constraintId && row.claim.localeKey === expected.localeKey &&
          bytesEqualFullScan(row.claim.canonicalKeySha256, expected.canonicalKeySha256));
        if (matches.length > 1) return yield* Effect.fail(error(corruption("one unique-key slot has multiple owners")));
        const stored = matches[0];
        const owner = stored === undefined ? Option.none<SlotOwner>() :
          Option.some(yield* authenticateSlotRead(prepared, stored).pipe(Effect.mapError(error)));
        return owner;
      });
      values.push(yield* use(Object.freeze({ baseOrdinal: offset, identities: Object.freeze(identities), read }))
        .pipe(Effect.ensuring(Effect.sync(() => { active = false; }))));
      offset += batch.length;
      if (failure !== undefined) return yield* Effect.fail(error(failure));
    }
    return Object.freeze(values);
  });

export const consumeAppUniqueKeySlotsInTransactionEffect = Effect.fn("AppUniqueKeys.consumeSlots")(
  function* <Failure, Requirements>(tx: AppUniqueKeyTransaction, inputs: readonly SlotReadInput[],
    error: (cause: SlotReadError) => Failure,
    consume: (ordinal: number, owner: Option.Option<SlotOwner>) => Effect.Effect<void, Failure, Requirements>,
  ): Effect.fn.Return<void, Failure, Requirements> {
    yield* withAppUniqueKeySlotsInTransactionEffect(tx, inputs, error, capture => Effect.gen(function* () {
      for (let ordinal = 0; ordinal < capture.identities.length; ordinal++)
        yield* consume(capture.baseOrdinal + ordinal, yield* capture.read(ordinal));
    }));
  });

const readSlot = Effect.fn("AppUniqueKeys.readSlotState")(function* (
  tx: AppUniqueKeyTransaction, input: Omit<SlotReadInput, "pendingCommitSeq">, pendingCommitSeq?: CommitSeq,
) {
  let selected = Option.none<SlotOwner>();
  yield* consumeAppUniqueKeySlotsInTransactionEffect(tx, [{ ...input,
    ...(pendingCommitSeq === undefined ? {} : { pendingCommitSeq }) }], cause => cause,
    (_ordinal, owner) => { selected = owner; return Effect.void; });
  return selected;
});

/** Authenticate current ownership before a writer may omit an unchanged-key operation. */
export const readAppUniqueKeyOwnersInTransactionEffect = Effect.fn(
  "AppUniqueKeys.readOwners",
)(function* (
  tx: AppUniqueKeyTransaction,
  input: {
    readonly scopeId: ScopeId;
    readonly positions: readonly {
      readonly constraintId: AppUniqueConstraintIdV1;
      readonly tableId: CatalogTableId;
      readonly rowId: AppRowIdHexV1;
      readonly componentCount: number;
    }[];
  },
) {
  const scope = yield* Effect.fromResult(
    projectScopeIdUuidV1Result(input.scopeId),
  ).pipe(Effect.mapError((cause) => invalid("invalidScopeId", cause)));
  const positions = yield* Effect.fromResult(
    decodeOwnerPositionsResult(input.positions),
  ).pipe(Effect.mapError((cause) => invalid("invalidTransition", cause)));
  if (positions.length === 0) return Object.freeze([]);
  const claims: (AppUniqueKeyClaimV1 & {
    readonly projection: AppUniqueKeyProjectionV1;
  })[] = [];
  for (let offset = 0; offset < positions.length; offset += 32) {
    const batch = positions.slice(offset, offset + 32);
    const rows = yield* persistenceEffect(
      tx
        .select()
        .from(fxAppUniqueKeys)
        .where(
          and(
            eq(fxAppUniqueKeys.scopeUuid, scope.scopeUuid),
            or(
              ...batch.map((position) =>
                and(
                  eq(fxAppUniqueKeys.constraintId, position.constraintId),
                  eq(fxAppUniqueKeys.tableId, position.tableId),
                  eq(fxAppUniqueKeys.rowId, appRowIdHexV1ToBytes(position.rowId)),
                ),
              ),
            ),
          ),
        )
        .orderBy(
          fxAppUniqueKeys.constraintId,
          fxAppUniqueKeys.tableId,
          fxAppUniqueKeys.rowId,
          fxAppUniqueKeys.localeKey,
        )
        .limit(batch.length + 1),
    );
    if (rows.length > batch.length)
      return yield* Effect.fail(
        corruption("owner lookup exceeds its fixed claim bound"),
      );
    for (const stored of rows) {
      const rowId = yield* Effect.fromResult(
        storedField(appRowIdHexV1FromBytesResult(stored.rowId)),
      );
      const position = batch.find(
        (value) =>
          value.constraintId === stored.constraintId &&
          value.tableId === stored.tableId &&
          value.rowId === rowId,
      );
      if (!position)
        return yield* Effect.fail(
          corruption("lookup returned an unrequested owner"),
        );
      claims.push(
        yield* authenticateStoredClaimEffect(
          input.scopeId,
          stored,
          position.componentCount,
        ),
      );
    }
  }
  return Object.freeze(claims);
});

const authenticateStoredClaimEffect = Effect.fn(
  "AppUniqueKeys.authenticateStoredClaim",
)(function* (scopeId: ScopeId, stored: StoredClaimRow, componentCount: number) {
  const row = yield* Effect.fromResult(
    decodeStoredValidationClaimResult(stored),
  );
  const projection = yield* Effect.fromResult(
    Result.try({
      try: () => {
        const values = decodeOrderedIndexComponentsV1(
          orderedIndexKeyBytesHexV1FromBytes(row.encodedKeyBytes),
          componentCount,
        );
        const locale = values[0];
        if (
          !(row.localeKey === ""
            ? locale?.kind === "missing"
            : locale?.kind === "string" && locale.value === row.localeKey)
        )
          throw corruption("key locale differs from its slot");
        return {
          sparse: false,
          localeKey: row.localeKey === "" ? null : row.localeKey,
          values: values.slice(1),
        };
      },
      catch: (cause) => corruption("stored key components are invalid", cause),
    }),
  );
  const canonical = yield* Effect.fromResult(
    canonicalizeAppUniqueKeyV1Result(projection),
  ).pipe(
    Effect.mapError((cause) =>
      corruption("stored key is not canonical", cause),
    ),
  );
  if (
    canonical.kind !== "claim" ||
    !bytesEqualFullScan(canonical.canonicalKeyBytes, row.encodedKeyBytes)
  )
    return yield* Effect.fail(corruption("stored key is not canonical"));
  const digest = yield* hashBytesEffect(row.encodedKeyBytes, liveSha256);
  if (!bytesEqualFullScan(digest, row.canonicalKeySha256))
    return yield* Effect.fail(
      corruption("stored key digest differs from its bytes"),
    );
  return Object.freeze({
    scopeId,
    scopeUuid: row.scopeUuid,
    constraintId: row.constraintId,
    localeKey: row.localeKey,
    encodedKey: canonical.encodedKey,
    canonicalKeySha256: digest,
    tableId: row.tableId,
    rowId: row.rowId,
    projection: Object.freeze(projection),
  });
});

/** Initial population alone may drain inherited claims, in fixed 16-owner pages. */
export const drainInitialAppUniqueKeyClaimsInTransactionEffect = Effect.fn(
  "AppUniqueKeys.drainInitialClaims",
)(function* (
  tx: AppUniqueKeyTransaction,
  input: {
    readonly scopeId: ScopeId;
    readonly constraintId: AppUniqueConstraintIdV1;
    readonly authorityEpoch: ScopeEpoch;
    readonly attemptFence: import("flarex-protocol/internal/app-unique-constraint-set-v1").AppUniqueConstraintSetBuildAttemptFenceV1;
  },
) {
  const scope = yield* Effect.fromResult(
    projectScopeIdUuidV1Result(input.scopeId),
  ).pipe(Effect.mapError((cause) => invalid("invalidScopeId", cause)));
  yield* requireScopeAuthorityEffect(
    tx,
    input.scopeId,
    scope.scopeUuid,
    input.authorityEpoch,
  );
  const builds = yield* persistenceEffect(
    tx
      .select({ scopeId: fxSystemUniqueConstraintBuilds.scopeId })
      .from(fxSystemUniqueConstraintBuilds)
      .innerJoin(
        fxSystemScopeExecutionAuthorities,
        and(
          eq(
            fxSystemUniqueConstraintBuilds.scopeId,
            fxSystemScopeExecutionAuthorities.scopeId,
          ),
          eq(
            fxSystemUniqueConstraintBuilds.storageGeneration,
            fxSystemScopeExecutionAuthorities.storageGeneration,
          ),
          eq(
            fxSystemUniqueConstraintBuilds.storageGenerationFence,
            fxSystemScopeExecutionAuthorities.storageGenerationFence,
          ),
        ),
      )
      .where(
        and(
          eq(fxSystemUniqueConstraintBuilds.scopeId, input.scopeId),
          eq(
            fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId,
            input.constraintId,
          ),
          eq(fxSystemUniqueConstraintBuilds.epoch, input.authorityEpoch),
          eq(fxSystemUniqueConstraintBuilds.attemptFence, input.attemptFence),
          eq(fxSystemUniqueConstraintBuilds.lifecycle, "building"),
          isNull(fxSystemUniqueConstraintBuilds.coveredThroughCommitSeq),
        ),
      )
      .limit(1)
      .for("update"),
  );
  if (builds.length !== 1)
    return yield* Effect.fail(
      corruption("initial claim drain has no matching unserved build"),
    );
  const rows = yield* persistenceEffect(
    tx
      .select({
        localeKey: fxAppUniqueKeys.localeKey,
        tableId: fxAppUniqueKeys.tableId,
        rowId: fxAppUniqueKeys.rowId,
      })
      .from(fxAppUniqueKeys)
      .where(
        and(
          eq(fxAppUniqueKeys.scopeUuid, scope.scopeUuid),
          eq(fxAppUniqueKeys.constraintId, input.constraintId),
        ),
      )
      .orderBy(
        fxAppUniqueKeys.localeKey,
        fxAppUniqueKeys.tableId,
        fxAppUniqueKeys.rowId,
      )
      .limit(17),
  );
  const selected = rows.slice(0, 16);
  if (selected.length !== 0) {
    const deleted = yield* persistenceEffect(
      tx
        .delete(fxAppUniqueKeys)
        .where(
          and(
            eq(fxAppUniqueKeys.scopeUuid, scope.scopeUuid),
            eq(fxAppUniqueKeys.constraintId, input.constraintId),
            or(
              ...selected.map((row) =>
                and(
                  eq(fxAppUniqueKeys.localeKey, row.localeKey),
                  eq(fxAppUniqueKeys.tableId, row.tableId),
                  eq(fxAppUniqueKeys.rowId, row.rowId),
                ),
              ),
            ),
          ),
        )
        .returning({ rowId: fxAppUniqueKeys.rowId }),
    );
    if (deleted.length !== selected.length)
      return yield* Effect.fail(
        corruption("initial claim drain changed concurrently"),
      );
  }
  return Object.freeze({ drained: selected.length, hasMore: rows.length > 16 });
});

function sameStoredIdentity(
  left: StoredClaimRow,
  right: StoredClaimRow,
): boolean {
  return (
    left.scopeUuid === right.scopeUuid &&
    left.constraintId === right.constraintId &&
    left.localeKey === right.localeKey &&
    bytesEqualFullScan(left.canonicalKeySha256, right.canonicalKeySha256)
  );
}

function sameClaimSlot(left: HashedClaimV1, right: HashedClaimV1): boolean {
  return (
    left.localeKey === right.localeKey &&
    bytesEqualFullScan(left.canonicalKeySha256, right.canonicalKeySha256) &&
    bytesEqualFullScan(left.canonicalKeyBytes, right.canonicalKeyBytes)
  );
}

function projectMutation(
  status: "claimed" | "unchanged",
  mutation: DecodedMutationV1,
): ApplyAppUniqueKeyMutationV1Result {
  const claim = mutation.next!;
  return Object.freeze({
    status,
    claim: Object.freeze({
      scopeId: mutation.scopeId,
      scopeUuid: mutation.scopeUuid,
      constraintId: mutation.constraintId,
      localeKey: claim.localeKey,
      encodedKey: claim.encodedKey,
      canonicalKeySha256: new Uint8Array(claim.canonicalKeySha256),
      tableId: mutation.tableId,
      rowId: mutation.rowId,
    }),
  });
}

function persistenceEffect<Value>(
  query: PromiseLike<Value>,
): Effect.Effect<Value, AppUniqueKeyPersistenceError> {
  return Effect.tryPromise({
    try: () => Promise.resolve(query),
    catch: (cause) => new AppUniqueKeyPersistenceError(cause),
  }).pipe(Effect.uninterruptible);
}

function field<Value>(
  result: Result.Result<Value, unknown>,
  issue: InvalidAppUniqueKeyMutationV1Issue,
): Result.Result<Value, InvalidAppUniqueKeyMutationV1Error> {
  return result.pipe(Result.mapError((cause) => invalid(issue, cause)));
}

function storedField<Value>(
  result: Result.Result<Value, unknown>,
): Result.Result<Value, AppUniqueKeyStorageCorruptionError> {
  return result.pipe(
    Result.mapError((cause) =>
      corruption("stored claim column does not decode", cause),
    ),
  );
}

function invalid(
  issue: InvalidAppUniqueKeyMutationV1Issue,
  cause?: InvalidAppUniqueKeyContractV1Error | unknown,
): InvalidAppUniqueKeyMutationV1Error {
  return new InvalidAppUniqueKeyMutationV1Error(issue, cause);
}

function corruption(
  reason: string,
  cause?: unknown,
): AppUniqueKeyStorageCorruptionError {
  return new AppUniqueKeyStorageCorruptionError(
    reason,
    cause === undefined ? undefined : { cause },
  );
}

async function liveSha256(bytes: Uint8Array): Promise<Uint8Array> {
  const owned = new Uint8Array(bytes);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", owned.buffer));
}
