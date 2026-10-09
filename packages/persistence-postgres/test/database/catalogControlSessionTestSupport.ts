import { Cause, Effect, Exit } from "effect";

import type { FlarexMetadataDatabase } from "../../src/application/deployments";
import type { FlarexMetadataTransaction } from
  "../../src/database/metadataTransaction";
import {
  CatalogControlSessionCleanupDefect,
  CatalogControlSessionResourceIssue,
  makeCatalogControlConnectionIdentity,
  startCatalogControlDeadline,
  type CatalogControlInitialSettlement,
  type CatalogControlRecoverySettlement,
  type CatalogControlSessionDriver,
} from "../../src/database/catalogControlSession";

export type ScriptedInitialSettlement =
  | "commit"
  | "cleanupFailure"
  | "notCommitted"
  | "uncertainConfirmed"
  | "uncertainQuarantineFailed";

export type ScriptedRecoverySettlement = "commit" | "unresolvedLifecycle";

export interface ScriptedControlSessionPlan {
  readonly initial: ScriptedInitialSettlement;
  readonly recovery?: ScriptedRecoverySettlement;
  readonly initialSettlementCause?: unknown;
  readonly cleanupPhase?: "rollback" | "release" | "quarantine";
  readonly cleanupCause?: unknown;
  readonly quarantineCause?: unknown;
  readonly resolutionCause?: Cause.Cause<
    CatalogControlSessionResourceIssue
  >;
  readonly beforeRecoveryEffect?: Effect.Effect<void, never, never>;
}

export interface ScriptedControlSessionFixture {
  readonly driver: CatalogControlSessionDriver;
  readonly events: string[];
  readonly initialTransaction: FlarexMetadataTransaction;
  readonly recoveryTransaction: FlarexMetadataTransaction;
  readonly controlDb: FlarexMetadataDatabase;
}

export function makeScriptedControlSessionFixture(
  plan: ScriptedControlSessionPlan,
): ScriptedControlSessionFixture {
  const events: string[] = [];
  const controlDb = databaseIdentity("control");
  const initialTransaction = transactionIdentity("initial");
  const recoveryTransaction = transactionIdentity("recovery");
  const initialConnectionIdentity =
    makeCatalogControlConnectionIdentity();
  const recoveryConnectionIdentity =
    makeCatalogControlConnectionIdentity();
  let recoveryRuns = 0;

  const driver = Object.freeze({
    runReadEffect: <Value, Failure>(
      _input: Parameters<
        CatalogControlSessionDriver["runReadEffect"]
      >[0],
      work: (
        database: FlarexMetadataDatabase,
      ) => Effect.Effect<Value, Failure, never>,
    ): Effect.Effect<
      Value,
      Failure | CatalogControlSessionResourceIssue,
      never
    > => {
      events.push("read");
      return work(controlDb);
    },
    runInitialTransactionEffect: <Value, Failure>(
      input: Parameters<
        CatalogControlSessionDriver[
          "runInitialTransactionEffect"
        ]
      >[0],
      restore: Parameters<
        CatalogControlSessionDriver[
          "runInitialTransactionEffect"
        ]
      >[1],
      work: (
        transaction: FlarexMetadataTransaction,
      ) => Effect.Effect<Value, Failure, never>,
    ): Effect.Effect<
      CatalogControlInitialSettlement<Value, Failure>,
      never,
      never
    > => Effect.gen(function* () {
      events.push("initial:begin", "initial:isolation", "initial:budget");
      if (plan.initial === "notCommitted") {
        return Object.freeze({
          kind: "notCommitted" as const,
          cause: Cause.fail(resourceIssue("begin", plan.cleanupCause)),
        });
      }

      events.push("initial:callback");
      const callback = yield* Effect.exit(restore(work(initialTransaction)));
      if (Exit.isFailure(callback)) {
        events.push("initial:rollback");
        return plan.initial === "cleanupFailure"
          ? Object.freeze({
              kind: "callbackCleanupFailed" as const,
              callbackCause: callback.cause,
              cleanupCause: Cause.die(
                new CatalogControlSessionCleanupDefect({
                  phase: plan.cleanupPhase ?? "rollback",
                  cause: plan.cleanupCause,
                }),
              ),
            })
          : Object.freeze({
              kind: "callbackRolledBack" as const,
              callbackCause: callback.cause,
            });
      }

      if (plan.initial === "commit") {
        events.push("initial:commit", "initial:release");
        return Object.freeze({
          kind: "committed" as const,
          value: callback.value,
        });
      }

      events.push("initial:commitUncertain", "recovery:deadline");
      const recoveryDeadline = yield*
        startCatalogControlDeadline(
          "recovery",
          input.recoveryTimeoutMilliseconds,
        );
      events.push("initial:quarantine");
      return Object.freeze({
        kind: "uncertain" as const,
        value: callback.value,
        initialSettlementCause: plan.initialSettlementCause,
        recoveryDeadline,
        quarantine: plan.initial === "uncertainConfirmed"
          ? Object.freeze({
              kind: "confirmed" as const,
              excludedConnectionIdentity: initialConnectionIdentity,
            })
          : Object.freeze({
              kind: "failed" as const,
              cause: plan.quarantineCause,
            }),
      });
    }),
    runRecoveryTransactionEffect: <Value, Failure>(
      input: Parameters<
        CatalogControlSessionDriver[
          "runRecoveryTransactionEffect"
        ]
      >[0],
      work: (
        transaction: FlarexMetadataTransaction,
      ) => Effect.Effect<Value, Failure, never>,
    ): Effect.Effect<
      CatalogControlRecoverySettlement<Value, Failure>,
      never,
      never
    > => Effect.gen(function* () {
      recoveryRuns += 1;
      if (recoveryRuns > 1) {
        return yield* Effect.die("second recovery attempt");
      }
      if (input.excludedConnectionIdentity !== initialConnectionIdentity) {
        return yield* Effect.die("recovery did not exclude initial connection");
      }
      if (input.excludedConnectionIdentity === recoveryConnectionIdentity) {
        return yield* Effect.die("recovery reused excluded connection");
      }
      events.push(
        "recovery:begin",
        "recovery:isolation",
        "recovery:budget",
      );
      if (plan.beforeRecoveryEffect !== undefined) {
        events.push("recovery:waiting");
        yield* plan.beforeRecoveryEffect;
      }
      events.push("recovery:callback");
      const callback = yield* Effect.exit(work(recoveryTransaction));
      if (Exit.isFailure(callback)) {
        events.push("recovery:rollback", "recovery:release");
        return Object.freeze({
          kind: "unresolved" as const,
          resolution: Object.freeze({
            kind: "callback" as const,
            cause: callback.cause,
          }),
        });
      }
      if (plan.recovery === "unresolvedLifecycle") {
        events.push("recovery:commitUncertain", "recovery:quarantine");
        return Object.freeze({
          kind: "unresolved" as const,
          resolution: Object.freeze({
            kind: "lifecycle" as const,
            cause: plan.resolutionCause ?? Cause.die(
              new Error("Missing scripted recovery resolution cause."),
            ),
          }),
        });
      }
      events.push("recovery:commit", "recovery:release");
      return Object.freeze({
        kind: "committed" as const,
        value: callback.value,
      });
    }),
  } satisfies CatalogControlSessionDriver);

  return Object.freeze({
    driver,
    events,
    initialTransaction,
    recoveryTransaction,
    controlDb,
  });
}

function resourceIssue(
  phase: "begin",
  cause: unknown,
): CatalogControlSessionResourceIssue {
  return new CatalogControlSessionResourceIssue({
    phase,
    cause,
  });
}

function databaseIdentity(label: string): FlarexMetadataDatabase {
  // SAFETY: the scripted driver exposes only identity; no database method runs.
  return Object.freeze({ label }) as unknown as FlarexMetadataDatabase;
}

function transactionIdentity(label: string): FlarexMetadataTransaction {
  // SAFETY: lifecycle tests authenticate identity and never invoke Drizzle.
  return Object.freeze({ label }) as unknown as FlarexMetadataTransaction;
}
