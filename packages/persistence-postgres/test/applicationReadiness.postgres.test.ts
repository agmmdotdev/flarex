import { webcrypto } from "node:crypto";
import type { PoolClient } from "pg";

import {
  canonicalizeApplicationManifestV1,
  type ApplicationManifestV1,
} from "@flarex/analysis/application-analysis";
import {
  hashCanonicalTaskCatalogV1,
  makeStandardApplicationTaskSha256V1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import {
  produceApplicationTaskBindingsV1,
} from "@flarex/standard-application-definition/internal/application-task-binding-v1";
import { prepareStandardApplicationDefinitionV1 } from
  "@flarex/standard-application-definition/internal/prepared-definition-v1";
import { Effect, Result } from "effect";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import {
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
  SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
} from "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  SchemaManifestAppIndexDescriptorSchema,
  type CatalogSchemaVersionId,
} from "flarex-protocol/schema-manifest";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { APP_UNIQUE_KEY_CODEC_IDENTITY_V1, APP_UNIQUE_KEY_CODEC_VERSION_V1, decodeAppUniqueConstraintPhysicalSpecV1 } from "flarex-protocol/app-unique-constraint-definition";
import { beforeAll, describe, expect, it } from "vitest";

import {
  advanceAppSchemaCandidateValidationEffect,
  createAppSchemaCandidateReadinessPort,
  createAppSchemaCandidateValidationPort,
  createLocatedAppSchemaCandidateValidationTarget,
  installAppSchemaCandidateValidationEffect,
  settleAppSchemaCandidateValidationEffect,
} from "../src/appSchemaCandidateValidation";
import {
  createAppUniqueConstraintDefinitionPortV1,
} from "../src/appUniqueConstraintCommitV1";
import {
  createAppUniqueConstraintSetEligibilityPortV1,
  advanceAppUniqueConstraintSetBackfillV1Effect,
  reconcileAppUniqueConstraintSetBuildV1Effect,
} from "../src/appUniqueConstraintSetBuildV1";
import { ensureAppUniqueConstraintDefinitionBindingV1InTransaction, prepareAppUniqueConstraintDefinitionBindingV1Effect } from "../src/appUniqueConstraintDefinitions";
import {
  closeAppUniqueConstraintSetV1InTransactionEffect,
  prepareAppUniqueConstraintSetClosureV1Effect,
} from "../src/appUniqueConstraintSetClosureV1";
import {
  makeApplicationAnalysisRepository,
  type ApplicationAnalysisAuthority,
} from "../src/applicationAnalysisRegistration";
import { makeApplicationPublicationRepository } from
  "../src/applicationPublication";
import {
  makeApplicationReadinessRepository,
  validateApplicationPhysicalReadinessInTransactionEffect,
  type ApplicationReadinessResult,
} from "../src/applicationReadiness";
import { makeApplicationActivationRepository } from
  "../src/applicationActivation";
import { makeApplicationSchemaAuthorityPublisher } from
  "../src/applicationSchemaAuthority";
import {
  createApplicationTaskCatalogSnapshotPort,
  makeApplicationTaskBindingRepository,
} from "../src/applicationTaskBindings";
import { createApplicationRelationTaskCatalogSnapshotPort } from
  "../src/applicationRelationTaskBindings";
import { lockScopeClockForSnapshotReadInTransactionEffect } from
  "../src/scopeClock";
import {
  loadPublishedPhysicalRequirementSnapshotV1,
  reconcilePublishedIndexBuildsV1Effect,
} from "../src/indexBuildReconciliation";
import {
  buildIntrinsicCreationTimeIndexV1Effect,
} from "../src/intrinsicCreationTimeIndexBuildV1";
import {
  createPostgresLocatedSplitScopeClockTarget,
  createPostgresSplitScopeAuthorityProvisioner,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import { createPointCommitPublisherPortV1 } from
  "../src/pointCommitTransaction";
import {
  beginPhysicalDefinitionDrainingEffect,
  cancelPhysicalDefinitionDrainingEffect,
  createPhysicalDefinitionLifecyclePort,
  preparePhysicalDefinitionLifecycleReadinessEffect,
  preparePhysicalDefinitionLifecycleSubjectEffect,
} from "../src/physicalDefinitionLifecycle";
import { getScopeAuthorityProvisioningReceipt } from
  "../src/scopeAuthorityProvisioningReceipt";
import { resolveLocatedTrustedScopeAuthorityEffect } from
  "../src/scopeAuthorityResolution";
import type { SplitScopePhysicalLocator } from
  "../src/scopeMetadataTypes";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  postgresUrl,
  withTemporaryPostgresPersistencePair,
} from "./postgresHelpers";
import { withPostgresExecutionObservation } from
  "./postgresExecutionObservation";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const ROOT = "a".repeat(64);
const EXECUTION_SOURCE = "b".repeat(64);
const SCHEMA_SOURCE = "c".repeat(64);
const RUNTIME_HOST_IDENTITY = "flarex.test/application-runtime-host";
const COMPATIBILITY_DATE = "2026-08-12";
const LOCATOR = Object.freeze({
  kind: "database_per_scope",
  databaseKey: "application_readiness_postgres_target",
  schemaName: "public",
}) satisfies SplitScopePhysicalLocator;
const taskSha256 = makeStandardApplicationTaskSha256V1(input =>
  globalThis.crypto.subtle.digest("SHA-256", input)
);

beforeAll(() => {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
  }
});

describePostgres("AA-R6 Application readiness - PostgreSQL", () => {
  it("loads the locked revision's candidate, analysis and legacy publication in one statement", async () => {
    await withTemporaryPostgresPersistencePair(async (control, target) => {
      const fixture = await readinessFixture(control, target);
      await prepareReadinessAuthorities(fixture);
      const measured = await withPostgresExecutionObservation(
        target.pool,
        () => runEffect(fixture.repository.readReady(fixture.input)),
        { attributeStatements: true },
      );
      expect(measured.value.status).toBe("not_ready");
      const selectedFamilies = [
        "fx_system_application_candidate_v1",
        "fx_system_application_analysis_v1",
        "fx_system_application_publication_v1",
      ];
      const selected = measured.observation.statementShapes?.filter(shape =>
        shape.families.some(family => selectedFamilies.includes(family)));
      expect(selected).toHaveLength(1);
      expect(selected?.[0]?.families).toEqual([
        ...selectedFamilies,
        "fx_system_application_revision_v2",
      ].sort());
      expect(selected?.[0]?.ordinals).toHaveLength(1);
    });
  }, 120_000);
  it("keeps candidate refusal order after a joined fetch and classifies a joined SQL failure", async () => {
    await withTemporaryPostgresPersistencePair(async (control, target) => {
      const fixture = await readinessFixture(control, target);
      await target.query(
        "update fx_system_application_analysis_v1 set manifest_bytes = decode('00', 'hex') where scope_id = $1",
        [fixture.authority.scopeId],
      );
      await target.query(
        "update fx_system_application_candidate_v1 set storage_generation_fence = storage_generation_fence + 1 where scope_id = $1",
        [fixture.authority.scopeId],
      );
      const candidateFailure = await runEffect(Effect.result(
        fixture.repository.readReady(fixture.input),
      ));
      expect(Result.isFailure(candidateFailure)).toBe(true);
      if (Result.isFailure(candidateFailure)) {
        expect(candidateFailure.failure).toMatchObject({ reason: "authorityChanged" });
      }

      const patched = new Map<PoolClient, PoolClient["query"]>();
      let injected = 0;
      let faultCode: "42P01" | "40001" = "42P01";
      const onAcquire = (client: PoolClient) => {
        const original = client.query;
        client.query = new Proxy(original, {
          apply(targetQuery, receiver, args: unknown[]) {
            const first = args[0];
            const text = typeof first === "string" ? first :
              first !== null && typeof first === "object" && "text" in first
                ? first.text : null;
            if (typeof text === "string" &&
              text.includes("fx_system_application_candidate_v1") &&
              text.includes("fx_system_application_analysis_v1") &&
              text.includes("fx_system_application_publication_v1")) {
              injected++;
              return Promise.reject(Object.assign(
                new Error("Injected joined read failure"), { code: faultCode },
              ));
            }
            return Reflect.apply(targetQuery, receiver, args);
          },
        });
        patched.set(client, original);
      };
      const onRelease = (_error: Error | undefined, client: PoolClient) => {
        const original = patched.get(client);
        if (original !== undefined) client.query = original;
        patched.delete(client);
      };
      target.pool.on("acquire", onAcquire);
      target.pool.on("release", onRelease);
      try {
        for (const [code, retryable] of [
          ["42P01", false],
          ["40001", true],
        ] as const) {
          faultCode = code;
          const sqlFailure = await runEffect(Effect.result(
            fixture.repository.readReady(fixture.input),
          ));
          expect(Result.isFailure(sqlFailure)).toBe(true);
          if (Result.isFailure(sqlFailure)) {
            expect(sqlFailure.failure).toMatchObject({ reason: "resourceFailure", retryable });
          }
        }
        expect(injected).toBe(2);
      } finally {
        target.pool.off("acquire", onAcquire);
        target.pool.off("release", onRelease);
        for (const [client, original] of patched) client.query = original;
      }
      const afterFault = await runEffect(Effect.result(
        fixture.repository.readReady(fixture.input),
      ));
      expect(Result.isFailure(afterFault)).toBe(true);
      if (Result.isFailure(afterFault)) {
        expect(afterFault.failure).toMatchObject({ reason: "authorityChanged" });
      }
    });
  }, 120_000);
  it("rechecks task authority after a key-share clock lock permits a non-key update", async () => {
    await withTemporaryPostgresPersistencePair(async (control, target) => {
      const fixture = await readinessFixture(control, target);
      let releaseLocked: (() => void) | undefined;
      const locked = new Promise<void>(resolve => { releaseLocked = resolve; });
      let releaseWriter: (() => void) | undefined;
      const writerDone = new Promise<void>(resolve => { releaseWriter = resolve; });
      const reader = target.drizzle.transaction(async tx => {
        const clock = await runEffect(lockScopeClockForSnapshotReadInTransactionEffect(
          tx, fixture.authority.scopeId,
        ));
        expect(clock.storageGeneration).toBe("flarexdb_v1");
        releaseLocked?.();
        await writerDone;
        const legacy = await runEffectFailure(
          createApplicationTaskCatalogSnapshotPort().loadInTransaction(
            tx, fixture.authority, fixture.input.revisionId,
          ),
        );
        const relation = await runEffectFailure(
          createApplicationRelationTaskCatalogSnapshotPort().loadInTransaction(
            tx, fixture.authority, fixture.input.revisionId,
          ),
        );
        expect(legacy).toMatchObject({ reason: "authorityChanged" });
        expect(relation).toMatchObject({ reason: "authorityChanged" });
      });
      let failure: unknown;
      try {
        // Race the handshake with reader completion so an early reader failure
        // cannot leave the test waiting for a signal that will never arrive.
        await Promise.race([locked, reader]);
        const writer = await target.pool.connect();
        try {
          await writer.query("begin");
          await writer.query("set local lock_timeout = '2s'");
          await writer.query(
            "update fx_system_scope_clock set storage_generation = 'legacy_v1' where scope_id = $1",
            [fixture.authority.scopeId],
          );
          await writer.query("commit");
        } catch (error) {
          await writer.query("rollback");
          throw error;
        } finally {
          writer.release();
        }
      } catch (error) {
        failure = error;
      } finally {
        releaseWriter?.();
        try {
          await reader;
        } catch (error) {
          failure ??= error;
        }
      }
      if (failure !== undefined) throw failure;
    });
  }, 120_000);
  it("retries when the retained publisher claims the tentative version", async () => {
    await withTemporaryPostgresPersistencePair(async (control) => {
      const deploymentId = "deployment_application_schema_interleaving";
      await control.insertDeploymentMetadata({
        deploymentId,
        projectId: "project_application_schema_interleaving",
      });
      let markFirstTransactionEntered: (() => void) | undefined;
      const firstTransactionEntered = new Promise<void>(resolve => {
        markFirstTransactionEntered = resolve;
      });
      let releaseFirstTransaction: (() => void) | undefined;
      const firstTransactionRelease = new Promise<void>(resolve => {
        releaseFirstTransaction = resolve;
      });
      let first = true;
      const publisher = makeApplicationSchemaAuthorityPublisher({
        db: control.drizzle,
        runTransaction: async run => {
          if (first) {
            first = false;
            markFirstTransactionEntered?.();
            await firstTransactionRelease;
          }
          return control.drizzle.transaction(run);
        },
      });
      const application = runEffect(publisher.publish({
        deploymentId,
        manifest: applicationManifest().manifest,
      }));
      await firstTransactionEntered;
      await control.publishAppSchemaV1({
        deploymentId,
        schemaVersionId: CatalogSchemaVersionIdSchema.make("retained_race"),
        version: CatalogSchemaVersionSchema.make(1),
        tables: [],
        indexes: [],
      });
      releaseFirstTransaction?.();

      const authority = await application;
      const reservations = await control.query<{
        schema_version: number;
      }>(
        `select schema_version
           from fx_control_application_schema_authority_v1
          where deployment_id = $1`,
        [deploymentId],
      );

      expect(authority.schemaVersion).toBe(2);
      expect(reservations.rows).toEqual([{ schema_version: 2 }]);
    });
  }, 240_000);

  it("settles one table-bearing split-store revision under real locks", async () => {
    await withTemporaryPostgresPersistencePair(async (control, target) => {
      const fixture = await readinessFixture(control, target);
      const schemaVersionId = await prepareReadinessAuthorities(fixture);
      await enablePhysicalBuilds(fixture, schemaVersionId);
      const clock = await target.getScopeClock(fixture.authority.scopeId);
      if (clock === null) throw new Error("Expected PostgreSQL readiness clock.");
      await target.query(
        `update fx_system_index_build_state
            set start_commit_seq = $1
          where scope_id = $2`,
        [clock.lastCommitSeq + 1n, fixture.authority.scopeId],
      );

      const future = await runEffect(Effect.result(
        fixture.repository.settle(fixture.input),
      ));
      expect(Result.isFailure(future)).toBe(true);
      if (Result.isFailure(future)) {
        expect(future.failure).toMatchObject({ reason: "storedState" });
      }
      expect(await scalarCount(
        target,
        "fx_system_application_readiness_v1",
      )).toBe(0);

      await target.query(
        `update fx_system_index_build_state
            set start_commit_seq = $1
          where scope_id = $2`,
        [clock.lastCommitSeq, fixture.authority.scopeId],
      );
      const blocker = await target.pool.connect();
      let released = false;
      let concurrent: ReadonlyArray<ApplicationReadinessResult> | undefined;
      try {
        await blocker.query("begin");
        const pid = await blocker.query<{ pid: number }>(
          "select pg_backend_pid()::int as pid",
        );
        const blockerPid = pid.rows[0]?.pid;
        if (blockerPid === undefined) throw new Error("Missing blocker PID.");
        await blocker.query(
          `select 1 from fx_system_scope_clock
            where scope_id = $1
            for update`,
          [fixture.authority.scopeId],
        );
        const first = runEffect(fixture.repository.settle(fixture.input));
        const second = runEffect(fixture.repository.settle(fixture.input));
        await waitForBlockedBy(target, blockerPid, 2);
        await blocker.query("commit");
        released = true;
        concurrent = await Promise.all([first, second]);
      } finally {
        if (!released) await blocker.query("rollback").catch(() => undefined);
        blocker.release();
      }
      if (concurrent === undefined) {
        throw new Error("Concurrent Application readiness did not settle.");
      }
      expect(concurrent.map(result => result.status)).toEqual(["ready", "ready"]);
      expect(concurrent.map(result =>
        result.status === "ready" ? result.disposition : "not_ready"
      ).sort()).toEqual(["inserted", "replayed"]);
      const replay = await runEffect(fixture.repository.settle(fixture.input));
      expect(replay).toMatchObject({
        status: "ready",
        disposition: "replayed",
        schemaVersionId,
      });
      expect(await scalarCount(
        target,
        "fx_system_application_readiness_v1",
      )).toBe(1);
      const requirements = await runEffect(
        loadPublishedPhysicalRequirementSnapshotV1(
          control.drizzle,
          Object.freeze({
            deploymentId: fixture.input.deploymentId,
            schemaVersionId,
          }),
        ),
      );
      const definition = requirements?.definitions[0];
      if (definition === undefined) {
        throw new Error("Expected PostgreSQL physical definition.");
      }
      const subject = await runEffect(
        preparePhysicalDefinitionLifecycleSubjectEffect(
          fixture.physicalDefinitionLifecycle,
          Object.freeze({
            definitionKind: "index",
            deploymentId: fixture.input.deploymentId,
            scopeId: fixture.input.scopeId,
            indexDefinitionId: definition.indexDefinitionId,
          }),
        ),
      );
      await runEffect(beginPhysicalDefinitionDrainingEffect(
        subject,
        Object.freeze({ expectedTransitionFence: 0n }),
      ));
      expect(await runEffect(fixture.repository.readReady(fixture.input)))
        .toMatchObject({
          status: "not_ready",
          reason: "physicalDefinitionNotActive",
        });
      await runEffect(cancelPhysicalDefinitionDrainingEffect(
        subject,
        Object.freeze({ expectedTransitionFence: 1n }),
      ));
      expect(await runEffect(fixture.repository.settle(fixture.input)))
        .toMatchObject({ status: "ready", disposition: "replayed" });
    });
  }, 240_000);

  it("serializes concurrent Application activation behind the target scope clock", async () => {
    await withTemporaryPostgresPersistencePair(async (control, target) => {
      const fixture = await readinessFixture(control, target);
      const schemaVersionId = await prepareReadinessAuthorities(fixture);
      await enablePhysicalBuilds(fixture, schemaVersionId);
      const activation = makeApplicationActivationRepository({
        deploymentId: fixture.input.deploymentId,
        scopeId: fixture.input.scopeId,
        readiness: fixture.repository,
        authority: fixture.authorityPorts,
      });
      const blocker = await target.pool.connect();
      let released = false;
      try {
        await blocker.query("begin");
        const pid = await blocker.query<{ pid: number }>(
          "select pg_backend_pid()::int as pid",
        );
        const blockerPid = pid.rows[0]?.pid;
        if (blockerPid === undefined) throw new Error("Missing blocker PID.");
        await blocker.query(
          `select 1 from fx_system_scope_clock
            where scope_id = $1
            for update`,
          [fixture.authority.scopeId],
        );
        const first = runEffect(activation.activate({
          revisionId: fixture.input.revisionId,
          expectedActiveHead: null,
        }));
        const second = runEffect(activation.activate({
          revisionId: fixture.input.revisionId,
          expectedActiveHead: null,
        }));
        await waitForBlockedBy(target, blockerPid, 2);
        await blocker.query("commit");
        released = true;
        const settled = await Promise.all([first, second]);
        expect(settled.map(result => result.disposition).sort()).toEqual([
          "inserted",
          "replayed",
        ]);
        const active = await runEffect(activation.readActive());
        expect(active.basis).toMatchObject({
          revisionId: fixture.input.revisionId,
          activationSequence: 1n,
          runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
          compatibilityDate: COMPATIBILITY_DATE,
        });
        expect(await scalarCount(
          target,
          "fx_system_application_activation",
        )).toBe(1);
        expect(await scalarCount(
          target,
          "fx_system_application_active_head",
        )).toBe(1);

        await blocker.query("begin");
        await blocker.query(
          `select 1 from fx_system_scope_clock
            where scope_id = $1
            for share`,
          [fixture.authority.scopeId],
        );
        const shareCompatibleRead = runEffect(activation.readActive());
        const readOutcome = await Promise.race([
          shareCompatibleRead.then(value => ({ kind: "read" as const, value })),
          new Promise<{ readonly kind: "timeout" }>(resolve => {
            setTimeout(() => resolve({ kind: "timeout" }), 10_000);
          }),
        ]);
        await blocker.query("rollback");
        if (readOutcome.kind === "timeout") {
          await shareCompatibleRead;
          throw new Error(
            "Active Application read tried to upgrade the shared scope-clock lane.",
          );
        }
        expect(readOutcome.value.basis.revisionId).toBe(
          fixture.input.revisionId,
        );
      } finally {
        if (!released) await blocker.query("rollback").catch(() => undefined);
        blocker.release();
      }
    });
  }, 240_000);

  it("keeps an active Application readable after a second scope joins its deployment", async () => {
    await withTemporaryPostgresPersistencePair(async (control, target) => {
      const fixture = await readinessFixture(control, target);
      const schemaVersionId = await prepareReadinessAuthorities(fixture);
      await enablePhysicalBuilds(fixture, schemaVersionId);
      const activation = makeApplicationActivationRepository({
        deploymentId: fixture.input.deploymentId,
        scopeId: fixture.input.scopeId,
        readiness: fixture.repository,
        authority: fixture.authorityPorts,
      });
      const first = await runEffect(activation.activate({
        revisionId: fixture.input.revisionId,
        expectedActiveHead: null,
      }));
      await control.insertScopeMetadata({
        deploymentId: fixture.input.deploymentId,
        scopeId: ScopeIdSchema.make("scope_application_readiness_peer_postgres"),
        physicalLocator: LOCATOR,
      });

      expect(await runEffect(fixture.repository.readReady(fixture.input)))
        .toMatchObject({ status: "ready", scopeId: fixture.input.scopeId });
      expect(await runEffect(activation.readActive()))
        .toMatchObject({ expectedActiveHead: first.expectedActiveHead, basis: { authority: { scopeId: fixture.input.scopeId } } });
    });
  }, 240_000);

  it("keeps an active Application with an enabled unique definition readable after a peer shop joins", async () => {
    await withTemporaryPostgresPersistencePair(async (control, target) => {
      const fixture = await readinessFixture(control, target);
      const schemaVersionId = await prepareReadinessAuthorities(fixture, async selectedSchemaVersionId => {
        const prepared = await runEffect(prepareAppUniqueConstraintDefinitionBindingV1Effect(
          control.drizzle,
          {
            deploymentId: fixture.input.deploymentId,
            schemaVersionId: selectedSchemaVersionId,
            tableId: decodeCatalogTableId(1),
            descriptor: SchemaManifestAppIndexDescriptorSchema.make("by_name_unique"),
            physicalSpec: decodeAppUniqueConstraintPhysicalSpecV1({
              kind: "appUniqueConstraint",
              specVersion: 1,
              orderedFields: ["name"],
              sparse: false,
              localePolicy: { kind: "none" },
              keyCodecIdentity: APP_UNIQUE_KEY_CODEC_IDENTITY_V1,
              keyCodecVersion: APP_UNIQUE_KEY_CODEC_VERSION_V1,
            }),
          },
        ));
        await control.drizzle.transaction(tx => runEffect(
          ensureAppUniqueConstraintDefinitionBindingV1InTransaction(tx, prepared),
        ));
      });
      await enablePhysicalBuilds(fixture, schemaVersionId);
      const uniquePorts = { controlDb: control.drizzle, authority: fixture.authorityPorts };
      const uniqueInput = { deploymentId: fixture.input.deploymentId, scopeId: fixture.input.scopeId, schemaVersionId };
      await runEffect(reconcileAppUniqueConstraintSetBuildV1Effect(uniquePorts, uniqueInput));
      let enabled = false;
      for (let step = 0; step < 8; step += 1) {
        const progress = await runEffect(advanceAppUniqueConstraintSetBackfillV1Effect(uniquePorts, { ...uniqueInput, pageSize: 16 }));
        if (progress.lifecycle === "enabled") { enabled = true; break; }
      }
      expect(enabled).toBe(true);
      const activation = makeApplicationActivationRepository({
        deploymentId: fixture.input.deploymentId,
        scopeId: fixture.input.scopeId,
        readiness: fixture.repository,
        authority: fixture.authorityPorts,
      });
      const first = await runEffect(activation.activate({ revisionId: fixture.input.revisionId, expectedActiveHead: null }));
      await control.insertScopeMetadata({
        deploymentId: fixture.input.deploymentId,
        scopeId: ScopeIdSchema.make("scope_application_unique_peer_postgres"),
        physicalLocator: LOCATOR,
      });

      expect(await runEffect(activation.readActive()))
        .toMatchObject({ expectedActiveHead: first.expectedActiveHead, basis: { authority: { scopeId: fixture.input.scopeId } } });
    });
  }, 240_000);

  it("reads indexed Application readiness while an ordinary publication is held", async () => {
    await withTemporaryPostgresPersistencePair(async (control, target) => {
      const fixture = await readinessFixture(control, target);
      const schemaVersionId = await prepareReadinessAuthorities(fixture);
      await enablePhysicalBuilds(fixture, schemaVersionId);
      expect(await runEffect(fixture.repository.settle(fixture.input)))
        .toMatchObject({ status: "ready" });
      const clock = await target.getScopeClock(fixture.authority.scopeId);
      if (clock === null) throw new Error("Expected PostgreSQL readiness clock.");
      const blocker = await target.pool.connect();
      let released = false;
      try {
        await blocker.query("begin");
        await blocker.query(
          `update fx_system_scope_clock
              set last_commit_seq = last_commit_seq + 1
            where scope_id = $1`,
          [fixture.authority.scopeId],
        );
        await blocker.query(
          `update fx_system_index_build_state
              set covered_through_commit_seq = $1
            where scope_id = $2 and lifecycle = 'enabled'`,
          [clock.lastCommitSeq + 1n, fixture.authority.scopeId],
        );
        const selection = runEffect(fixture.repository.readReady(fixture.input));
        const outcome = await Promise.race([
          selection.then(value => ({ kind: "read" as const, value })),
          new Promise<{ readonly kind: "timeout" }>(resolve => {
            setTimeout(() => resolve({ kind: "timeout" }), 5_000);
          }),
        ]);
        if (outcome.kind === "timeout") {
          await blocker.query("rollback");
          released = true;
          await selection;
          throw new Error("Application readiness waited for an ordinary publication.");
        }
        expect(outcome.value).toMatchObject({ status: "ready" });
        await blocker.query("commit");
        released = true;
        expect(await runEffect(fixture.repository.readReady(fixture.input)))
          .toMatchObject({ status: "ready" });
        const requirements = await runEffect(
          loadPublishedPhysicalRequirementSnapshotV1(control.drizzle, {
            deploymentId: fixture.input.deploymentId,
            schemaVersionId,
          }),
        );
        if (requirements === null) throw new Error("Expected physical requirements.");
        const located = await runEffect(resolveLocatedTrustedScopeAuthorityEffect(
          fixture.input.deploymentId,
          fixture.authorityPorts,
        ));
        if (located.authority.storageGeneration !== "flarexdb_v1") {
          throw new Error("Expected FlarexDB Application authority.");
        }
        const storageGeneration = located.authority.storageGeneration;
        const lifecycle = await runEffect(
          preparePhysicalDefinitionLifecycleReadinessEffect(
            fixture.physicalDefinitionLifecycle,
            fixture.authority.scopeId,
            requirements,
          ),
        );
        // Model a READ COMMITTED selection that locked clock N immediately
        // before the writer published N+1. The build read must pair its row
        // with the clock from that same statement, not reject valid coverage.
        const advanced = await target.drizzle.transaction(tx => runEffect(
          validateApplicationPhysicalReadinessInTransactionEffect(
            tx,
            { ...located.authority, storageGeneration },
            requirements,
            fixture.physicalDefinitionLifecycle,
            lifecycle,
            clock,
          ),
        ));
        expect(advanced).toMatchObject({ status: "ready" });
      } finally {
        if (!released) await blocker.query("rollback").catch(() => undefined);
        blocker.release();
      }
    });
  }, 240_000);
});

async function readinessFixture(
  control: PostgresFlarexPersistence,
  target: PostgresFlarexPersistence,
) {
  const deploymentId = "deployment_application_readiness_postgres";
  const provisioned = await createPostgresSplitScopeAuthorityProvisioner(
    control,
    {
      placementPlanner: { plan: () => LOCATOR },
      targetResolver: {
        resolve: async locator =>
          createPostgresLocatedSplitScopeClockTarget(target, locator),
      },
      randomUuid: uuidSequence(1, 2),
    },
  ).ensure({
    deploymentId,
    projectId: "project_application_readiness_postgres",
  });
  await target.query(
    `update fx_system_scope_clock
        set storage_generation = 'flarexdb_v1'
      where scope_id = $1`,
    [provisioned.scope.scopeId],
  );
  const clock = await target.getScopeClock(provisioned.scope.scopeId);
  if (clock === null || clock.storageGeneration !== "flarexdb_v1") {
    throw new Error("Expected PostgreSQL Application authority.");
  }
  const authority: ApplicationAnalysisAuthority = Object.freeze({
    scopeId: clock.scopeId,
    storageGeneration: clock.storageGeneration,
    storageGenerationFence: clock.storageGenerationFence,
    epoch: clock.epoch,
  });
  const analysis = await createApplicationRevision(
    target,
    authority,
    applicationManifest(),
  );
  const publication = await runEffect(
    makeApplicationPublicationRepository(target.drizzle).publish({
      authority,
      revisionId: analysis.revision.revisionId,
      candidateId: analysis.candidateId,
      analysisId: analysis.analysisId,
      manifestSha256: analysis.manifestSha256,
      manifest: Result.getOrThrow(
        canonicalizeApplicationManifestV1(analysis.manifest),
      ).manifest,
    }),
  );
  const catalog = await runEffect(hashCanonicalTaskCatalogV1({
    version: 1,
    tasks: [],
  }, taskSha256));
  const bindings = await runEffect(produceApplicationTaskBindingsV1({
    definition: preparedDefinition(),
    catalog,
    authority: {
      scopeId: publication.scopeId,
      revisionId: publication.revisionId,
      candidateId: publication.candidateId,
      analysisId: publication.analysisId,
      sourceArtifactRootSha256: publication.sourceArtifactRootSha256,
      publicationSha256: publication.publicationSha256,
    },
    runtimePolicy: {
      runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
      compatibilityDate: COMPATIBILITY_DATE,
    },
  }, taskSha256));
  await runEffect(makeApplicationTaskBindingRepository(target.drizzle).register({
    authority,
    bindings,
  }));
  const locatedTarget = createLocatedAppSchemaCandidateValidationTarget(
    target.drizzle,
    LOCATOR,
  );
  const authorityPorts = Object.freeze({
    scopeMetadata: control,
    provisioningReceipts: {
      getScopeAuthorityProvisioningReceipt: (scopeId: typeof authority.scopeId) =>
        getScopeAuthorityProvisioningReceipt(control.drizzle, scopeId),
    },
    scopeClockTargets: { resolve: async () => locatedTarget },
  });
  const candidateValidation = createAppSchemaCandidateValidationPort({
    controlDb: control.drizzle,
    authority: authorityPorts,
  });
  const uniqueConstraints = createAppUniqueConstraintDefinitionPortV1(
    control.drizzle,
  );
  const uniqueConstraintEligibility =
    createAppUniqueConstraintSetEligibilityPortV1({
      controlDb: control.drizzle,
      authority: authorityPorts,
    }, uniqueConstraints);
  const pointCommit = createPointCommitPublisherPortV1({
    scopeMetadata: control,
    provisioningReceipts: authorityPorts.provisioningReceipts,
    scopeSessionTargets: {
      resolve: async () => {
        throw new Error("Readiness must not open a commit session.");
      },
    },
  }, { uniqueConstraints, uniqueConstraintEligibility });
  const physicalDefinitionLifecycle = createPhysicalDefinitionLifecyclePort({
    controlDb: control.drizzle,
    authority: authorityPorts,
  });
  const repository = makeApplicationReadinessRepository({
    controlDb: control.drizzle,
    authority: authorityPorts,
    schema: makeApplicationSchemaAuthorityPublisher({
      db: control.drizzle,
      runTransaction: run => control.drizzle.transaction(run),
    }),
    taskCatalog: createApplicationTaskCatalogSnapshotPort(),
    candidateValidation: createAppSchemaCandidateReadinessPort(
      candidateValidation,
    ),
    pointCommit,
    physicalDefinitionLifecycle,
    cold: {
      runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
      compatibilityDate: COMPATIBILITY_DATE,
      materialize: () => Effect.die(
        new Error("Zero-function PostgreSQL readiness must not materialize."),
      ),
    },
  });
  return Object.freeze({
    control,
    target,
    authority,
    authorityPorts,
    candidateValidation,
    physicalDefinitionLifecycle,
    repository,
    input: Object.freeze({
      deploymentId,
      scopeId: authority.scopeId,
      revisionId: publication.revisionId,
    }),
  });
}

async function prepareReadinessAuthorities(
  fixture: Awaited<ReturnType<typeof readinessFixture>>,
  beforeClosure?: (schemaVersionId: CatalogSchemaVersionId) => Promise<void>,
): Promise<CatalogSchemaVersionId> {
  const beforeValidation = await runEffect(
    fixture.repository.settle(fixture.input),
  );
  expect(beforeValidation).toMatchObject({
    status: "not_ready",
    reason: "candidateValidationMissing",
  });
  const result = await fixture.control.query<{
    schema_version_id: CatalogSchemaVersionId;
  }>("select schema_version_id from fx_control_application_schema_authority_v1");
  const schemaVersionId = result.rows[0]?.schema_version_id;
  if (schemaVersionId === undefined) {
    throw new Error("Expected PostgreSQL Application schema authority.");
  }
  if (beforeClosure !== undefined) await beforeClosure(schemaVersionId);
  const closure = await runEffect(prepareAppUniqueConstraintSetClosureV1Effect(
    fixture.control.drizzle,
    { deploymentId: fixture.input.deploymentId, schemaVersionId },
  ));
  await fixture.control.drizzle.transaction(tx => runEffect(
    closeAppUniqueConstraintSetV1InTransactionEffect(tx, closure),
  ));
  const input = {
    deploymentId: fixture.input.deploymentId,
    scopeId: fixture.input.scopeId,
    schemaVersionId,
  } as const;
  await runEffect(installAppSchemaCandidateValidationEffect(
    fixture.candidateValidation,
    input,
  ));
  for (let step = 0; step < 64; step += 1) {
    const advanced = await runEffect(advanceAppSchemaCandidateValidationEffect(
      fixture.candidateValidation,
      input,
    ));
    if (advanced.disposition !== "readyToSettle") continue;
    await runEffect(settleAppSchemaCandidateValidationEffect(
      fixture.candidateValidation,
      input,
    ));
    return schemaVersionId;
  }
  throw new Error("PostgreSQL candidate validation did not settle.");
}

async function enablePhysicalBuilds(
  fixture: Awaited<ReturnType<typeof readinessFixture>>,
  schemaVersionId: CatalogSchemaVersionId,
): Promise<void> {
  const ports = Object.freeze({
    controlDb: fixture.control.drizzle,
    authority: fixture.authorityPorts,
  });
  await runEffect(reconcilePublishedIndexBuildsV1Effect(ports, {
    deploymentId: fixture.input.deploymentId,
    scopeId: fixture.input.scopeId,
    schemaVersionId,
  }));
  const requirements = await runEffect(
    loadPublishedPhysicalRequirementSnapshotV1(
      fixture.control.drizzle,
      { deploymentId: fixture.input.deploymentId, schemaVersionId },
    ),
  );
  if (requirements === null || requirements.definitions.length === 0) {
    throw new Error("Expected PostgreSQL physical requirements.");
  }
  for (const definition of requirements.definitions) {
    for (let step = 0; step < 16; step += 1) {
      const built = await runEffect(buildIntrinsicCreationTimeIndexV1Effect(
        ports,
        {
          deploymentId: fixture.input.deploymentId,
          scopeId: fixture.input.scopeId,
          indexDefinitionId: definition.indexDefinitionId,
          pageSize: 16,
        },
      ));
      if (built.lifecycle === "enabled") break;
      if (step === 15) throw new Error("PostgreSQL build did not enable.");
    }
  }
}

async function createApplicationRevision(
  target: PostgresFlarexPersistence,
  authority: ApplicationAnalysisAuthority,
  manifest: Readonly<{
    readonly manifest: ApplicationManifestV1;
    readonly canonicalText: string;
  }>,
) {
  const analyses = makeApplicationAnalysisRepository(target.drizzle, {
    randomUuid: uuidSequence(11, 12, 13),
  });
  const pending = await runEffect(analyses.begin({
    authority,
    requestKey: "request:application-readiness:postgres:1",
    sourceArtifactRootSha256: ROOT,
    analyzerIdentity: "application-analyzer",
    analyzerPolicyIdentity: "application-analyzer-policy",
  }));
  const analyzed = await runEffect(analyses.settle(authority, {
    kind: "analyzed",
    candidateId: pending.candidateId,
    sourceArtifactRootSha256: ROOT,
    analyzerIdentity: "application-analyzer",
    analyzerPolicyIdentity: "application-analyzer-policy",
    canonicalManifest: manifest.canonicalText,
  }));
  if (analyzed.status !== "analyzed") {
    throw new Error("Expected analyzed PostgreSQL readiness fixture.");
  }
  return analyzed;
}

function applicationManifest() {
  return Result.getOrThrow(canonicalizeApplicationManifestV1({
    format: "flarex.application-manifest",
    version: 1,
    sourceArtifact: {
      rootSha256: ROOT,
      executionModulePath: "_flarex/application.js",
      schemaModulePath: "_flarex/schema.js",
      modules: [{
        path: "_flarex/application.js",
        roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
        sourceSha256: EXECUTION_SOURCE,
        sourceByteLength: 128,
      }, {
        path: "_flarex/schema.js",
        roles: SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
        sourceSha256: SCHEMA_SOURCE,
        sourceByteLength: 64,
      }],
    },
    schema: {
      version: 1,
      tables: [{
        tableId: 1,
        name: "users",
        validator: {
          type: "object",
          value: {
            name: {
              fieldType: { type: "string" },
              optional: false,
            },
          },
        },
        placement: { kind: "global" },
      }],
      indexes: [],
    },
    functions: [],
  }));
}

function preparedDefinition() {
  return Result.getOrThrow(prepareStandardApplicationDefinitionV1({
    programBudgetInput: {
      maximumModules: 1,
      maximumFunctions: 1,
      maximumIdentifierUtf8Bytes: 1_024,
      maximumValidatorNodes: 32,
      maximumValidatorDepth: 8,
      maximumValidatorStringUtf8Bytes: 1_024,
    },
    programInput: {
      format: "flarex.declarative-program/v1",
      version: 1,
      schema: { tables: [], indexes: [] },
      modules: [{
        modulePath: "users",
        functions: [{
          exportName: "get",
          kind: "query",
          visibility: "public",
          argsValidator: { type: "any" },
          returnsValidator: null,
        }],
      }],
    },
    materializationBudgetInput: {
      maximumModules: 1,
      maximumEntryBindings: 1,
      maximumSourceBytes: 4_096,
      maximumSourceMapBytes: 0,
      maximumBytesMaterialized: 16_384,
      maximumSemanticRecords: 16,
      maximumSemanticRecordBytes: 4_096,
      maximumSemanticStreamBytes: 16_384,
    },
    graphInput: {
      modules: [{
        path: "users.js",
        roles: ["function", "execution"],
        sourceBytes: new TextEncoder().encode(
          "export const get = () => null;\n",
        ),
        sourceMapBytes: null,
      }],
      functionEntries: [{
        logicalModulePath: "users",
        artifactModulePath: "users.js",
      }],
      executionPath: "users.js",
      schemaPath: null,
      authPath: null,
    },
  }));
}

function uuidSequence(...sequences: ReadonlyArray<number>): () => string {
  let index = 0;
  return () => {
    const sequence = sequences[index];
    if (sequence === undefined) throw new Error("UUID sequence exhausted.");
    index += 1;
    return `30000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
  };
}

async function scalarCount(
  persistence: PostgresFlarexPersistence,
  tableName: string,
): Promise<number> {
  const result = await persistence.query<{ count: string }>(
    `select count(*)::text as count from ${tableName}`,
  );
  const count = result.rows[0]?.count;
  if (count === undefined) throw new Error(`Missing count for ${tableName}.`);
  return Number(count);
}

async function waitForBlockedBy(
  persistence: PostgresFlarexPersistence,
  blockerPid: number,
  expected: number,
): Promise<void> {
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
  throw new Error(`Expected ${expected} readiness transactions to block.`);
}
