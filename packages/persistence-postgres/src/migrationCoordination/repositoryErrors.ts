import { Data } from "effect";

export type FrameworkMigrationRepositoryOperation =
  | "ensureTargetNamespace"
  | "readTargetNamespace"
  | "ensureCollisionDomain"
  | "readCollisionDomain"
  | "ensurePhysicalNameAssignment"
  | "readPhysicalNameAssignment"
  | "ensurePlan"
  | "readPlan"
  | "ensureAdmission"
  | "readAdmission"
  | "ensureAttemptStart"
  | "readAttemptStart"
  | "ensureStepReceipt"
  | "readStepReceipt"
  | "ensureAttemptTerminal"
  | "readAttemptTerminal";

export type FrameworkMigrationRepositoryReason =
  | "immutableConflict"
  | "physicalNameCollision"
  | "referenceRefusal"
  | "storedCorruption"
  | "resourceFailure";

interface FrameworkMigrationRepositoryErrorCommon {
  readonly operation: FrameworkMigrationRepositoryOperation;
  readonly reason: FrameworkMigrationRepositoryReason;
  readonly message: string;
}

class FrameworkMigrationRepositoryExpectedError extends Data.TaggedError(
  "FrameworkMigrationRepositoryError",
)<FrameworkMigrationRepositoryErrorCommon & Readonly<{
  readonly reason:
    | "immutableConflict"
    | "referenceRefusal"
    | "storedCorruption";
  readonly cause?: never;
  readonly spelling?: never;
}>> {}

class FrameworkMigrationRepositoryPhysicalNameCollisionError extends
  Data.TaggedError(
    "FrameworkMigrationRepositoryError",
  )<FrameworkMigrationRepositoryErrorCommon & Readonly<{
    readonly reason: "physicalNameCollision";
    readonly spelling: string;
    readonly cause?: never;
  }>> {}

class FrameworkMigrationRepositoryResourceError extends Data.TaggedError(
  "FrameworkMigrationRepositoryError",
)<FrameworkMigrationRepositoryErrorCommon & Readonly<{
  readonly reason: "resourceFailure";
  readonly cause: unknown;
  readonly spelling?: never;
}>> {}

export type FrameworkMigrationRepositoryError =
  | FrameworkMigrationRepositoryExpectedError
  | FrameworkMigrationRepositoryPhysicalNameCollisionError
  | FrameworkMigrationRepositoryResourceError;

export const FrameworkMigrationRepositoryError = Object.freeze({
  immutableConflict(
    operation: FrameworkMigrationRepositoryOperation,
  ): FrameworkMigrationRepositoryError {
    return new FrameworkMigrationRepositoryExpectedError({
      operation,
      reason: "immutableConflict",
      message: "Framework migration metadata conflicts with stored evidence",
    });
  },

  physicalNameCollision(
    operation: FrameworkMigrationRepositoryOperation,
    spelling: string,
  ): FrameworkMigrationRepositoryError {
    return new FrameworkMigrationRepositoryPhysicalNameCollisionError({
      operation,
      reason: "physicalNameCollision",
      message: "Relational physical name is assigned to another preimage",
      spelling,
    });
  },

  referenceRefusal(
    operation: FrameworkMigrationRepositoryOperation,
  ): FrameworkMigrationRepositoryError {
    return new FrameworkMigrationRepositoryExpectedError({
      operation,
      reason: "referenceRefusal",
      message: "Framework migration metadata reference was refused",
    });
  },

  storedCorruption(
    operation: FrameworkMigrationRepositoryOperation,
  ): FrameworkMigrationRepositoryError {
    return new FrameworkMigrationRepositoryExpectedError({
      operation,
      reason: "storedCorruption",
      message: "Stored framework migration metadata is corrupt",
    });
  },

  resourceFailure(
    operation: FrameworkMigrationRepositoryOperation,
    cause: unknown,
  ): FrameworkMigrationRepositoryError {
    return new FrameworkMigrationRepositoryResourceError({
      operation,
      reason: "resourceFailure",
      message: "Framework migration metadata repository failed",
      cause,
    });
  },
});
