import { setTimeout as delay } from "node:timers/promises";

import { eq } from "drizzle-orm";
import { Effect, Fiber } from "effect";
import {
  appRowIdHexV1ToBytes,
} from "flarex-protocol/app-document-id";
import {
  CommitSyscallSequenceV1Schema,
  canonicalizeSessionJournalV1Effect,
  canonicalizeSuccessfulResultV1Effect,
} from "flarex-protocol/commit-protocol";
import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  type SchemaManifestAppTableDeclarationInputV1,
} from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  decodeReplacementScopeIdV1,
  projectScopeEpochUuidV1,
} from "flarex-protocol/storage-authority";
import {
  TransactionGrantDeploymentIdV1Schema,
} from "flarex-protocol/transaction-grant";
import {
  TransactionRequestKeyV1Schema,
} from "flarex-protocol/transaction-session";
import { canonicalizeFlarexValueV1 } from "flarex-protocol/value";
import { describe, expect, it } from "vitest";

import {
  appendAppRowRevisionAndAdvanceCurrentInTransaction,
} from "../src/appRows";
import {
  createPointCommitFinishingTransitionPortV1,
  createPointCommitPublisherPortV1,
  createPointCommitRollbackProofPortV1,
  PointCommitConflictV1Error,
  PointCommitCorruptionV1Error,
  PointCommitStaleAuthorityV1Error,
  type PointCommitSqlOperationV1,
  type PointCommitPublicationCommandV1,
  type PointCommitTransactionCommandV1,
  type PointCommitTransactionProofOptionsV1,
} from "../src/pointCommitTransaction";
import {
  createPostgresLocatedPointMutationSessionActivationTargetV1,
  createPostgresSharedScopeAuthorityProvisioner,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import type { LocatedScopeClockReader } from "../src/scopeAuthorityResolution";
import type { SharedDatabaseScopePhysicalLocator } from "../src/scopeMetadataTypes";
import {
  fxSystemCommitAppRowChanges,
  fxSystemCommits,
  fxSystemScopeClocks,
} from "../src/schema";
import { createSessionJournalStorePersistenceV1 } from "../src/sessionJournalStore";
import {
  createStoredAttemptEvidenceLoaderV1,
  type StoredAttemptEvidenceAuthorityV1,
} from "../src/storedAttemptEvidence";
import {
  createPointMutationSessionActivationPersistenceV1,
  type PointMutationSessionAnchorV1,
  type PointMutationSessionAuthorityResolutionPortsV1,
} from "../src/transactionSessionActivation";
import {
  pointCommitCommandFromStoredAttemptV1,
  pointCommitFinishingCommandFromStoredAttemptV1,
} from "./pointCommitTransactionTestSupport";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";
import {
  completeSessionJournalSeal as completeSeal,
  prepareSessionJournalSeal as prepareSeal,
  runEffect,
  runEffectFailure as runFailure,
  runSessionJournalPointOperation as runPointOperation,
} from "./effectTestRuntime";
import {
  activatePointMutationSession,
  pointMutationSessionActivationFixture,
  setFlarexActivationClock,
} from "./transactionSessionActivationTestSupport";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("real Postgres O06 point-commit transaction kernel", () => {
  it("masks interruption until forced rollback settles and exposes no tentative state", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96000000");
      const scope = await createScope(
        persistence,
        randomUuid,
        "rollback_settlement",
      );
      const attempt = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "rollback_settlement",
      );
      const before = await durableState(
        persistence,
        attempt.command.sealIdentity.scopeUuid,
      );
      const entered = deferredSignal();
      const release = deferredSignal();
      let interruptionSettled = false;
      const fiber = Effect.runFork(
        createPort(persistence, {
          afterTransactionStep: async (event) => {
            if (event.step !== "beforeRollback") return;
            entered.resolve();
            await release.promise;
          },
        }).prove(attempt.command),
      );
      await entered.promise;

      expect(await durableState(
        persistence,
        attempt.command.sealIdentity.scopeUuid,
      )).toEqual(before);
      const interruption = runEffect(Fiber.interrupt(fiber)).then((exit) => {
        interruptionSettled = true;
        return exit;
      });
      await delay(25);
      expect(interruptionSettled).toBe(false);
      release.resolve();
      await interruption;
      expect(interruptionSettled).toBe(true);
      expect(await durableState(
        persistence,
        attempt.command.sealIdentity.scopeUuid,
      )).toEqual(before);

      const steps: string[] = [];
      const queries = new Map<
        PointCommitSqlOperationV1,
        Readonly<{ readonly sql: string; readonly params: ReadonlyArray<unknown> }>
      >();
      const result = await runEffect(createPort(persistence, {
        afterTransactionStep: (event) => {
          steps.push(event.step);
          return Promise.resolve();
        },
        observeQuery: (query) => {
          queries.set(query.name, query);
        },
      }).prove(attempt.command));
      expect(result).toEqual({ kind: "wouldCommit" });
      expect(Object.isFrozen(result)).toBe(true);
      expect(steps).toEqual([
        "clockLocked",
        "sessionLocked",
        "leaseLocked",
        "journalRootLocked",
        "dependenciesValidated",
        "tentativeRowWritten",
        "beforeRollback",
      ]);
      expect([...queries.keys()]).toEqual([
        "lockScopeClock",
        "lockSession",
        "lockLease",
        "lockJournalRoot",
        "readDatabaseTime",
        "loadRowHeads",
      ]);
      const sessionQuery = requireObservedQuery(queries, "lockSession");
      expect(sessionQuery.sql).not.toContain("validated_args_json");
      expect(sessionQuery.sql).not.toContain("authorization_grant_json");
      for (const name of [
        "lockScopeClock",
        "lockSession",
        "lockLease",
        "lockJournalRoot",
      ] as const) {
        expect(await explainObserved(persistence, requireObservedQuery(
          queries,
          name,
        ))).toContain("Index Scan");
      }
    });
  }, 120_000);

  it("serializes one scope while an independent scope completes", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96100000");
      const firstScope = await createScope(
        persistence,
        randomUuid,
        "serialized_a",
      );
      const independentScope = await createScope(
        persistence,
        randomUuid,
        "serialized_b",
      );
      const first = await createAttempt(
        persistence,
        randomUuid,
        firstScope,
        "serialized_a1",
      );
      const second = await createAttempt(
        persistence,
        randomUuid,
        firstScope,
        "serialized_a2",
      );
      const independent = await createAttempt(
        persistence,
        randomUuid,
        independentScope,
        "serialized_b1",
      );
      const entered = deferredSignal();
      const release = deferredSignal();
      const order: string[] = [];
      const firstPromise = runEffect(createPort(persistence, {
        afterTransactionStep: async (event) => {
          if (event.step !== "clockLocked") return;
          order.push("first-clock");
          entered.resolve();
          await release.promise;
        },
      }).prove(first.command));
      await entered.promise;
      const secondPromise = runEffect(createPort(persistence, {
        afterTransactionStep: (event) => {
          if (event.step === "clockLocked") order.push("second-clock");
          return Promise.resolve();
        },
      }).prove(second.command));
      await waitForBlockedPointCommit(persistence, 1);

      await withTimeout(
        runEffect(createPort(persistence).prove(independent.command)),
        5_000,
        "independent O06 scope",
      );
      expect(order).toEqual(["first-clock"]);
      release.resolve();
      await Promise.all([firstPromise, secondPromise]);
      expect(order).toEqual(["first-clock", "second-clock"]);
      expect(await durableState(
        persistence,
        first.command.sealIdentity.scopeUuid,
      )).toMatchObject({ revisions: "0", last_commit_seq: "0" });
      expect(await durableState(
        persistence,
        independent.command.sealIdentity.scopeUuid,
      )).toMatchObject({ revisions: "0", last_commit_seq: "0" });
    });
  }, 120_000);

  it("linearizes revocation after the rollback and rejects detached stale authority", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96200000");
      const scope = await createScope(
        persistence,
        randomUuid,
        "revocation_race",
      );
      const attempt = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "revocation_race",
      );
      const entered = deferredSignal();
      const release = deferredSignal();
      const proof = runEffect(createPort(persistence, {
        afterTransactionStep: async (event) => {
          if (event.step !== "clockLocked") return;
          entered.resolve();
          await release.promise;
        },
      }).prove(attempt.command));
      await entered.promise;
      let revocationSettled = false;
      const revocation = persistence.query(
        `
          update fx_system_scope_clock
          set authorization_revocation_epoch =
            authorization_revocation_epoch + 1
          where scope_uuid = $1
        `,
        [attempt.command.sealIdentity.scopeUuid],
      ).then(() => {
        revocationSettled = true;
      });
      try {
        await waitForBlockedPointCommit(persistence, 1);
        expect(revocationSettled).toBe(false);
      } finally {
        release.resolve();
      }
      await proof;
      await revocation;

      const failure = await runFailure(
        createPort(persistence).prove(attempt.command),
      );
      expect(failure).toBeInstanceOf(PointCommitStaleAuthorityV1Error);
      expect(failure).toMatchObject({ reason: "revocationEpochChanged" });
      expect(await durableState(
        persistence,
        attempt.command.sealIdentity.scopeUuid,
      )).toMatchObject({ revisions: "0", last_commit_seq: "0" });
    });
  }, 120_000);

  it("observes a competing committed row after the clock wait as an OCC conflict", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96300000");
      const scope = await createScope(
        persistence,
        randomUuid,
        "occ_race",
      );
      const attempt = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "occ_race",
      );
      const writerLocked = deferredSignal();
      const releaseWriter = deferredSignal();
      const writer = commitCompetingPointRow(
        persistence,
        attempt.command,
        writerLocked,
        releaseWriter,
      );
      await writerLocked.promise;
      const proofFailure = runFailure(
        createPort(persistence).prove(attempt.command),
      );
      await waitForBlockedPointCommit(persistence, 1);
      releaseWriter.resolve();
      await writer;
      const failure = await proofFailure;
      expect(failure).toBeInstanceOf(PointCommitConflictV1Error);
      expect(await durableState(
        persistence,
        attempt.command.sealIdentity.scopeUuid,
      )).toMatchObject({
        revisions: "1",
        current_rows: "1",
        commit_headers: "1",
        commit_changes: "1",
        last_commit_seq: "1",
      });
      const plan = await explainHeadLookup(persistence, attempt.command);
      expect(plan).toContain("Index Scan");
      expect(plan).toContain("fx_app_row_current");
      expect(plan).toContain("fx_app_row_rev");
    });
  }, 120_000);

  it("publishes material and zero-row successes with complete atomic evidence", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96400000");
      const materialScope = await createScope(
        persistence,
        randomUuid,
        "publish_material",
      );
      const material = await createAttempt(
        persistence,
        randomUuid,
        materialScope,
        "publish_material",
      );
      const published = await runEffect(
        createPublisher(persistence).publish(material.publicationCommand),
      );
      expect(published).toMatchObject({
        kind: "published",
        token: { commitSeq: 1n },
        successfulResult: { valueJson: { ok: true } },
      });
      expect(await durableState(
        persistence,
        material.command.sealIdentity.scopeUuid,
      )).toEqual({
        revisions: "1",
        current_rows: "1",
        commit_headers: "1",
        commit_changes: "1",
        outcomes: "1",
        wakes: "1",
        last_commit_seq: "1",
        last_outbox_seq: "1",
      });
      expect(await terminalPublicationState(
        persistence,
        material.command.sealIdentity.scopeUuid,
        material.anchor.sessionId,
      )).toEqual({
        lifecycle: "committed",
        leases: "0",
        journals: "0",
        change_count: 1,
        delivery_state: "pending",
        same_initial_time: true,
      });

      const zeroScope = await createScope(
        persistence,
        randomUuid,
        "publish_zero",
      );
      const zero = await createAttempt(
        persistence,
        randomUuid,
        zeroScope,
        "publish_zero",
        false,
      );
      await runEffect(
        createPublisher(persistence).publish(zero.publicationCommand),
      );
      expect(await durableState(
        persistence,
        zero.command.sealIdentity.scopeUuid,
      )).toEqual({
        revisions: "0",
        current_rows: "0",
        commit_headers: "1",
        commit_changes: "0",
        outcomes: "1",
        wakes: "1",
        last_commit_seq: "1",
        last_outbox_seq: "1",
      });
      expect(await terminalPublicationState(
        persistence,
        zero.command.sealIdentity.scopeUuid,
        zero.anchor.sessionId,
      )).toMatchObject({ change_count: 0, lifecycle: "committed" });
    });
  }, 120_000);

  it("linearizes concurrent duplicates into one publisher and one replay", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96500000");
      const scope = await createScope(
        persistence,
        randomUuid,
        "duplicate_publish",
      );
      const attempt = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "duplicate_publish",
      );
      const entered = deferredSignal();
      const release = deferredSignal();
      const first = runEffect(createPublisher(persistence, {
        afterTransactionStep: async (event) => {
          if (event.step !== "clockLocked") return;
          entered.resolve();
          await release.promise;
        },
      }).publish(attempt.publicationCommand));
      await entered.promise;
      const second = runEffect(
        createPublisher(persistence).publish(attempt.publicationCommand),
      );
      await waitForBlockedPointCommit(persistence, 1);
      release.resolve();
      const results = await Promise.all([first, second]);
      expect(results.map((result) => result.kind).sort()).toEqual([
        "published",
        "replayed",
      ]);
      expect(results[0]?.token).toEqual(results[1]?.token);
      expect(await durableState(
        persistence,
        attempt.command.sealIdentity.scopeUuid,
      )).toMatchObject({
        revisions: "1",
        commit_headers: "1",
        outcomes: "1",
        wakes: "1",
        last_commit_seq: "1",
        last_outbox_seq: "1",
      });

      const lateProof = await runFailure(
        createPort(persistence).prove(attempt.command),
      );
      expect(lateProof).toBeInstanceOf(PointCommitStaleAuthorityV1Error);
      expect(await durableState(
        persistence,
        attempt.command.sealIdentity.scopeUuid,
      )).toMatchObject({ commit_headers: "1", outcomes: "1", wakes: "1" });
    });
  }, 120_000);

  it("serializes distinct same-scope publications into dense paired heads", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96600000");
      const scope = await createScope(
        persistence,
        randomUuid,
        "dense_publish",
      );
      const first = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "dense_publish_a",
      );
      const second = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "dense_publish_b",
      );
      const results = await Promise.all([
        runEffect(createPublisher(persistence).publish(
          first.publicationCommand,
        )),
        runEffect(createPublisher(persistence).publish(
          second.publicationCommand,
        )),
      ]);
      expect(results.map((result) => result.token.commitSeq).sort()).toEqual([
        1n,
        2n,
      ]);
      expect(await durableState(
        persistence,
        first.command.sealIdentity.scopeUuid,
      )).toEqual({
        revisions: "2",
        current_rows: "2",
        commit_headers: "2",
        commit_changes: "2",
        outcomes: "2",
        wakes: "2",
        last_commit_seq: "2",
        last_outbox_seq: "2",
      });
      const sequenceRows = await persistence.query<{
        commit_seq: string;
        outbox_seq: string;
      }>(
        `
          select commit_seq::text, outbox_seq::text
          from fx_system_outbox
          where scope_uuid = $1
          order by outbox_seq
        `,
        [first.command.sealIdentity.scopeUuid],
      );
      expect(sequenceRows.rows).toEqual([
        { commit_seq: "1", outbox_seq: "1" },
        { commit_seq: "2", outbox_seq: "2" },
      ]);
    });
  }, 120_000);

  it("rolls back late O07-B failures without a sequence or receipt gap", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const randomUuid = uuidFactory("96700000");
      const scope = await createScope(
        persistence,
        randomUuid,
        "publish_rollback",
      );
      const attempt = await createAttempt(
        persistence,
        randomUuid,
        scope,
        "publish_rollback",
      );
      const failure = await runFailure(createPublisher(persistence, {
        afterTransactionStep: (event) => {
          if (event.step === "clockAdvanced") {
            throw new PointCommitCorruptionV1Error({
              reason: "publicationInvariantInvalid",
            });
          }
          return Promise.resolve();
        },
      }).publish(attempt.publicationCommand));
      expect(failure).toBeInstanceOf(PointCommitCorruptionV1Error);
      expect(await durableState(
        persistence,
        attempt.command.sealIdentity.scopeUuid,
      )).toEqual({
        revisions: "0",
        current_rows: "0",
        commit_headers: "0",
        commit_changes: "0",
        outcomes: "0",
        wakes: "0",
        last_commit_seq: "0",
        last_outbox_seq: "0",
      });
    });
  }, 120_000);
});

interface ScopeScenario {
  readonly deploymentId: ReturnType<
    typeof TransactionGrantDeploymentIdV1Schema.make
  >;
  readonly scopeId: ReturnType<typeof decodeReplacementScopeIdV1>;
  readonly schemaVersionId: ReturnType<
    typeof CatalogSchemaVersionIdSchema.make
  >;
  readonly ports: PointMutationSessionAuthorityResolutionPortsV1;
}

interface PreparedAttempt {
  readonly anchor: PointMutationSessionAnchorV1;
  readonly authority: StoredAttemptEvidenceAuthorityV1;
  readonly command: PointCommitTransactionCommandV1;
  readonly publicationCommand: PointCommitPublicationCommandV1;
}

async function createScope(
  persistence: PostgresFlarexPersistence,
  randomUuid: () => string,
  label: string,
): Promise<ScopeScenario> {
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
    `deployment_o06_postgres_${label}`,
  );
  const schemaVersionId = CatalogSchemaVersionIdSchema.make(
    `schema_o06_postgres_${label}`,
  );
  const locator = Object.freeze({
    kind: "shared_database",
    databaseKey: `o06-postgres-${label}`,
    schemaName: "public",
  }) satisfies SharedDatabaseScopePhysicalLocator;
  const provisioned = await createPostgresSharedScopeAuthorityProvisioner(
    persistence,
    { physicalLocator: locator, randomUuid },
  ).ensure({
    deploymentId,
    projectId: `project_o06_postgres_${label}`,
  });
  const scopeId = decodeReplacementScopeIdV1(provisioned.scope.scopeId);
  await setFlarexActivationClock(persistence, scopeId);
  await persistence.publishAppSchemaV1({
    deploymentId,
    schemaVersionId,
    version: CatalogSchemaVersionSchema.make(1),
    tables: [appTable("users")],
    indexes: [],
  });
  return Object.freeze({
    deploymentId,
    scopeId,
    schemaVersionId,
    ports: resolutionPorts(persistence),
  });
}

async function createAttempt(
  persistence: PostgresFlarexPersistence,
  randomUuid: () => string,
  scope: ScopeScenario,
  label: string,
  materialWrite = true,
): Promise<PreparedAttempt> {
  const activation = await activatePointMutationSession(
    createPointMutationSessionActivationPersistenceV1(
      scope.ports,
      { leaseDurationMilliseconds: 300_000, randomUuid },
    ),
    pointMutationSessionActivationFixture(
      scope.deploymentId,
      scope.scopeId,
      {
        evidence: {
          schemaVersionId: scope.schemaVersionId,
          requestKey: TransactionRequestKeyV1Schema.make(
            `request:o06:postgres:${label}`,
          ),
        },
      },
    ),
  );
  const store = createSessionJournalStorePersistenceV1(scope.ports, {
    randomUuid,
  });
  const attempt = await runEffect(
    store.openAttemptEffect({
      selector: {
        deploymentId: scope.deploymentId,
        scopeId: scope.scopeId,
        sessionId: activation.anchor.sessionId,
        attemptFence: activation.anchor.attemptFence,
      },
      snapshotToken: activation.anchor.snapshotToken,
      schemaVersionId: scope.schemaVersionId,
    }),
  );
  if (materialWrite) {
    const table = await runEffect(
      store.resolvePointTableEffect(attempt, "users"),
    );
    await runPointOperation(store, table, {
      kind: "insert",
      syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
      fields: { name: label },
    });
  }
  const prepared = await prepareSeal(store, attempt);
  const journal = await runEffect(
    canonicalizeSessionJournalV1Effect(prepared.journal),
  );
  const result = await runEffect(
    canonicalizeSuccessfulResultV1Effect({ ok: true }),
  );
  await completeSeal(store, prepared.preparation, journal, result);
  const authority = authorityFromAnchor(
    activation.anchor,
    scope.schemaVersionId,
  );
  const loader = createStoredAttemptEvidenceLoaderV1(scope.ports);
  const running = await runEffect(loader.loadEffect(authority));
  if (running.kind !== "loaded") {
    throw new Error(`Expected running O06 evidence, received ${running.kind}.`);
  }
  await runEffect(
    createPointCommitFinishingTransitionPortV1(scope.ports).enterFinishing(
      await pointCommitFinishingCommandFromStoredAttemptV1(
        authority,
        running.evidence,
      ),
    ),
  );
  const loaded = await runEffect(loader.loadFinishingEffect({
    deploymentId: activation.anchor.deploymentId,
    scopeId: activation.anchor.scopeId,
    sessionId: activation.anchor.sessionId,
    attemptFence: activation.anchor.attemptFence,
  }));
  if (loaded.kind !== "loaded") {
    throw new Error(`Expected O06 stored evidence, received ${loaded.kind}.`);
  }
  const command = await pointCommitCommandFromStoredAttemptV1(
    authority,
    loaded.evidence,
  );
  return Object.freeze({
    anchor: activation.anchor,
    authority,
    command,
    publicationCommand: Object.freeze({
      ...command,
      successfulResult: Object.freeze({
        valueCodecVersion: result.evidence.valueCodecVersion,
        value: Object.freeze({ ok: true }),
        canonicalBytes: result.canonicalBytes,
        semanticSizeBytes: result.semanticSizeBytes,
        sha256Hex: result.evidence.sha256Hex,
      }),
    }),
  });
}

function createPort(
  persistence: PostgresFlarexPersistence,
  options: PointCommitTransactionProofOptionsV1 = {},
) {
  return createPointCommitRollbackProofPortV1(
    resolutionPorts(persistence),
    options,
  );
}

function createPublisher(
  persistence: PostgresFlarexPersistence,
  options: PointCommitTransactionProofOptionsV1 = {},
) {
  return createPointCommitPublisherPortV1(
    resolutionPorts(persistence),
    options,
  );
}

function resolutionPorts(
  persistence: PostgresFlarexPersistence,
): PointMutationSessionAuthorityResolutionPortsV1 {
  return {
    scopeMetadata: persistence,
    provisioningReceipts: {
      getScopeAuthorityProvisioningReceipt: async () => {
        throw new Error("Shared placement must not read split receipts.");
      },
    },
    scopeSessionTargets: {
      resolve: async (physicalLocator): Promise<LocatedScopeClockReader> =>
        createPostgresLocatedPointMutationSessionActivationTargetV1(
          persistence,
          physicalLocator,
        ),
    },
  };
}

function authorityFromAnchor(
  anchor: PointMutationSessionAnchorV1,
  schemaVersionId: ReturnType<typeof CatalogSchemaVersionIdSchema.make>,
): StoredAttemptEvidenceAuthorityV1 {
  return Object.freeze({
    deploymentId: anchor.deploymentId,
    scopeId: anchor.scopeId,
    sessionId: anchor.sessionId,
    attemptFence: anchor.attemptFence,
    storageGeneration: anchor.storageGeneration,
    storageGenerationFence: anchor.storageGenerationFence,
    snapshotToken: anchor.snapshotToken,
    schemaVersionId,
  });
}

async function commitCompetingPointRow(
  persistence: PostgresFlarexPersistence,
  command: PointCommitTransactionCommandV1,
  locked: ReturnType<typeof deferredSignal>,
  release: ReturnType<typeof deferredSignal>,
): Promise<void> {
  const intent = command.rowIntent;
  if (intent === null || intent.kind !== "live") {
    throw new Error("O06 competing writer requires a live intent.");
  }
  const clock = await persistence.getScopeClock(command.authorityPins.scopeId);
  if (clock === null) throw new Error("Missing competing-writer scope clock.");
  const commitSeq = CommitSeqSchema.make(1n);
  const epochUuid = projectScopeEpochUuidV1(clock.epoch).epochUuid;
  const document = await canonicalizeFlarexValueV1(
    intent.value,
    "appDocument",
  );
  await persistence.drizzle.transaction(async (tx) => {
    await tx
      .select({ scopeUuid: fxSystemScopeClocks.scopeUuid })
      .from(fxSystemScopeClocks)
      .where(eq(
        fxSystemScopeClocks.scopeUuid,
        command.sealIdentity.scopeUuid,
      ))
      .limit(1)
      .for("update");
    locked.resolve();
    await release.promise;
    await appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
      kind: "live",
      scopeId: command.authorityPins.scopeId,
      tableId: intent.tableId,
      rowId: intent.rowId,
      writeEpoch: clock.epoch,
      commitSeq,
      prevCommitSeq: null,
      schemaVersionId: command.authorityPins.schemaVersionId,
      creationTime: intent.creationTime,
      value: {
        codecVersion: document.codecVersion,
        valueJson: document.valueJson,
        canonicalBytes: document.canonicalBytes,
        sha256: document.sha256,
      },
    });
    await tx.insert(fxSystemCommits).values({
      scopeUuid: command.sealIdentity.scopeUuid,
      epochUuid,
      commitSeq,
      changeCount: 1,
    });
    await tx.insert(fxSystemCommitAppRowChanges).values({
      scopeUuid: command.sealIdentity.scopeUuid,
      epochUuid,
      commitSeq,
      changeOrdinal: 0,
      tableId: intent.tableId,
      rowId: appRowIdHexV1ToBytes(intent.rowId),
    });
    await tx
      .update(fxSystemScopeClocks)
      .set({ lastCommitSeq: commitSeq })
      .where(eq(
        fxSystemScopeClocks.scopeUuid,
        command.sealIdentity.scopeUuid,
      ));
  });
}

async function durableState(
  persistence: PostgresFlarexPersistence,
  scopeUuid: string,
) {
  const result = await persistence.query<{
    revisions: string;
    current_rows: string;
    commit_headers: string;
    commit_changes: string;
    outcomes: string;
    wakes: string;
    last_commit_seq: string;
    last_outbox_seq: string;
  }>(
    `
      select
        (select count(*)::text from fx_app_row_rev
          where scope_uuid = $1) as revisions,
        (select count(*)::text from fx_app_row_current
          where scope_uuid = $1) as current_rows,
        (select count(*)::text from fx_system_commit
          where scope_uuid = $1) as commit_headers,
        (select count(*)::text from fx_system_commit_app_row_change
          where scope_uuid = $1) as commit_changes,
        (select count(*)::text from fx_system_idempotency
          where scope_uuid = $1) as outcomes,
        (select count(*)::text from fx_system_outbox
          where scope_uuid = $1) as wakes,
        last_commit_seq::text,
        last_outbox_seq::text
      from fx_system_scope_clock
      where scope_uuid = $1
    `,
    [scopeUuid],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Missing O06 durable state.");
  return row;
}

async function terminalPublicationState(
  persistence: PostgresFlarexPersistence,
  scopeUuid: string,
  sessionId: string,
) {
  const result = await persistence.query<{
    lifecycle: string;
    leases: string;
    journals: string;
    change_count: number;
    delivery_state: string;
    same_initial_time: boolean;
  }>(
    `
      select session.lifecycle,
        (select count(*)::text from fx_system_snapshot_lease
          where scope_uuid = $1 and session_id = $2) as leases,
        (select count(*)::text from fx_system_tx_journal
          where scope_uuid = $1 and session_id = $2) as journals,
        commit.change_count,
        wake.delivery_state,
        wake.created_at = wake.next_attempt_at as same_initial_time
      from fx_system_tx_session as session
      join fx_system_commit as commit
        on commit.scope_uuid = session.scope_uuid
      join fx_system_outbox as wake
        on wake.scope_uuid = commit.scope_uuid
        and wake.commit_seq = commit.commit_seq
      where session.scope_uuid = $1 and session.session_id = $2
    `,
    [scopeUuid, sessionId],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("Missing O07-B terminal state.");
  return row;
}

async function waitForBlockedPointCommit(
  persistence: PostgresFlarexPersistence,
  expectedBlocked: number,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await persistence.query<{ blocked: number }>(
      `
        select count(*)::int as blocked
        from pg_stat_activity
        where datname = current_database()
          and wait_event_type = 'Lock'
          and cardinality(pg_blocking_pids(pid)) > 0
          and query ilike '%fx_system_scope_clock%'
      `,
    );
    if ((result.rows[0]?.blocked ?? 0) >= expectedBlocked) return;
    await delay(25);
  }
  throw new Error(
    `Timed out waiting for ${expectedBlocked} blocked O06 transaction(s).`,
  );
}

function requireObservedQuery(
  queries: ReadonlyMap<
    PointCommitSqlOperationV1,
    Readonly<{ readonly sql: string; readonly params: ReadonlyArray<unknown> }>
  >,
  name: PointCommitSqlOperationV1,
) {
  const query = queries.get(name);
  if (query === undefined) throw new Error(`Missing O06 ${name} query.`);
  return query;
}

async function explainObserved(
  persistence: PostgresFlarexPersistence,
  query: Readonly<{
    readonly sql: string;
    readonly params: ReadonlyArray<unknown>;
  }>,
): Promise<string> {
  const client = await persistence.pool.connect();
  try {
    await client.query("set enable_seqscan = off");
    const result = await client.query(
      `explain (format json) ${query.sql}`,
      [...query.params],
    );
    return JSON.stringify(result.rows);
  } finally {
    client.release();
  }
}

async function explainHeadLookup(
  persistence: PostgresFlarexPersistence,
  command: PointCommitTransactionCommandV1,
): Promise<string> {
  const dependency = command.dependencies[0];
  if (dependency === undefined) throw new Error("Missing O06 dependency.");
  const client = await persistence.pool.connect();
  try {
    await client.query("set enable_seqscan = off");
    const result = await client.query(
      `
        explain (format json)
        select current_row.commit_seq, latest.commit_seq
        from (values ($1::integer, $2::bytea)) requested(table_id, row_id)
        left join fx_app_row_current current_row
          on current_row.scope_uuid = $3::uuid
          and current_row.table_id = requested.table_id
          and current_row.row_id = requested.row_id
        left join lateral (
          select revision.commit_seq
          from fx_app_row_rev revision
          where revision.scope_uuid = $3::uuid
            and revision.table_id = requested.table_id
            and revision.row_id = requested.row_id
          order by revision.commit_seq desc
          limit 1
        ) latest on true
      `,
      [
        dependency.tableId,
        appRowIdHexV1ToBytes(dependency.rowId),
        command.sealIdentity.scopeUuid,
      ],
    );
    return JSON.stringify(result.rows);
  } finally {
    client.release();
  }
}

function appTable(
  logicalName: string,
): SchemaManifestAppTableDeclarationInputV1 {
  return {
    logicalName,
    definition: {
      kind: "appDocument",
      definitionVersion: 1,
      documentType: {
        type: "object",
        value: {
          name: {
            fieldType: { type: "string" },
            optional: true,
          },
        },
      },
    },
  };
}

function uuidFactory(prefix: string): () => string {
  let sequence = 1;
  return () => {
    const suffix = sequence.toString().padStart(12, "0");
    sequence += 1;
    return `${prefix}-0000-4000-8000-${suffix}`;
  };
}

function deferredSignal(): Readonly<{
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}> {
  let resolver: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolver = resolve;
  });
  return Object.freeze({
    promise,
    resolve: () => resolver?.(),
  });
}

async function withTimeout<Value>(
  promise: Promise<Value>,
  milliseconds: number,
  label: string,
): Promise<Value> {
  return Promise.race([
    promise,
    delay(milliseconds).then(() => {
      throw new Error(`${label} did not complete within ${milliseconds} ms.`);
    }),
  ]);
}
