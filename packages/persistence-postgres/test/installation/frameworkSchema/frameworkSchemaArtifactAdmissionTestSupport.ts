import { Effect, Exit, Result } from "effect";
import { sql } from "drizzle-orm";

import { useFileScopedPersistence } from "../../support/fileScopedPersistenceFixture";

import type { FlarexMetadataDatabase } from "../../../src/application/deployments";
import {
  CatalogControlSessionResourceIssue,
  makeCatalogControlSessionStarter,
  startCatalogControlDeadline,
  type CatalogControlInitialSettlement,
  type CatalogControlSessionDriver,
  type CatalogControlSessionStarter,
} from "../../../src/database/catalogControlSession";
import {
  makeFrameworkSchemaArtifactRepository,
  type FrameworkSchemaArtifactRepository,
} from "../../../src/installation/frameworkSchema/artifact/repository";
import type { FlarexMetadataTransaction } from
  "../../../src/database/metadataTransaction";
import type { PGliteFlarexPersistence } from "../../../src/database/pglite";

/** Admission rows only. Persistent DDL and failed-quarantine witnesses retain
 * independent databases; unexpected deployment dependants fail closed. */
export function useFileScopedFrameworkSchemaArtifactAdmissionPersistence() {
  return useFileScopedPersistence(async () => {
    const { createFileScopedPGliteFixture } = await import("../../support/pgliteTestFixture");
    return createFileScopedPGliteFixture(async () => persistence =>
      resetFrameworkSchemaArtifactAdmissionRows(persistence.drizzle));
  });
}

export async function resetFrameworkSchemaArtifactAdmissionRows(
  database: FlarexMetadataDatabase,
): Promise<void> {
  await database.transaction(async transaction => {
    // Keep both edge FKs, the deployment FK and every other dependant enabled.
    await transaction.execute(sql`delete from fx_control_framework_schema_artifact_dependency`);
    await transaction.execute(sql`delete from fx_control_framework_schema_artifact`);
    await transaction.execute(sql`delete from deployments`);
  });
}

export interface PGliteFrameworkSchemaArtifactAdmissionFixtureOptions {
  readonly beforeInitialTransaction?: () => Promise<void>;
  readonly beforeInitialCommitEffect?: Effect.Effect<void, never, never>;
  readonly uncertainAfterCommit?: Readonly<{
    readonly initialSettlementCause: unknown;
    readonly quarantineCause: unknown;
  }>;
  readonly failPostSettlementReadAcquisition?: Readonly<{
    readonly cause: unknown;
  }>;
}

export interface PGliteFrameworkSchemaArtifactAdmissionFixture {
  readonly controlSessionStarter: CatalogControlSessionStarter;
  readonly repository: FrameworkSchemaArtifactRepository;
  readonly events: readonly string[];
  readonly isTransactionActive: () => boolean;
}

/** Minimal single-connection PGlite transaction driver for admission SQL. */
export function makePGliteFrameworkSchemaArtifactAdmissionFixture(
  persistence: PGliteFlarexPersistence,
  options: PGliteFrameworkSchemaArtifactAdmissionFixtureOptions = {},
): PGliteFrameworkSchemaArtifactAdmissionFixture {
  const events: string[] = [];
  // SAFETY: PGlite's Drizzle adapter exposes the same PgDatabase query surface
  // used by the private artifact code; the focused admission lane proves it.
  const controlDb = persistence.drizzle as unknown as FlarexMetadataDatabase;
  // SAFETY: the fixture manually brackets one PGlite connection in BEGIN and
  // COMMIT/ROLLBACK, and admission uses only its common query capabilities.
  const transaction = persistence.drizzle as unknown as
    FlarexMetadataTransaction;
  let transactionActive = false;
  let initialRuns = 0;
  let readRuns = 0;

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
    > => Effect.suspend<
      Value,
      Failure | CatalogControlSessionResourceIssue,
      never
    >(() => {
      readRuns += 1;
      events.push("read:acquire");
      if (
        readRuns > 1 &&
        options.failPostSettlementReadAcquisition !== undefined
      ) {
        events.push("read:acquireFailed");
        return Effect.fail(
          new CatalogControlSessionResourceIssue({
            phase: "acquire",
            cause: options.failPostSettlementReadAcquisition.cause,
          }),
        );
      }
      return work(controlDb).pipe(Effect.ensuring(Effect.sync(() => {
        events.push("read:release");
      })));
    }),
    runInitialTransactionEffect: Effect.fn(
      "FrameworkSchemaArtifactPGliteTestControlSession.initialTransaction",
    )(function* <Value, Failure>(
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
    ): Effect.fn.Return<
      CatalogControlInitialSettlement<Value, Failure>,
      never,
      never
    > {
      initialRuns += 1;
      if (
        initialRuns === 1 &&
        options.beforeInitialTransaction !== undefined
      ) {
        events.push("initial:before");
        yield* Effect.promise(options.beforeInitialTransaction);
      }
      events.push("initial:begin");
      yield* Effect.promise(() => persistence.query("begin"));
      transactionActive = true;
      events.push("initial:callback");
      const callback = yield* Effect.exit(restore(work(transaction)));
      if (Exit.isFailure(callback)) {
        events.push("initial:rollback");
        yield* Effect.promise(() => persistence.query("rollback"));
        transactionActive = false;
        return Object.freeze({
          kind: "callbackRolledBack" as const,
          callbackCause: callback.cause,
        });
      }
      if (options.beforeInitialCommitEffect !== undefined) {
        events.push("initial:beforeCommit");
        yield* options.beforeInitialCommitEffect;
      }
      events.push("initial:commit");
      yield* Effect.promise(() => persistence.query("commit"));
      transactionActive = false;
      if (options.uncertainAfterCommit !== undefined) {
        const recoveryDeadline = yield*
          startCatalogControlDeadline(
            "recovery",
            input.recoveryTimeoutMilliseconds,
          );
        events.push("initial:quarantine");
        return Object.freeze({
          kind: "uncertain" as const,
          value: callback.value,
          initialSettlementCause:
            options.uncertainAfterCommit.initialSettlementCause,
          recoveryDeadline,
          quarantine: Object.freeze({
            kind: "failed" as const,
            cause: options.uncertainAfterCommit.quarantineCause,
          }),
        });
      }
      events.push("initial:release");
      return Object.freeze({
        kind: "committed" as const,
        value: callback.value,
      });
    }),
    runRecoveryTransactionEffect: () => Effect.die(
      "PGlite admission fixture does not model settlement recovery.",
    ),
  } satisfies CatalogControlSessionDriver);

  const controlSessionStarter = makeCatalogControlSessionStarter({ controlDb, driver });
  const repositoryResult = makeFrameworkSchemaArtifactRepository({
    controlDb,
    controlSessionStarter,
    readTimeoutMilliseconds: 5_000,
    attemptTimeoutMilliseconds: 5_000,
    recoveryTimeoutMilliseconds: 5_000,
    lockTimeoutMilliseconds: 1_000,
  });
  if (Result.isFailure(repositoryResult)) throw repositoryResult.failure;

  return Object.freeze({
    controlSessionStarter,
    repository: repositoryResult.success,
    events,
    isTransactionActive: () => transactionActive,
  });
}
