import type { ScopeId, CommitSeq } from "flarex-protocol/storage-authority";
import type { AppRowIdentityV1 } from "./appRows";
import type { AppCreationTimeV1 } from "flarex-protocol/app-document";

export class InvalidAppRowRevisionV1InputError extends Error {
  constructor(
    readonly issue:
      | { readonly reason: "nonPositiveCommitSeq"; readonly value: bigint }
      | {
          readonly reason: "invalidPreviousCommitSeq";
          readonly value: bigint;
          readonly commitSeq: bigint;
        },
  ) {
    super(
      issue.reason === "nonPositiveCommitSeq"
        ? `App-row revision commit sequence must be positive: ${issue.value}`
        : `App-row previous commit sequence ${issue.value} must be positive and less than ${issue.commitSeq}`,
    );
    this.name = "InvalidAppRowRevisionV1InputError";
  }
}

export class AppRowScopeAuthorityUnavailableError extends Error {
  readonly _tag = "AppRowScopeAuthorityUnavailableError" as const;

  constructor(readonly scopeId: ScopeId) {
    super(`Replacement app-row scope authority is unavailable: ${scopeId}`);
    this.name = "AppRowScopeAuthorityUnavailableError";
  }
}

export class AppRowRevisionAlreadyExistsError extends Error {
  constructor(
    readonly identity: AppRowIdentityV1,
    readonly commitSeq: CommitSeq,
  ) {
    super(
      `App-row revision already exists at ${identity.scopeId}/${identity.tableId}/${identity.rowId}/${commitSeq}`,
    );
    this.name = "AppRowRevisionAlreadyExistsError";
  }
}

export class AppRowRevisionChainConflictError extends Error {
  constructor(
    readonly identity: AppRowIdentityV1,
    readonly expectedPrevCommitSeq: CommitSeq | null,
    readonly actualCurrentCommitSeq: CommitSeq | null,
  ) {
    super(
      `App-row current pointer for ${identity.scopeId}/${identity.tableId}/${identity.rowId} is ` +
        `${actualCurrentCommitSeq ?? "missing"}; expected ${expectedPrevCommitSeq ?? "missing"}`,
    );
    this.name = "AppRowRevisionChainConflictError";
  }
}

export class AppRowCreationTimeConflictError extends Error {
  constructor(
    readonly identity: AppRowIdentityV1,
    readonly expectedCreationTime: AppCreationTimeV1,
    readonly actualCreationTime: AppCreationTimeV1,
  ) {
    super(
      `App-row creation time for ${identity.scopeId}/${identity.tableId}/${identity.rowId} is ` +
        `${actualCreationTime}; expected immutable value ${expectedCreationTime}`,
    );
    this.name = "AppRowCreationTimeConflictError";
  }
}

export class AppRowStorageCorruptionError extends Error {
  readonly _tag = "AppRowStorageCorruptionError" as const;

  constructor(
    readonly identity: AppRowIdentityV1,
    readonly reason: string,
    options?: ErrorOptions,
  ) {
    super(
      `App-row storage ${identity.scopeId}/${identity.tableId}/${identity.rowId} is invalid: ${reason}`,
      options,
    );
    this.name = "AppRowStorageCorruptionError";
  }
}

export type AppendAppRowRevisionV1Error =
  | InvalidAppRowRevisionV1InputError
  | AppRowScopeAuthorityUnavailableError
  | AppRowRevisionAlreadyExistsError
  | AppRowRevisionChainConflictError
  | AppRowCreationTimeConflictError
  | AppRowStorageCorruptionError;

export function isAppendAppRowRevisionV1Error(
  cause: unknown,
): cause is AppendAppRowRevisionV1Error {
  return cause instanceof InvalidAppRowRevisionV1InputError ||
    cause instanceof AppRowScopeAuthorityUnavailableError ||
    cause instanceof AppRowRevisionAlreadyExistsError ||
    cause instanceof AppRowRevisionChainConflictError ||
    cause instanceof AppRowCreationTimeConflictError ||
    cause instanceof AppRowStorageCorruptionError;
}
