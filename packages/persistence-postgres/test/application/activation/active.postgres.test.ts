import { webcrypto } from "node:crypto";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { SchemaManifestAppIndexDescriptorSchema } from "flarex-protocol/schema-manifest";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import {
  APP_UNIQUE_KEY_CODEC_IDENTITY_V1,
  APP_UNIQUE_KEY_CODEC_VERSION_V1,
  decodeAppUniqueConstraintPhysicalSpecV1,
} from "flarex-protocol/app-unique-constraint-definition";
import { beforeAll, describe, expect, it } from "vitest";
import {
  advanceAppUniqueConstraintSetBackfillV1Effect,
  reconcileAppUniqueConstraintSetBuildV1Effect,
} from "../../../src/storage/unique/appUniqueConstraintSetBuildV1";
import {
  ensureAppUniqueConstraintDefinitionBindingV1InTransaction,
  prepareAppUniqueConstraintDefinitionBindingV1Effect,
} from "../../../src/storage/unique/appUniqueConstraintDefinitions";
import {
  makeApplicationActivationRepository,
} from "../../../src/application/activation/repository";
import { runEffect } from "../../support/effectTestRuntime";
import { postgresUrl, withTemporaryPostgresPersistencePair } from "../../support/postgresHelpers";
import {
  RUNTIME_HOST_IDENTITY,
  COMPATIBILITY_DATE,
  readinessFixture,
  prepareReadinessAuthorities,
  enablePhysicalBuilds,
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

describePostgres("Application activation/active.postgres", { timeout: 30_000 }, () => {
  it("serializes concurrent Application activation behind the target scope clock", async () => {
    await withTemporaryPostgresPersistencePair(async (control, target) => {
      const fixture = await readinessFixture(control, target);
      const schemaVersionId = await prepareReadinessAuthorities(fixture);
      await enablePhysicalBuilds(fixture, schemaVersionId);
      const activation = makeApplicationActivationRepository({ activation: { kind: "fullProof" },
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
  }, 240_000)

  it("keeps an active Application readable after a second scope joins its deployment", async () => {
    await withTemporaryPostgresPersistencePair(async (control, target) => {
      const fixture = await readinessFixture(control, target);
      const schemaVersionId = await prepareReadinessAuthorities(fixture);
      await enablePhysicalBuilds(fixture, schemaVersionId);
      const activation = makeApplicationActivationRepository({ activation: { kind: "fullProof" },
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
        physicalLocator: fixture.physicalLocator,
      });

      expect(await runEffect(fixture.repository.readReady(fixture.input)))
        .toMatchObject({ status: "ready", scopeId: fixture.input.scopeId });
      expect(await runEffect(activation.readActive()))
        .toMatchObject({ expectedActiveHead: first.expectedActiveHead, basis: { authority: { scopeId: fixture.input.scopeId } } });
    });
  }, 240_000)

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
      const activation = makeApplicationActivationRepository({ activation: { kind: "fullProof" },
        deploymentId: fixture.input.deploymentId,
        scopeId: fixture.input.scopeId,
        readiness: fixture.repository,
        authority: fixture.authorityPorts,
      });
      const first = await runEffect(activation.activate({ revisionId: fixture.input.revisionId, expectedActiveHead: null }));
      await control.insertScopeMetadata({
        deploymentId: fixture.input.deploymentId,
        scopeId: ScopeIdSchema.make("scope_application_unique_peer_postgres"),
        physicalLocator: fixture.physicalLocator,
      });

      expect(await runEffect(activation.readActive()))
        .toMatchObject({ expectedActiveHead: first.expectedActiveHead, basis: { authority: { scopeId: fixture.input.scopeId } } });
    });
  }, 240_000)
});
