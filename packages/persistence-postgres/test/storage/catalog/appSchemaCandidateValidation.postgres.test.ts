import {
  canonicalizeAppDocumentV1,
  decodeAppCreationTimeV1,
} from "flarex-protocol/app-document";
import { decodeAppRowIdHexV1, type AppRowIdHexV1 } from
  "flarex-protocol/app-document-id";
import type { CatalogTableId } from "flarex-protocol/catalog";
import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  type SchemaManifestAppTableDeclarationInputV1,
} from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
  StorageGenerationFenceSchema,
} from "flarex-protocol/storage-authority";
import { Effect } from "effect";
import { and, eq } from "drizzle-orm";
import { logicalCurrencyFixture } from "../../../../medusa-adapter/test/support/logical-currency-fixture";
import { ACCEPT_INSTALLED_ATTEMPT_SCOPE_AUTHORITY_IN_TRANSACTION, RUN_INSTALLED_ACCEPTING_READ_COMMITTED,
  isInstalledAttemptScopeAuthorityTarget } from "../../../src/scope/scopeAuthorityControlRead";
import { fxControlSchemaVersions, fxSystemPreparedMetadataEpoch } from "../../../src/database/schema";
import { openProtectedMetadataFinalGuardScope, closeProtectedMetadataFinalGuardScope,
  flushProtectedMetadataFinalGuards } from "../../../src/execution/preparation/preparedMetadataEpoch";
import { decodeScopeClockRecordResult } from "../../../src/scope/scopeClock";
import { resolveLocatedTrustedScopeAuthorityByIdEffect } from "../../../src/scope/scopeAuthorityResolution";
import { retainPreparedHost } from "../../../src/execution/preparation/preparedHostRuntime";
import { preparedHostTestRuntime } from "../../execution/preparation/preparedHostRuntimeTestSupport";
import { lockScopeClockForUpdateInTransactionEffect } from "../../../src/scope/scopeClock";
import { describe, expect, it } from "vitest";

import {
  createAppSchemaCandidateValidationPort,
  createAppSchemaCandidateWriteGuardPort,
  type PreparedAppSchemaCandidateWriteGuard,
  prepareAppSchemaCandidateWriteGuardEffect,
  captureAppSchemaCandidateWriteGuardPlanningHeadInTransactionEffect,
  prepareAppSchemaCandidateWriteGuardFromPlanningHeadEffect,
  prepareFiniteAppSchemaCandidateWriteGuardFromPlanningHeadEffect,
  prepareFiniteAppSchemaCandidateWriteGuardPortEffect,
  applyAppSchemaCandidateWriteGuardInTransactionEffect,
  createLocatedAppSchemaCandidateValidationTarget,
  advanceAppSchemaCandidateValidationEffect,
  installAppSchemaCandidateValidationEffect,
  loadAppSchemaCandidateValidationEffect,
  settleAppSchemaCandidateValidationEffect,
} from "../../../src/storage/catalog/appSchemaCandidateValidation";
import { appendPreparedAppRowRevisionsInTransactionEffect } from
  "../../../src/storage/documents/appRows";
import type { PostgresFlarexPersistence } from "../../../src/database/postgres";
import type { ScopePhysicalLocator } from "../../../src/scope/scopeMetadataTypes";
import { runEffect, runEffectFailure } from "../../support/effectTestRuntime";
import { insertCurrentScopeClockFixture } from "../../scope/scopeClockFixture";
import { lockInstallationForCurrentTransaction, closeInstallationAdmission } from "../../../src/installation/installationLifecycle";
import {
  postgresUrl,
  useFileScopedPostgresPersistence,
} from "../../support/postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const LOCATOR = Object.freeze({
  kind: "shared_database",
  databaseKey: "primary",
  schemaName: "public",
} as const satisfies ScopePhysicalLocator);

describePostgres("M03-A candidate validation - PostgreSQL", { concurrent: false }, () => {
  it("invalidates retained installed candidate artifacts and reconstructs under the original charged lease", async () => {
    const cleanup: Array<() => Promise<void>> = [];
    try {
      const fixture = await logicalCurrencyFixture("postgres", close => cleanup.push(close), { managedRead: true });
      const { application, managedRead } = fixture;
      if (managedRead === undefined) throw new Error("Missing genuine managed installation");
      const selection = { deploymentId: fixture.deploymentId, scopeId: application.authority.scopeId };
      await runEffect(installAppSchemaCandidateValidationEffect(application.candidateValidation,
        { ...selection, schemaVersionId: application.active.basis.schemaVersionId }));
      const { target } = await runEffect(resolveLocatedTrustedScopeAuthorityByIdEffect(selection, {
        scopeMetadata: application.sessionAuthority.scopeMetadata,
        provisioningReceipts: application.sessionAuthority.provisioningReceipts,
        scopeClockTargets: application.sessionAuthority.scopeSessionTargets,
      }));
      if (!isInstalledAttemptScopeAuthorityTarget(target)) throw new Error("Missing genuine installed accepting target");
      const construct = () => prepareFiniteAppSchemaCandidateWriteGuardPortEffect({
        candidateValidation: application.candidateValidation, pointCommitAuthority: application.sessionAuthority,
      }, { ...selection, profile: "installed", database: fixture.persistence.drizzle, installation: managedRead.readInstallation });
      expect(await runEffectFailure(construct())).toMatchObject({ reason: "compositionMismatch" });
      const retained = await runEffect(retainPreparedHost(preparedHostTestRuntime(fixture.persistence.drizzle), construct()));
      cleanup.push(() => runEffect(retained.close));
      const original = await runEffect(retained.use(Effect.succeed));
      const usage = await runEffect(Effect.fromResult(retained.readUsage()));
      expect(usage.chargedBytes).toBeGreaterThan(0);
      const capture = await target[RUN_INSTALLED_ACCEPTING_READ_COMMITTED](selection, tx => runEffect(Effect.gen(function* () {
        const accepted = yield* target[ACCEPT_INSTALLED_ATTEMPT_SCOPE_AUTHORITY_IN_TRANSACTION](tx, selection);
        return yield* captureAppSchemaCandidateWriteGuardPlanningHeadInTransactionEffect(tx, accepted.authority, application.sessionAuthority);
      })));
      const foreignScope = await target[RUN_INSTALLED_ACCEPTING_READ_COMMITTED](selection, tx => runEffect(Effect.gen(function* () {
        const accepted = yield* target[ACCEPT_INSTALLED_ATTEMPT_SCOPE_AUTHORITY_IN_TRANSACTION](tx, selection);
        return yield* captureAppSchemaCandidateWriteGuardPlanningHeadInTransactionEffect(tx,
          { ...accepted.authority, storageGenerationFence: StorageGenerationFenceSchema.make(accepted.authority.storageGenerationFence + 1n) },
          application.sessionAuthority);
      })));
      expect(await runEffectFailure(prepareAppSchemaCandidateWriteGuardFromPlanningHeadEffect(original, foreignScope)))
        .toMatchObject({ reason: "compositionMismatch" });
      expect(await runEffectFailure(prepareFiniteAppSchemaCandidateWriteGuardFromPlanningHeadEffect(original, foreignScope, selection)))
        .toMatchObject({ reason: "concurrentStateChange" });
      const prepared = await runEffect(prepareFiniteAppSchemaCandidateWriteGuardFromPlanningHeadEffect(original, capture, selection));
      const users = application.schemaAuthority.tables.find(table => table.logicalName === "users");
      if (users === undefined) throw new Error("Missing actual Application users table");
      const id = rowId(90);
      const document = await canonicalizeAppDocumentV1({ tableId: users.tableId, rowId: id,
        creationTime: decodeAppCreationTimeV1(1_750_000_000_000), fields: { name: "protected candidate" } });
      const liveRows = [{ tableId: users.tableId, rowId: id, document }];
      const apply = (guard: typeof original, preparation: PreparedAppSchemaCandidateWriteGuard, writes = liveRows) =>
        target[RUN_INSTALLED_ACCEPTING_READ_COMMITTED](selection, tx => runEffect(Effect.gen(function* () {
          const accepted = yield* target[ACCEPT_INSTALLED_ATTEMPT_SCOPE_AUTHORITY_IN_TRANSACTION](tx, selection);
          const clock = yield* Effect.fromResult(decodeScopeClockRecordResult(accepted.row));
          openProtectedMetadataFinalGuardScope(tx);
          const result = yield* applyAppSchemaCandidateWriteGuardInTransactionEffect(tx, guard, preparation,
            accepted.authority, clock, CommitSeqSchema.make(clock.lastCommitSeq + 1n), writes).pipe(Effect.result);
          yield* flushProtectedMetadataFinalGuards(tx);
          return result;
        }).pipe(Effect.ensuring(Effect.sync(() => closeProtectedMetadataFinalGuardScope(tx))))));
      expect(await apply(original, prepared)).toMatchObject({ _tag: "Success", success: { status: "unchanged" } });
      const identity = and(eq(fxControlSchemaVersions.deploymentId, selection.deploymentId),
        eq(fxControlSchemaVersions.schemaVersionId, application.active.basis.schemaVersionId));
      const [artifact] = await fixture.control.drizzle.select().from(fxControlSchemaVersions).where(identity);
      const [epochBefore] = await fixture.control.drizzle.select().from(fxSystemPreparedMetadataEpoch);
      if (artifact === undefined || epochBefore === undefined) throw new Error("Missing genuine protected artifact");
      expect(artifact.manifestBytes.byteLength).toBeGreaterThan(0);
      await fixture.control.drizzle.update(fxControlSchemaVersions)
        .set({ createdAt: new Date(artifact.createdAt.getTime() + 1_000) }).where(identity);
      const [epochAfter] = await fixture.control.drizzle.select().from(fxSystemPreparedMetadataEpoch);
      expect(epochAfter?.generation).toBe(epochBefore.generation + 1n);
      expect(await apply(original, prepared)).toMatchObject({ _tag: "Failure", failure: { reason: "concurrentStateChange" } });
      const reconstructedGeneration = await runEffect(retained.reconstruct(() => construct()));
      const reconstructed = await runEffect(reconstructedGeneration.use(Effect.succeed));
      expect((await runEffect(Effect.fromResult(retained.readUsage()))).chargedBytes).toBeGreaterThan(usage.chargedBytes);
      const freshPreparation = await runEffect(prepareFiniteAppSchemaCandidateWriteGuardFromPlanningHeadEffect(reconstructed, capture, selection));
      expect(await apply(reconstructed, freshPreparation)).toMatchObject({ _tag: "Success", success: { status: "unchanged" } });
      expect(await apply(original, freshPreparation)).toMatchObject({ _tag: "Failure", failure: { reason: "compositionMismatch" } });
      const foreignLease = await runEffect(retainPreparedHost(preparedHostTestRuntime(fixture.persistence.drizzle), construct()));
      cleanup.push(() => runEffect(foreignLease.close));
      const foreignGuard = await runEffect(foreignLease.use(Effect.succeed));
      const foreignPreparation = await runEffect(prepareFiniteAppSchemaCandidateWriteGuardFromPlanningHeadEffect(foreignGuard, capture, selection));
      expect(await apply(reconstructed, foreignPreparation)).toMatchObject({ _tag: "Failure", failure: { reason: "compositionMismatch" } });
      await runEffect(foreignLease.close);
      expect(await apply(reconstructed, freshPreparation)).toMatchObject({ _tag: "Success", success: { status: "unchanged" } });
      const invalidDocument = await canonicalizeAppDocumentV1({ tableId: users.tableId, rowId: id,
        creationTime: decodeAppCreationTimeV1(1_750_000_000_000), fields: { name: 42 } });
      expect(await apply(reconstructed, freshPreparation, [{ tableId: users.tableId, rowId: id, document: invalidDocument }]))
        .toMatchObject({ _tag: "Success", success: { status: "candidateFailed" } });
      await runEffect(retained.close);
      expect(await runEffectFailure(prepareFiniteAppSchemaCandidateWriteGuardFromPlanningHeadEffect(reconstructed, capture, selection)))
        .toMatchObject({ reason: "notIssued" });
      expect(await apply(reconstructed, freshPreparation)).toMatchObject({ _tag: "Failure", failure: { reason: "notIssued" } });
    } finally { for (const close of cleanup.reverse()) await close(); }
  }, 240_000);

  describe("Scope-clock candidate validation", { concurrent: false }, () => {
    const withPersistence = useFileScopedPostgresPersistence();

    it("serializes concurrent replacements behind the scope clock", async () => {
      await withPersistence(async persistence => {
        const fixture = await fixtureFor(persistence, "concurrency");
        await persistence.insertScopeMetadata({
          deploymentId: fixture.deploymentId,
          scopeId: ScopeIdSchema.make("scope_m03_pg_peer"),
          physicalLocator: LOCATOR,
        });
        await runEffect(installAppSchemaCandidateValidationEffect(
          port(fixture),
          input(fixture, fixture.schemaVersionId),
        ));

        const dependencies = portDependencies(fixture);
        const pointCommitAuthority = { scopeMetadata: dependencies.authority.scopeMetadata,
          provisioningReceipts: dependencies.authority.provisioningReceipts,
          scopeSessionTargets: dependencies.authority.scopeClockTargets };
        const retained = await runEffect(retainPreparedHost(preparedHostTestRuntime(persistence.drizzle),
          prepareFiniteAppSchemaCandidateWriteGuardPortEffect({
            candidateValidation: createAppSchemaCandidateValidationPort(dependencies), pointCommitAuthority,
          }, { profile: "fullArtifactProof", deploymentId: fixture.deploymentId, scopeId: fixture.scopeId })));
        const guard = await runEffect(retained.use(Effect.succeed));
        let preparation: PreparedAppSchemaCandidateWriteGuard;
        const blocker = await persistence.pool.connect();
        let released = false;
        let replacements: ReadonlyArray<PromiseSettledResult<Awaited<
          ReturnType<typeof install>
        >>> | undefined;
        try {
          await blocker.query("begin");
          const pid = await blocker.query<{ pid: number }>(
            "select pg_backend_pid()::int as pid",
          );
          const blockerPid = pid.rows[0]?.pid;
          if (blockerPid === undefined) throw new Error("Missing blocker PID.");
          await blocker.query(
            `select 1 from fx_system_scope_clock where scope_id = $1 for update`,
            [fixture.scopeId],
          );
          await blocker.query(
            "select 1 from fx_system_app_schema_candidate_validation where scope_id = $1 for update",
            [fixture.scopeId],
          );
          const clock = await fixture.target.getCurrentClock(fixture.scopeId);
          if (clock === null) throw new Error("Missing candidate capture clock.");
          const capture = await persistence.drizzle.transaction(tx => runEffect(
            captureAppSchemaCandidateWriteGuardPlanningHeadInTransactionEffect(tx,
              { deploymentId: fixture.deploymentId, scopeId: fixture.scopeId, physicalLocator: LOCATOR,
                storageGeneration: clock.storageGeneration, storageGenerationFence: clock.storageGenerationFence,
                epoch: clock.epoch, lastCommitSeq: clock.lastCommitSeq }, pointCommitAuthority),
          ));
          const finiteInput = { deploymentId: fixture.deploymentId, scopeId: fixture.scopeId };
          expect(await runEffectFailure(prepareFiniteAppSchemaCandidateWriteGuardFromPlanningHeadEffect(guard,
            { ...capture }, finiteInput))).toMatchObject({ reason: "notIssued" });
          expect(await runEffectFailure(prepareFiniteAppSchemaCandidateWriteGuardFromPlanningHeadEffect(guard,
            capture, { ...finiteInput, scopeId: ScopeIdSchema.make("scope_m03_pg_wrong_capture") })))
            .toMatchObject({ reason: "compositionMismatch" });
          const foreignGuard = createAppSchemaCandidateWriteGuardPort({
            candidateValidation: createAppSchemaCandidateValidationPort(dependencies), pointCommitAuthority: { ...pointCommitAuthority },
          });
          expect(await runEffectFailure(prepareFiniteAppSchemaCandidateWriteGuardFromPlanningHeadEffect(foreignGuard,
            capture, finiteInput))).toMatchObject({ reason: "compositionMismatch" });
          preparation = await runEffect(prepareFiniteAppSchemaCandidateWriteGuardFromPlanningHeadEffect(guard,
            capture, finiteInput).pipe(Effect.timeout(2_000)));
          const first = install(fixture, fixture.replacementSchemaVersionId);
          const second = install(fixture, fixture.emptySchemaVersionId);
          await waitForBlockedBy(persistence, blockerPid, 2);
          await blocker.query("commit");
          released = true;
          replacements = await Promise.allSettled([first, second]);
        } finally {
          if (!released) await blocker.query("rollback").catch(() => undefined);
          blocker.release();
        }
        await persistence.drizzle.transaction(tx => runEffect(Effect.gen(function* () {
          const clock = yield* lockScopeClockForUpdateInTransactionEffect(tx, fixture.scopeId);
          const authority = { deploymentId: fixture.deploymentId, scopeId: fixture.scopeId,
            physicalLocator: LOCATOR, storageGeneration: clock.storageGeneration,
            storageGenerationFence: clock.storageGenerationFence, epoch: clock.epoch,
            lastCommitSeq: clock.lastCommitSeq };
          expect(yield* Effect.flip(applyAppSchemaCandidateWriteGuardInTransactionEffect(tx,
            guard, preparation, authority, clock, CommitSeqSchema.make(1n), [])))
            .toMatchObject({ reason: "concurrentStateChange" });
        })));
        expect(replacements).toBeDefined();
        const successful = (replacements ?? []).flatMap(result =>
          result.status === "fulfilled" ? [result.value] : []
        );
        expect(successful).toHaveLength(2);
        expect(successful.map(result => result.disposition)).toEqual([
          "superseded",
          "superseded",
        ]);
        expect(successful.map(result => result.head.frame.attemptFence).sort())
          .toEqual([2n, 3n]);
        const finalResult = successful.find(
          result => result.head.frame.attemptFence === 3n,
        );
        if (finalResult === undefined) {
          throw new Error("Concurrent replacements produced no final head.");
        }
        await expect(runEffect(loadAppSchemaCandidateValidationEffect(
          port(fixture),
          input(fixture, finalResult.head.schemaVersionId),
        ))).resolves.toMatchObject({
          status: "present",
          head: { frame: { attemptFence: 3n } },
        });
        const rows = await persistence.query<{ count: number }>(
          `select count(*)::int as count
           from fx_system_app_schema_candidate_validation
          where scope_id = $1`,
          [fixture.scopeId],
        );
        expect(rows.rows[0]?.count).toBe(1);
      });
    }, 180_000);

    it("scans the pinned frontier, settles, and refuses malformed state", async () => {
      await withPersistence(async persistence => {
        const fixture = await fixtureFor(persistence, "frontier");
        await appendLive(fixture, rowId(1), 1n, null, { name: "before" });
        await setClockCommit(fixture, 1n);
        await install(fixture, fixture.schemaVersionId);
        await appendLive(fixture, rowId(1), 2n, 1n, { name: 42 });
        await setClockCommit(fixture, 2n);

        await expect(runEffect(advanceAppSchemaCandidateValidationEffect(
          port(fixture),
          input(fixture, fixture.schemaVersionId),
        ))).resolves.toMatchObject({
          disposition: "readyToSettle",
          validatedRows: 1,
          head: { frame: {
            frontierCommitSeq: 1n,
            validatedRowCount: 1n,
          } },
        });
        const settled = await runEffect(settleAppSchemaCandidateValidationEffect(
          port(fixture),
          input(fixture, fixture.schemaVersionId),
        ));
        expect(settled.frame).toMatchObject({
          kind: "app_schema_candidate_validation_receipt",
          frontierCommitSeq: 1n,
          settlementCommitSeq: 2n,
          scanCompleted: true,
        });
        await expect(persistence.query(
          `update fx_system_app_schema_candidate_validation
            set frame_byte_length = 0
          where scope_id = $1`,
          [fixture.scopeId],
        )).rejects.toThrow();
        await expect(runEffect(loadAppSchemaCandidateValidationEffect(
          port(fixture),
          input(fixture, fixture.schemaVersionId),
        ))).resolves.toMatchObject({
          status: "present",
          head: { frame: { kind: "app_schema_candidate_validation_receipt" } },
        });
      });
    }, 180_000);

    it("uses bounded current-directory and authenticated-root indexes", async () => {
      await withPersistence(async persistence => {
        const fixture = await fixtureFor(persistence, "frontier_plan");
        await appendLive(fixture, rowId(1), 1n, null, { name: "eligible" });
        await setClockCommit(fixture, 1n);
        await install(fixture, fixture.schemaVersionId);

        await persistence.query(
          `insert into fx_app_row_rev
          (scope_uuid, table_id, row_id, commit_seq, prev_commit_seq,
           write_epoch_uuid, schema_version_id, creation_time,
           value_codec_version, is_tombstone, value_bytes,
           value_sha256)
         select clock.scope_uuid, $2::integer,
           decode(lpad(to_hex(series.value), 32, '0'), 'hex'),
           2, null, authority.epoch_uuid, $3, 1750000000000,
           1, true, null, null
         from fx_system_scope_clock as clock
         join fx_system_scope_execution_authority as authority using (scope_id)
         cross join generate_series(1000, 5999) as series(value)
         where clock.scope_id = $1`,
          [fixture.scopeId, fixture.tableId, fixture.schemaVersionId],
        );
        await persistence.query(
          `insert into fx_app_row_current
          (scope_uuid, table_id, row_id, commit_seq)
         select clock.scope_uuid, $2::integer,
           decode(lpad(to_hex(series.value), 32, '0'), 'hex'), 2
         from fx_system_scope_clock as clock
         cross join generate_series(1000, 5999) as series(value)
         where clock.scope_id = $1`,
          [fixture.scopeId, fixture.tableId],
        );
        await persistence.query("analyze fx_app_row_rev");
        await persistence.query("analyze fx_app_row_current");

        for (const after of [null, rowId(3000)] as const) {
          const plan = await explainCurrentDirectory(
            persistence,
            fixture,
            after,
          );
          const planText = JSON.stringify(plan.rows);
          expect(planText).toContain(
            "fx_app_row_current_scope_uuid_table_id_row_id_pk",
          );
          expect(planText).toContain("fx_app_row_rev_first_identity_unique");
        }
        await expect(runEffect(advanceAppSchemaCandidateValidationEffect(
          port(fixture),
          input(fixture, fixture.schemaVersionId),
        ))).resolves.toMatchObject({
          disposition: "advanced",
          processedIdentities: 128,
          validatedRows: 1,
        });
      });
    }, 180_000);
  });
});

interface Fixture {
  readonly persistence: PostgresFlarexPersistence;
  readonly deploymentId: string;
  readonly scopeId: ReturnType<typeof ScopeIdSchema.make>;
  readonly epoch: ReturnType<typeof ScopeEpochSchema.make>;
  readonly schemaVersionId: ReturnType<typeof CatalogSchemaVersionIdSchema.make>;
  readonly replacementSchemaVersionId: ReturnType<typeof CatalogSchemaVersionIdSchema.make>;
  readonly emptySchemaVersionId: ReturnType<typeof CatalogSchemaVersionIdSchema.make>;
  readonly tableId: CatalogTableId;
  readonly target: ReturnType<typeof createLocatedAppSchemaCandidateValidationTarget>;
}

async function fixtureFor(
  persistence: PostgresFlarexPersistence,
  suffix: string,
): Promise<Fixture> {
  const deploymentId = `deployment_schema_validation_pg_${suffix}`;
  const scopeId = ScopeIdSchema.make(
    "scope_83000000-0000-4000-8000-000000000001",
  );
  const epoch = ScopeEpochSchema.make(
    "epoch_84000000-0000-4000-8000-000000000001",
  );
  const schemaVersionId = CatalogSchemaVersionIdSchema.make(
    `schema_validation_pg_${suffix}_a`,
  );
  const replacementSchemaVersionId = CatalogSchemaVersionIdSchema.make(
    `schema_validation_pg_${suffix}_b`,
  );
  const emptySchemaVersionId = CatalogSchemaVersionIdSchema.make(
    `schema_validation_pg_${suffix}_empty`,
  );
  await persistence.insertDeploymentMetadata({
    deploymentId,
    projectId: `project_schema_validation_pg_${suffix}`,
  });
  await persistence.insertScopeMetadata({ scopeId, deploymentId, physicalLocator: LOCATOR });
  await insertCurrentScopeClockFixture(persistence.drizzle, { scopeId, epoch });
  const published = await persistence.publishAppSchemaV1({
    deploymentId,
    schemaVersionId,
    version: CatalogSchemaVersionSchema.make(1),
    tables: [appTable("recipes")],
    indexes: [],
  });
  await persistence.publishAppSchemaV1({
    deploymentId,
    schemaVersionId: replacementSchemaVersionId,
    version: CatalogSchemaVersionSchema.make(2),
    tables: [appTable("recipes")],
    indexes: [],
  });
  await persistence.publishAppSchemaV1({
    deploymentId,
    schemaVersionId: emptySchemaVersionId,
    version: CatalogSchemaVersionSchema.make(3),
    tables: [],
    indexes: [],
  });
  const table = published.manifest.tableDefinitions.tables[0];
  if (table === undefined) throw new Error("Missing recipes table.");
  return Object.freeze({
    persistence,
    deploymentId,
    scopeId,
    epoch,
    schemaVersionId,
    replacementSchemaVersionId,
    emptySchemaVersionId,
    tableId: table.tableId,
    target: createLocatedAppSchemaCandidateValidationTarget(
      persistence.drizzle,
      LOCATOR,
    ),
  });
}

async function appendLive(
  fixture: Fixture,
  id: AppRowIdHexV1,
  commitSeq: bigint,
  prevCommitSeq: bigint | null,
  fields: Readonly<Record<string, unknown>>,
) {
  const creationTime = decodeAppCreationTimeV1(1_750_000_000_000);
  const document = await canonicalizeAppDocumentV1({
    tableId: fixture.tableId,
    rowId: id,
    creationTime,
    fields,
  });
  await fixture.persistence.drizzle.transaction(async tx => {
    await runEffect(lockInstallationForCurrentTransaction(tx));
    try {
      await runEffect(appendPreparedAppRowRevisionsInTransactionEffect(tx, [{
          kind: "live",
          scopeId: fixture.scopeId,
          tableId: fixture.tableId,
          rowId: id,
          writeEpoch: fixture.epoch,
          commitSeq: CommitSeqSchema.make(commitSeq),
          prevCommitSeq: prevCommitSeq === null
            ? null
            : CommitSeqSchema.make(prevCommitSeq),
          schemaVersionId: fixture.schemaVersionId,
          creationTime,
          document,
        }]));
    } finally { closeInstallationAdmission(tx); }
  });
}

function setClockCommit(fixture: Fixture, commitSeq: bigint) {
  return fixture.persistence.query(
    "update fx_system_scope_clock set last_commit_seq = $2 where scope_id = $1",
    [fixture.scopeId, commitSeq.toString()],
  );
}

function rowId(value: number): AppRowIdHexV1 {
  return decodeAppRowIdHexV1(value.toString(16).padStart(32, "0"));
}

function port(fixture: Fixture) {
  return createAppSchemaCandidateValidationPort(portDependencies(fixture));
}

function portDependencies(fixture: Fixture) {
  return {
    controlDb: fixture.persistence.drizzle,
    authority: {
      scopeMetadata: {
        getScopeMetadata: (scopeId: Fixture["scopeId"]) =>
          fixture.persistence.getScopeMetadata(scopeId),
        getScopeMetadataByDeploymentId: (deploymentId: string) =>
          fixture.persistence.getScopeMetadataByDeploymentId(deploymentId),
      },
      provisioningReceipts: {
        getScopeAuthorityProvisioningReceipt: async () => null,
      },
      scopeClockTargets: { resolve: async () => fixture.target },
    },
  };
}

function input(fixture: Fixture, schemaVersionId: Fixture["schemaVersionId"]) {
  return Object.freeze({ deploymentId: fixture.deploymentId, scopeId: fixture.scopeId, schemaVersionId });
}

function install(fixture: Fixture, schemaVersionId: Fixture["schemaVersionId"]) {
  return runEffect(installAppSchemaCandidateValidationEffect(
    port(fixture),
    input(fixture, schemaVersionId),
  ));
}

function appTable(logicalName: string): SchemaManifestAppTableDeclarationInputV1 {
  return {
    logicalName,
    definition: {
      kind: "appDocument",
      definitionVersion: 1,
      documentType: {
        type: "object",
        value: {
          name: { fieldType: { type: "string" }, optional: false },
        },
      },
    },
  };
}

async function waitForBlockedBy(
  persistence: PostgresFlarexPersistence,
  blockerPid: number,
  expected: number,
) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await persistence.query<{ blocked: number }>(
      `with recursive blocked(pid) as (
         select activity.pid
           from pg_stat_activity as activity
          where $1::int = any(pg_blocking_pids(activity.pid))

         union

         select activity.pid
           from pg_stat_activity as activity
           join blocked as blocker
             on blocker.pid = any(pg_blocking_pids(activity.pid))
       )
       select count(*)::int as blocked
         from blocked
         join pg_stat_activity as activity using (pid)
        where activity.datname = current_database()`,
      [blockerPid],
    );
    if ((result.rows[0]?.blocked ?? 0) >= expected) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Expected ${expected} candidate-validation transactions to block.`);
}

function explainCurrentDirectory(
  persistence: PostgresFlarexPersistence,
  fixture: Fixture,
  afterRowId: AppRowIdHexV1 | null,
) {
  const after = afterRowId === null
    ? "true"
    : `(current_row.table_id, current_row.row_id)
       > (${fixture.tableId}, decode('${afterRowId}', 'hex'))`;
  return persistence.query(
    `explain (format json)
     select current_row.table_id, current_row.row_id,
       root_revision.commit_seq, visible.commit_seq, visible.is_tombstone
     from fx_app_row_current as current_row
     left join lateral (
       select revision.commit_seq
       from fx_app_row_rev as revision
       where revision.scope_uuid = current_row.scope_uuid
         and revision.table_id = current_row.table_id
         and revision.row_id = current_row.row_id
         and revision.prev_commit_seq is null
       limit 1
     ) as root_revision on true
     left join lateral (
       select revision.commit_seq, revision.is_tombstone
       from fx_app_row_rev as revision
       where revision.scope_uuid = current_row.scope_uuid
         and revision.table_id = current_row.table_id
         and revision.row_id = current_row.row_id
         and revision.commit_seq <= 1
       order by revision.commit_seq desc
       limit 1
     ) as visible on true
     where current_row.scope_uuid = (
       select scope_uuid from fx_system_scope_clock where scope_id = $1
     )
       and ${after}
     order by current_row.table_id asc, current_row.row_id asc
     limit 129`,
    [fixture.scopeId],
  );
}
