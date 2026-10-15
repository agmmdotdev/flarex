import { webcrypto } from "node:crypto";
import type { PoolClient } from "pg";
import { Effect, Result } from "effect";
import { CatalogSchemaVersionIdSchema, CatalogSchemaVersionSchema } from "flarex-protocol/schema-manifest";
import { beforeAll, describe, expect, it } from "vitest";
import {
  validateApplicationPhysicalReadinessInTransactionEffect,
} from "../../../src/application/readiness/physicalCoverage";
import {
  type ApplicationReadinessResult,
} from "../../../src/application/readiness/contracts";
import {
  makeApplicationSchemaAuthorityPublisher,
} from "../../../src/application/applicationSchemaAuthority";
import {
  loadPublishedPhysicalRequirementSnapshotV1,
} from "../../../src/storage/indexes/indexBuildReconciliation";
import {
  beginPhysicalDefinitionDrainingEffect,
  cancelPhysicalDefinitionDrainingEffect,
  preparePhysicalDefinitionLifecycleReadinessEffect,
  preparePhysicalDefinitionLifecycleSubjectEffect,
} from "../../../src/installation/physicalDefinitionLifecycle";
import { resolveLocatedTrustedScopeAuthorityEffect } from "../../../src/scope/scopeAuthorityResolution";
import { runEffect } from "../../support/effectTestRuntime";
import { postgresUrl, useFileScopedPostgresPersistence } from "../../support/postgresHelpers";
import { withPostgresExecutionObservation } from "../../performance/postgresExecutionObservation";
import {
  readinessFixture,
  prepareReadinessAuthorities,
  enablePhysicalBuilds,
  applicationManifest,
  scalarCount,
  waitForBlockedBy,
} from "../support/readinessPostgresFixture";

beforeAll(() => {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
  }
});

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("Application readiness/settlement.postgres", { timeout: 30_000 }, () => {
  const withControl = useFileScopedPostgresPersistence();
  const withTarget = useFileScopedPostgresPersistence();

  it("loads the locked revision's candidate, analysis and legacy publication in one statement", async () => {
    await withControl(control => withTarget(async target => {
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
    }));
  }, 120_000)

  it("keeps candidate refusal order after a joined fetch and classifies a joined SQL failure", async () => {
    await withControl(control => withTarget(async target => {
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
    }));
  }, 120_000)

  it("retries when the retained publisher claims the tentative version", async () => {
    await withControl(async (control) => {
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
      try {
        await Promise.race([
          firstTransactionEntered,
          application.then(() => { throw new Error("Expected publisher gate before settlement."); }),
        ]);
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
      } finally {
        releaseFirstTransaction?.();
        await Promise.allSettled([application]);
      }
    });
  }, 240_000)

  it("settles one table-bearing split-store revision under real locks", async () => {
    await withControl(control => withTarget(async target => {
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
      const pending: Promise<ApplicationReadinessResult>[] = [];
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
        pending.push(first);
        const second = runEffect(fixture.repository.settle(fixture.input));
        pending.push(second);
        await waitForBlockedBy(target, blockerPid, 2);
        await blocker.query("commit");
        released = true;
        concurrent = await Promise.all([first, second]);
      } finally {
        blocker.release(!released);
        await Promise.allSettled(pending);
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
    }));
  }, 240_000)

  it("reads indexed Application readiness while an ordinary publication is held", async () => {
    await withControl(control => withTarget(async target => {
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
    }));
  }, 240_000)
});
