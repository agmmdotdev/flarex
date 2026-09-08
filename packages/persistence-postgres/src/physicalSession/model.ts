import type { Cause, Effect } from "effect";
import type { FlarexMetadataDatabase } from "../deployments";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import type { PhysicalDeadline } from "./deadline";

const physicalConnectionIdentityBrand: unique symbol = Symbol(
  "FlarexDB/PhysicalConnectionIdentity",
);
export interface PhysicalConnectionIdentity {
  readonly [physicalConnectionIdentityBrand]: true;
}
/** Identity only: this does not issue database or transaction authority. */
export function makePhysicalConnectionIdentity(): PhysicalConnectionIdentity {
  return Object.freeze({
    [physicalConnectionIdentityBrand]: true,
  } satisfies PhysicalConnectionIdentity);
}
export type PhysicalDeadlineKind = "read" | "initial" | "recovery";

export type PhysicalSessionPhase =
  | "acquire"
  | "configureReadBudget"
  | "read"
  | "resetReadBudget"
  | "begin"
  | "isolation"
  | "configureTransactionBudget"
  | "callback"
  | "commit"
  | "rollback"
  | "release"
  | "quarantine";

export interface PhysicalResourceFields {
  readonly phase: PhysicalSessionPhase;
  readonly cause: unknown;
  readonly cleanupCause?: unknown;
}
export interface PhysicalDeadlineFields {
  readonly deadlineKind: PhysicalDeadlineKind;
  readonly phase: PhysicalSessionPhase;
}
export interface PhysicalDeadlineErrors<DeadlineIssue> {
  readonly deadline: (fields: PhysicalDeadlineFields) => DeadlineIssue;
  readonly invariant: (fields: {
    readonly reason: "invalidDeadline" | "invalidDeadlineDuration";
  }) => unknown;
}
/** The adapter supplies its error projection at emission, preserving nested Cause identity. */
export interface PhysicalSessionErrors<
  ResourceIssue,
  DeadlineIssue,
> extends PhysicalDeadlineErrors<DeadlineIssue> {
  readonly resource: (fields: PhysicalResourceFields) => ResourceIssue;
  readonly cleanup: (fields: {
    readonly phase: "rollback" | "release" | "quarantine";
    readonly cause: unknown;
  }) => unknown;
}
export type PhysicalSessionQuarantine =
  | Readonly<{
      readonly kind: "confirmed";
      readonly excludedConnectionIdentity: PhysicalConnectionIdentity;
    }>
  | Readonly<{
      readonly kind: "failed";
      readonly cause: unknown;
    }>;

export type PhysicalInitialSettlement<Value, Failure, ResourceIssue> =
  | Readonly<{ readonly kind: "committed"; readonly value: Value }>
  | Readonly<{
      readonly kind: "callbackRolledBack";
      readonly callbackCause: Cause.Cause<Failure | ResourceIssue>;
    }>
  | Readonly<{
      readonly kind: "callbackCleanupFailed";
      readonly callbackCause: Cause.Cause<Failure | ResourceIssue>;
      readonly cleanupCause: Cause.Cause<never>;
    }>
  | Readonly<{
      readonly kind: "notCommitted";
      readonly cause: Cause.Cause<ResourceIssue>;
    }>
  | Readonly<{
      readonly kind: "uncertain";
      readonly value: Value;
      readonly initialSettlementCause: unknown;
      readonly recoveryDeadline: PhysicalDeadline;
      readonly quarantine: PhysicalSessionQuarantine;
    }>;

export type PhysicalRecoveryResolution<Failure, ResourceIssue> =
  | Readonly<{
      readonly kind: "callback";
      readonly cause: Cause.Cause<Failure | ResourceIssue>;
    }>
  | Readonly<{
      readonly kind: "lifecycle";
      readonly cause: Cause.Cause<ResourceIssue>;
    }>;

export type PhysicalRecoverySettlement<Value, Failure, ResourceIssue> =
  | Readonly<{ readonly kind: "committed"; readonly value: Value }>
  | Readonly<{
      readonly kind: "unresolved";
      readonly resolution: PhysicalRecoveryResolution<Failure, ResourceIssue>;
    }>;

export interface PhysicalReadInput {
  readonly deadline: PhysicalDeadline;
}

export type PhysicalRestore = <Value, Failure>(
  effect: Effect.Effect<Value, Failure, never>,
) => Effect.Effect<Value, Failure, never>;

export interface PhysicalInitialTransactionInput {
  readonly deadline: PhysicalDeadline;
  readonly lockTimeoutMilliseconds: number;
  readonly recoveryTimeoutMilliseconds: number;
}

export interface PhysicalRecoveryTransactionInput {
  readonly deadline: PhysicalDeadline;
  readonly lockTimeoutMilliseconds: number;
  readonly excludedConnectionIdentity: PhysicalConnectionIdentity;
}

export interface PhysicalSessionDriver<ResourceIssue> {
  readonly runReadEffect: <Value, Failure>(
    input: PhysicalReadInput,
    work: (
      database: FlarexMetadataDatabase,
    ) => Effect.Effect<Value, Failure, never>,
  ) => Effect.Effect<Value, Failure | ResourceIssue, never>;
  readonly runInitialTransactionEffect: <Value, Failure>(
    input: PhysicalInitialTransactionInput,
    restore: PhysicalRestore,
    work: (
      transaction: FlarexMetadataTransaction,
    ) => Effect.Effect<Value, Failure, never>,
  ) => Effect.Effect<
    PhysicalInitialSettlement<Value, Failure, ResourceIssue>,
    never,
    never
  >;
  readonly runRecoveryTransactionEffect: <Value, Failure>(
    input: PhysicalRecoveryTransactionInput,
    work: (
      transaction: FlarexMetadataTransaction,
    ) => Effect.Effect<Value, Failure, never>,
  ) => Effect.Effect<
    PhysicalRecoverySettlement<Value, Failure, ResourceIssue>,
    never,
    never
  >;
}
