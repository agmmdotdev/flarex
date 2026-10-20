import type { ScopeId, CommitSeq } from "flarex-protocol/storage-authority";
import type { AppIndexEntryIdentityV1 } from "./appIndexEntries";

export type InvalidAppIndexEntryInputIssue =
  | "rowCountExceeded"
  | "invalidBatch"
  | "invalidScopeId"
  | "invalidKind"
  | "invalidLocatedDefinition"
  | "invalidEncodedKey"
  | "invalidRowId"
  | "invalidWriteEpoch"
  | "invalidCommitSeq"
  | "invalidBounds"
  | "invalidCursor"
  | "invalidLimit"
  | "invalidSnapshotCommitSeq";

export class InvalidAppIndexEntryInputError extends Error {
  readonly _tag = "InvalidAppIndexEntryInputError" as const;

  constructor(
    readonly issue: InvalidAppIndexEntryInputIssue,
    readonly cause?: unknown,
  ) {
    super(`Invalid app-index entry input: ${issue}.`, { cause });
    this.name = "InvalidAppIndexEntryInputError";
  }
}

export class AppIndexEntryScopeAuthorityUnavailableError extends Error {
  readonly _tag = "AppIndexEntryScopeAuthorityUnavailableError" as const;

  constructor(readonly scopeId: ScopeId) {
    super(`App-index entry scope authority is unavailable: ${scopeId}`);
    this.name = "AppIndexEntryScopeAuthorityUnavailableError";
  }
}

export class AppIndexEntryRevisionAlreadyExistsError extends Error {
  readonly _tag = "AppIndexEntryRevisionAlreadyExistsError" as const;

  constructor(
    readonly identity: AppIndexEntryIdentityV1,
    readonly commitSeq: CommitSeq,
  ) {
    super(
      `App-index entry revision already exists at ${identity.scopeId}/` +
        `${identity.indexDefinitionId}/${identity.encodedKey}/` +
        `${identity.rowId}/${commitSeq}`,
    );
    this.name = "AppIndexEntryRevisionAlreadyExistsError";
  }
}

export class AppIndexEntryTransitionConflictError extends Error {
  readonly _tag = "AppIndexEntryTransitionConflictError" as const;
  constructor(
    readonly identity: AppIndexEntryIdentityV1,
    readonly commitSeq: CommitSeq,
    readonly actualHeadCommitSeq: CommitSeq | null,
  ) {
    super(
      `Invalid membership transition at ${identity.scopeId}/${identity.indexDefinitionId}/${identity.rowId}/${commitSeq}; latest ${actualHeadCommitSeq ?? "missing"}.`,
    );
    this.name = "AppIndexEntryTransitionConflictError";
  }
}

export class AppIndexEntryParentRowError extends Error {
  readonly _tag = "AppIndexEntryParentRowError" as const;
  constructor(
    readonly identity: AppIndexEntryIdentityV1,
    readonly reason: "missing" | "tombstonedLiveEntry",
  ) {
    super(
      `App-index parent row identity is ${reason} at ${identity.scopeId}/${identity.tableId}/${identity.rowId}.`,
    );
    this.name = "AppIndexEntryParentRowError";
  }
}

export class AppIndexEntryHashError extends Error {
  readonly _tag = "AppIndexEntryHashError" as const;

  constructor(
    readonly operation: "append" | "read",
    readonly cause: unknown,
  ) {
    super(`App-index entry SHA-256 ${operation} operation failed.`, { cause });
    this.name = "AppIndexEntryHashError";
  }
}

export class AppIndexEntryStorageCorruptionError extends Error {
  readonly _tag = "AppIndexEntryStorageCorruptionError" as const;

  constructor(
    readonly reason: string,
    options?: ErrorOptions,
  ) {
    super(`App-index entry storage is invalid: ${reason}.`, options);
    this.name = "AppIndexEntryStorageCorruptionError";
  }
}

export class AppIndexEntryReadPersistenceError extends Error {
  readonly _tag = "AppIndexEntryReadPersistenceError" as const;

  constructor(
    readonly operation: "readScopeAuthority" | "scanSnapshot" | "scanCurrent" | "scanRetained",
    readonly cause: unknown,
  ) {
    super(`App-index entry ${operation} query failed.`, { cause });
    this.name = "AppIndexEntryReadPersistenceError";
  }
}

export class AppIndexEntryWritePersistenceError extends Error {
  readonly _tag = "AppIndexEntryWritePersistenceError" as const;
  constructor(readonly cause: unknown) {
    super("App-index entry append query failed.", { cause });
    this.name = "AppIndexEntryWritePersistenceError";
  }
}

export type AppendAppIndexEntryRevisionV1Error =
  | InvalidAppIndexEntryInputError
  | AppIndexEntryScopeAuthorityUnavailableError
  | AppIndexEntryRevisionAlreadyExistsError
  | AppIndexEntryTransitionConflictError
  | AppIndexEntryParentRowError
  | AppIndexEntryWritePersistenceError
  | AppIndexEntryReadPersistenceError
  | AppIndexEntryHashError
  | AppIndexEntryStorageCorruptionError;

export function isAppendAppIndexEntryRevisionV1Error(
  value: unknown,
): value is AppendAppIndexEntryRevisionV1Error {
  return (
    value instanceof InvalidAppIndexEntryInputError ||
    value instanceof AppIndexEntryScopeAuthorityUnavailableError ||
    value instanceof AppIndexEntryRevisionAlreadyExistsError ||
    value instanceof AppIndexEntryTransitionConflictError ||
    value instanceof AppIndexEntryParentRowError ||
    value instanceof AppIndexEntryWritePersistenceError ||
    value instanceof AppIndexEntryReadPersistenceError ||
    value instanceof AppIndexEntryHashError ||
    value instanceof AppIndexEntryStorageCorruptionError
  );
}
