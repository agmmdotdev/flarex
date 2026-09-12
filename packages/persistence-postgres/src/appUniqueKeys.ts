import {
  bytesEqualFullScan,
  isUint8Array,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { and, eq, or, isNull } from "drizzle-orm";
import { Effect, Result, Schema } from "effect";
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
  ScopeIdSchema,
  ScopeUuidV1Schema,
  projectScopeIdUuidV1Result,
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
  type InvalidAppUniqueKeyContractV1Error,
} from "./appUniqueKeyContract";
import type { FlarexMetadataTransaction } from "./metadataTransaction";
import {
  fxAppRowRevisions,
  fxAppRowCurrent,
  fxAppUniqueKeys,
  fxSystemScopeClocks,
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
  | "invalidScopeId"
  | "invalidConstraintId"
  | "invalidTableId"
  | "invalidRowId"
  | "invalidWriteEpoch"
  | "invalidTransition"
  | "invalidPreviousKey"
  | "invalidNextKey";

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
).check(Schema.makeFilter((value) => value.length <= 32));
const decodeOwnerPositionsResult =
  Schema.decodeUnknownResult(OwnerPositionsSchema);

type StoredClaimRow = typeof fxAppUniqueKeys.$inferSelect;

const MATCHED_VALIDATION = Object.freeze({ status: "matched" as const });

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

/**
 * Transaction-only S11 primitive. It never resolves a semantic constraint or
 * starts a transaction; C08 later supplies trusted constraint lowering inside
 * the existing commit owner. All exact mutation replay belongs to the outer
 * point-commit idempotency/outcome owner because current terminal state cannot
 * authenticate identical prior-claim facts. Repeated local mutations fail
 * closed. SQL rejection remains rejection so the caller's transaction rolls
 * back.
 */
export const applyAppUniqueKeyMutationInTransactionEffect = Effect.fn(
  "AppUniqueKeys.applyMutationInTransaction",
)(function* (
  tx: AppUniqueKeyTransaction,
  input: ApplyAppUniqueKeyMutationV1Input,
  sha256: AppUniqueKeySha256V1 = liveSha256,
) {
  const mutation = yield* prepareMutationEffect(tx, input, sha256);

  let nextStoredRow: StoredClaimRow | null = null;
  if (mutation.next !== null) {
    nextStoredRow = yield* readClaimSlotForUpdateEffect(
      tx,
      mutation,
      mutation.next,
    );
  }
  if (nextStoredRow !== null) {
    yield* Effect.fromResult(
      compareStoredKeyResult(
        nextStoredRow,
        mutation.next!,
        mutation.constraintId,
      ),
    );
    const decodedNext = yield* Effect.fromResult(
      decodeStoredClaimResult(mutation.scopeId, nextStoredRow, mutation.next!),
    );
    if (!isPreviousOwner(decodedNext, mutation)) {
      return yield* Effect.fail(
        new AppUniqueKeyConflictError(
          mutation.constraintId,
          mutation.next!.localeKey,
          decodedNext.tableId,
          decodedNext.rowId,
        ),
      );
    }
  }

  const ownerRows = yield* persistenceEffect(
    tx
      .select()
      .from(fxAppUniqueKeys)
      .where(
        and(
          eq(fxAppUniqueKeys.scopeUuid, mutation.scopeUuid),
          eq(fxAppUniqueKeys.constraintId, mutation.constraintId),
          eq(fxAppUniqueKeys.localeKey, ownerLocaleKey(mutation)),
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
  const owner = ownerRows[0] ?? null;

  if (mutation.previous === null) {
    if (owner !== null) {
      return yield* Effect.fail(
        new AppUniqueKeyPreviousClaimMismatchError(
          mutation.constraintId,
          mutation.rowId,
        ),
      );
    }
  } else {
    const previousStored = yield* readClaimSlotForUpdateEffect(
      tx,
      mutation,
      mutation.previous,
    );
    if (previousStored === null || owner === null) {
      return yield* Effect.fail(
        new AppUniqueKeyPreviousClaimMismatchError(
          mutation.constraintId,
          mutation.rowId,
        ),
      );
    }
    yield* Effect.fromResult(
      compareStoredKeyResult(
        previousStored,
        mutation.previous,
        mutation.constraintId,
      ),
    );
    const decodedPrevious = yield* Effect.fromResult(
      decodeStoredClaimResult(
        mutation.scopeId,
        previousStored,
        mutation.previous,
      ),
    );
    if (
      !isPreviousOwner(decodedPrevious, mutation) ||
      !sameStoredIdentity(previousStored, owner)
    ) {
      return yield* Effect.fail(
        new AppUniqueKeyPreviousClaimMismatchError(
          mutation.constraintId,
          mutation.rowId,
        ),
      );
    }
  }

  if (
    mutation.previous !== null &&
    mutation.next !== null &&
    sameClaimSlot(mutation.previous, mutation.next)
  ) {
    return projectMutation("unchanged", mutation);
  }

  if (mutation.previous !== null) {
    const deleted = yield* persistenceEffect(
      tx
        .delete(fxAppUniqueKeys)
        .where(
          and(
            eq(fxAppUniqueKeys.scopeUuid, mutation.scopeUuid),
            eq(fxAppUniqueKeys.constraintId, mutation.constraintId),
            eq(fxAppUniqueKeys.localeKey, mutation.previous!.localeKey),
            eq(
              fxAppUniqueKeys.canonicalKeySha256,
              mutation.previous!.canonicalKeySha256,
            ),
            eq(fxAppUniqueKeys.tableId, mutation.tableId),
            eq(fxAppUniqueKeys.rowId, mutation.rowIdBytes),
          ),
        )
        .returning({ rowId: fxAppUniqueKeys.rowId }),
    );
    if (deleted[0] === undefined) {
      return yield* Effect.fail(
        new AppUniqueKeyPreviousClaimMismatchError(
          mutation.constraintId,
          mutation.rowId,
        ),
      );
    }
  }

  if (mutation.next === null) {
    return Object.freeze({
      status: mutation.previous === null ? "omitted" : "released",
      claim: null,
    });
  }
  yield* persistenceEffect(
    tx.insert(fxAppUniqueKeys).values({
      scopeUuid: mutation.scopeUuid,
      constraintId: mutation.constraintId,
      localeKey: mutation.next!.localeKey,
      canonicalKeySha256: mutation.next!.canonicalKeySha256,
      keyCodecVersion: APP_UNIQUE_KEY_CODEC_VERSION_V1,
      encodedKey: mutation.next!.canonicalKeyBytes,
      tableId: mutation.tableId,
      rowId: mutation.rowIdBytes,
    }),
  );
  return projectMutation("claimed", mutation);
});

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

  yield* persistenceEffect(
    tx.insert(fxAppUniqueKeys).values({
      scopeUuid: mutation.scopeUuid,
      constraintId: mutation.constraintId,
      localeKey: claim.localeKey,
      canonicalKeySha256: claim.canonicalKeySha256,
      keyCodecVersion: APP_UNIQUE_KEY_CODEC_VERSION_V1,
      encodedKey: claim.canonicalKeyBytes,
      tableId: mutation.tableId,
      rowId: mutation.rowIdBytes,
    }),
  );
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
  const scope = yield* persistenceEffect(
    tx
      .select({
        scopeUuid: fxSystemScopeClocks.scopeUuid,
        epoch: fxSystemScopeClocks.epoch,
      })
      .from(fxSystemScopeClocks)
      .where(eq(fxSystemScopeClocks.scopeId, scopeId))
      .limit(1),
  );
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
  const rows = yield* persistenceEffect(
    tx
      .select()
      .from(fxAppUniqueKeys)
      .where(
        and(
          eq(fxAppUniqueKeys.scopeUuid, scope.scopeUuid),
          or(
            ...positions.map((position) =>
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
      .limit(positions.length + 1),
  );
  if (rows.length > positions.length)
    return yield* Effect.fail(
      corruption("owner lookup exceeds its fixed claim bound"),
    );
  const claims: (AppUniqueKeyClaimV1 & {
    readonly projection: AppUniqueKeyProjectionV1;
  })[] = [];
  for (const stored of rows) {
    const rowId = yield* Effect.fromResult(
      storedField(appRowIdHexV1FromBytesResult(stored.rowId)),
    );
    const position = positions.find(
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
        fxSystemScopeClocks,
        and(
          eq(
            fxSystemUniqueConstraintBuilds.scopeId,
            fxSystemScopeClocks.scopeId,
          ),
          eq(
            fxSystemUniqueConstraintBuilds.storageGeneration,
            fxSystemScopeClocks.storageGeneration,
          ),
          eq(
            fxSystemUniqueConstraintBuilds.storageGenerationFence,
            fxSystemScopeClocks.storageGenerationFence,
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

function isPreviousOwner(
  claim: AppUniqueKeyClaimV1,
  mutation: DecodedMutationV1,
): boolean {
  return (
    mutation.previous !== null &&
    claim.tableId === mutation.tableId &&
    claim.rowId === mutation.rowId
  );
}

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

function ownerLocaleKey(mutation: DecodedMutationV1): string {
  return mutation.next?.localeKey ?? mutation.previous?.localeKey ?? "";
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
