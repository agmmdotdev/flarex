import { isNonArrayRecord } from "@flarex/utils/records";
import { Data, Effect } from "effect";

import type { FlarexMetadataDatabase } from "../deployments";
import { isBoundedPrivateValueIdentityText } from
  "../frameworkSchema/privateStoredValueShape";
import type { FlarexMetadataTransaction } from "../metadataTransaction";
import type { ScopePhysicalLocator } from "../scopeMetadataTypes";
import { captureFrameworkSchemaTargetNamespace } from "./targetNamespace";
import type { FrameworkSchemaTargetNamespace } from "./targetNamespace";

const frameworkMigrationTargetBrand: unique symbol = Symbol(
  "FlarexDB/FrameworkMigrationTarget",
);
const frameworkMigrationSessionIdentityBrand: unique symbol = Symbol(
  "FlarexDB/FrameworkMigrationSessionIdentity",
);
const frameworkMigrationTransactionBrand: unique symbol = Symbol(
  "FlarexDB/FrameworkMigrationTransaction",
);
const frameworkMigrationSessionDriverBrand: unique symbol = Symbol(
  "FlarexDB/FrameworkMigrationSessionDriver",
);

export interface FrameworkMigrationTarget {
  readonly [frameworkMigrationTargetBrand]: true;
}

export interface FrameworkMigrationSessionIdentity {
  readonly [frameworkMigrationSessionIdentityBrand]: true;
}

export interface FrameworkMigrationTransaction {
  readonly [frameworkMigrationTransactionBrand]: true;
}

export interface FrameworkMigrationSessionDriver {
  readonly [frameworkMigrationSessionDriverBrand]: true;
}

export interface FrameworkMigrationTransactionBudget {
  readonly lockTimeoutMilliseconds: number;
  readonly statementTimeoutMilliseconds: number;
}

export type FrameworkMigrationTransactionRequest =
  | (FrameworkMigrationTransactionBudget & Readonly<{
      readonly kind: "ordinary";
    }>)
  | (FrameworkMigrationTransactionBudget & Readonly<{
      readonly kind: "recovery";
      readonly excludedSessionIdentity: FrameworkMigrationSessionIdentity;
    }>);

export type FrameworkMigrationDriverTransactionRequest =
  & FrameworkMigrationTransactionBudget
  & Readonly<{
    readonly sessionIdentity: FrameworkMigrationSessionIdentity;
  }>
  & (
    | Readonly<{
        readonly kind: "ordinary";
        readonly excludedSessionIdentity: null;
      }>
    | Readonly<{
        readonly kind: "recovery";
        readonly excludedSessionIdentity: FrameworkMigrationSessionIdentity;
      }>
  );

export class FrameworkMigrationTargetCompositionError extends Data.TaggedError(
  "FrameworkMigrationTargetCompositionError",
)<{
  readonly reason:
    | "invalidInput"
    | "invalidDriver"
    | "databaseIdentityConflict"
    | "targetMismatch"
    | "sessionMismatch";
  readonly message: string;
}> {}

export class FrameworkMigrationSessionResourceIssue extends Data.TaggedError(
  "FrameworkMigrationSessionResourceIssue",
)<{
  readonly phase: "beginOrConfigure" | "rollbackOrCleanup";
  readonly cause: unknown;
}> {}

export class FrameworkMigrationDecisionUncertainIssue extends Data.TaggedError(
  "FrameworkMigrationDecisionUncertainIssue",
)<{
  readonly sessionIdentity: FrameworkMigrationSessionIdentity;
  readonly cause: unknown;
}> {}

export type FrameworkMigrationSessionFailure =
  | FrameworkMigrationSessionResourceIssue
  | FrameworkMigrationDecisionUncertainIssue;

export interface FrameworkMigrationTargetInput {
  readonly database: FlarexMetadataDatabase;
  readonly driver: FrameworkMigrationSessionDriver;
  readonly deploymentId: string;
  readonly canonicalPhysicalDatabaseIdentity: string;
  readonly physicalLocator: ScopePhysicalLocator;
}

export interface FrameworkMigrationTargetSnapshot {
  readonly namespace: FrameworkSchemaTargetNamespace;
  readonly physicalLocator: ScopePhysicalLocator;
  readonly capability: "postgres-transactional-relational-structure";
}

export type RunFrameworkMigrationDriverTransaction = <Value, Failure>(
  request: FrameworkMigrationDriverTransactionRequest,
  work: (
    transaction: FlarexMetadataTransaction,
  ) => Effect.Effect<Value, Failure, never>,
) => Effect.Effect<
  Value,
  Failure | FrameworkMigrationSessionFailure,
  never
>;

interface FrameworkMigrationSessionDriverState {
  readonly database: FlarexMetadataDatabase;
  readonly runTransactionEffect: RunFrameworkMigrationDriverTransaction;
}

interface FrameworkMigrationTargetState
  extends FrameworkMigrationTargetSnapshot
{
  readonly database: FlarexMetadataDatabase;
  readonly driver: FrameworkMigrationSessionDriver;
}

interface FrameworkMigrationSessionIdentityState {
  readonly target: FrameworkMigrationTarget;
}

interface FrameworkMigrationTransactionState {
  readonly target: FrameworkMigrationTarget;
  readonly sessionIdentity: FrameworkMigrationSessionIdentity;
  readonly rawTransaction: FlarexMetadataTransaction;
  active: boolean;
}

const driverStates = new WeakMap<
  FrameworkMigrationSessionDriver,
  FrameworkMigrationSessionDriverState
>();
const targetStates = new WeakMap<
  FrameworkMigrationTarget,
  FrameworkMigrationTargetState
>();
const sessionIdentityStates = new WeakMap<
  FrameworkMigrationSessionIdentity,
  FrameworkMigrationSessionIdentityState
>();
const transactionStates = new WeakMap<
  FrameworkMigrationTransaction,
  FrameworkMigrationTransactionState
>();
const physicalDatabaseIdentities = new WeakMap<
  FlarexMetadataDatabase,
  string
>();

export function makeFrameworkMigrationSessionDriver(
  database: FlarexMetadataDatabase,
  runTransactionEffect: RunFrameworkMigrationDriverTransaction,
): FrameworkMigrationSessionDriver {
  const driver = Object.freeze({
    [frameworkMigrationSessionDriverBrand]: true,
  } satisfies FrameworkMigrationSessionDriver);
  driverStates.set(driver, Object.freeze({ database, runTransactionEffect }));
  return driver;
}

export const makeFrameworkMigrationTargetEffect = Effect.fn(
  "FrameworkMigrationTarget.make",
)(function* (
  input: FrameworkMigrationTargetInput,
): Effect.fn.Return<
  FrameworkMigrationTarget,
  FrameworkMigrationTargetCompositionError |
    import("./errors").FrameworkMigrationValueError
> {
  const database = input.database;
  const driver = input.driver;
  const deploymentId = input.deploymentId;
  const canonicalPhysicalDatabaseIdentity =
    input.canonicalPhysicalDatabaseIdentity;
  const physicalLocator = capturePhysicalLocator(input.physicalLocator);
  const driverState = driverStates.get(driver);
  if (
    !isWeakMapKey(database) ||
    driverState === undefined ||
    driverState.database !== database
  ) {
    return yield* Effect.fail(new FrameworkMigrationTargetCompositionError({
      reason: "invalidDriver",
      message: "Framework migration target driver is not bound to its database",
    }));
  }
  if (
    !isIdentityText(canonicalPhysicalDatabaseIdentity) ||
    !isIdentityText(deploymentId) ||
    physicalLocator === undefined
  ) {
    return yield* Effect.fail(new FrameworkMigrationTargetCompositionError({
      reason: "invalidInput",
      message: "Framework migration target input is invalid",
    }));
  }
  const existingIdentity = physicalDatabaseIdentities.get(database);
  if (
    existingIdentity !== undefined &&
    existingIdentity !== canonicalPhysicalDatabaseIdentity
  ) {
    return yield* Effect.fail(new FrameworkMigrationTargetCompositionError({
      reason: "databaseIdentityConflict",
      message: "Framework migration database identity conflicts with prior binding",
    }));
  }
  const namespace = yield* captureFrameworkSchemaTargetNamespace({
    deploymentId,
    physicalDatabaseIdentity: canonicalPhysicalDatabaseIdentity,
    schemaName: physicalLocator.schemaName,
  });
  const identityAfterCapture = physicalDatabaseIdentities.get(database);
  if (
    identityAfterCapture !== undefined &&
    identityAfterCapture !== canonicalPhysicalDatabaseIdentity
  ) {
    return yield* Effect.fail(new FrameworkMigrationTargetCompositionError({
      reason: "databaseIdentityConflict",
      message: "Framework migration database identity conflicts with prior binding",
    }));
  }
  const target = Object.freeze({
    [frameworkMigrationTargetBrand]: true,
  } satisfies FrameworkMigrationTarget);
  physicalDatabaseIdentities.set(
    database,
    canonicalPhysicalDatabaseIdentity,
  );
  targetStates.set(target, Object.freeze({
    database,
    driver,
    namespace,
    physicalLocator,
    capability: "postgres-transactional-relational-structure",
  } satisfies FrameworkMigrationTargetState));
  return target;
});

export function frameworkMigrationTargetSnapshot(
  target: FrameworkMigrationTarget,
): FrameworkMigrationTargetSnapshot | undefined {
  const state = targetStates.get(target);
  return state === undefined
    ? undefined
    : Object.freeze({
      namespace: state.namespace,
      physicalLocator: state.physicalLocator,
      capability: state.capability,
    });
}

export const runFrameworkMigrationTargetTransactionEffect = Effect.fn(
  "FrameworkMigrationTarget.runTransaction",
)(function* <Value, Failure>(
  target: FrameworkMigrationTarget,
  request: FrameworkMigrationTransactionRequest,
  work: (
    transaction: FrameworkMigrationTransaction,
    sessionIdentity: FrameworkMigrationSessionIdentity,
  ) => Effect.Effect<Value, Failure, never>,
): Effect.fn.Return<
  Value,
  Failure | FrameworkMigrationSessionFailure |
    FrameworkMigrationTargetCompositionError
> {
  const targetState = targetStates.get(target);
  if (targetState === undefined) {
    return yield* Effect.fail(new FrameworkMigrationTargetCompositionError({
      reason: "targetMismatch",
      message: "Framework migration target authority is invalid",
    }));
  }
  const capturedRequest = captureTransactionRequest(request);
  if (capturedRequest === undefined) {
    return yield* Effect.fail(new FrameworkMigrationTargetCompositionError({
      reason: "invalidInput",
      message: "Framework migration transaction budget is invalid",
    }));
  }
  if (capturedRequest.kind === "recovery") {
    const excludedState = sessionIdentityStates.get(
      capturedRequest.excludedSessionIdentity,
    );
    if (excludedState?.target !== target) {
      return yield* Effect.fail(new FrameworkMigrationTargetCompositionError({
        reason: "sessionMismatch",
        message: "Framework migration recovery session exclusion is invalid",
      }));
    }
  }
  const sessionIdentity = Object.freeze({
    [frameworkMigrationSessionIdentityBrand]: true,
  } satisfies FrameworkMigrationSessionIdentity);
  sessionIdentityStates.set(sessionIdentity, Object.freeze({ target }));
  const driverState = driverStates.get(targetState.driver);
  if (driverState === undefined || driverState.database !== targetState.database) {
    return yield* Effect.fail(new FrameworkMigrationTargetCompositionError({
      reason: "invalidDriver",
      message: "Framework migration target driver composition changed",
    }));
  }
  const driverRequest: FrameworkMigrationDriverTransactionRequest =
    capturedRequest.kind === "ordinary"
      ? Object.freeze({
        kind: "ordinary",
        lockTimeoutMilliseconds: capturedRequest.lockTimeoutMilliseconds,
        statementTimeoutMilliseconds:
          capturedRequest.statementTimeoutMilliseconds,
        sessionIdentity,
        excludedSessionIdentity: null,
      })
      : Object.freeze({
        kind: "recovery",
        lockTimeoutMilliseconds: capturedRequest.lockTimeoutMilliseconds,
        statementTimeoutMilliseconds:
          capturedRequest.statementTimeoutMilliseconds,
        sessionIdentity,
        excludedSessionIdentity: capturedRequest.excludedSessionIdentity,
      });
  return yield* driverState.runTransactionEffect(
    driverRequest,
    rawTransaction => {
      const transaction = Object.freeze({
        [frameworkMigrationTransactionBrand]: true,
      } satisfies FrameworkMigrationTransaction);
      const state: FrameworkMigrationTransactionState = {
        target,
        sessionIdentity,
        rawTransaction,
        active: true,
      };
      transactionStates.set(transaction, state);
      return Effect.suspend(() => work(transaction, sessionIdentity)).pipe(
        Effect.ensuring(Effect.sync(() => {
          state.active = false;
        })),
      );
    },
  );
});

export const withFrameworkMigrationRawTransactionEffect = Effect.fn(function <
  Value,
  Failure,
>(
  transaction: FrameworkMigrationTransaction,
  expectedTarget: FrameworkMigrationTarget,
  work: (
    rawTransaction: FlarexMetadataTransaction,
  ) => Effect.Effect<Value, Failure, never>,
): Effect.Effect<
  Value,
  Failure | FrameworkMigrationTargetCompositionError,
  never
> {
  return Effect.suspend<
    Value,
    Failure | FrameworkMigrationTargetCompositionError,
    never
  >(() => {
    const state = transactionStates.get(transaction);
    if (state === undefined || !state.active || state.target !== expectedTarget) {
      return Effect.fail(new FrameworkMigrationTargetCompositionError({
        reason: "targetMismatch",
        message: "Framework migration transaction is closed or cross-target",
      }));
    }
    return work(state.rawTransaction);
  });
});

export function frameworkMigrationTransactionSessionIdentity(
  transaction: FrameworkMigrationTransaction,
): FrameworkMigrationSessionIdentity | undefined {
  const state = transactionStates.get(transaction);
  return state?.active === true ? state.sessionIdentity : undefined;
}

function captureTransactionRequest(
  input: FrameworkMigrationTransactionRequest,
): FrameworkMigrationTransactionRequest | undefined {
  try {
    if (!isNonArrayRecord(input)) return undefined;
    const kind = input.kind;
    const lockTimeoutMilliseconds = input.lockTimeoutMilliseconds;
    const statementTimeoutMilliseconds = input.statementTimeoutMilliseconds;
    if (
      !isPositiveBoundedInteger(lockTimeoutMilliseconds) ||
      !isPositiveBoundedInteger(statementTimeoutMilliseconds)
    ) {
      return undefined;
    }
    switch (kind) {
      case "ordinary":
        return Object.freeze({
          kind,
          lockTimeoutMilliseconds,
          statementTimeoutMilliseconds,
        });
      case "recovery": {
        if (!("excludedSessionIdentity" in input)) return undefined;
        const excludedSessionIdentity = input.excludedSessionIdentity;
        return Object.freeze({
          kind,
          lockTimeoutMilliseconds,
          statementTimeoutMilliseconds,
          excludedSessionIdentity,
        });
      }
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}

function isPositiveBoundedInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0 && value <= 600_000;
}

function isIdentityText(value: unknown): value is string {
  return isBoundedPrivateValueIdentityText(value);
}

function capturePhysicalLocator(
  value: unknown,
): ScopePhysicalLocator | undefined {
  try {
    if (!isNonArrayRecord(value)) {
      return undefined;
    }
    const kind = value.kind;
    const databaseKey = value.databaseKey;
    const schemaName = value.schemaName;
    if (
      !isIdentityText(databaseKey) ||
      !isBoundedPrivateValueIdentityText(schemaName, 63)
    ) {
      return undefined;
    }
    switch (kind) {
      case "shared_database":
      case "schema_per_scope":
      case "database_per_scope":
        return Object.freeze({ kind, databaseKey, schemaName });
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}

function isWeakMapKey(value: unknown): value is object {
  return (typeof value === "object" && value !== null) ||
    typeof value === "function";
}
