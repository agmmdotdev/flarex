import {
  APP_UNIQUE_KEY_CODEC_IDENTITY_V1,
  APP_UNIQUE_KEY_CODEC_VERSION_V1,
  decodeAppUniqueConstraintPhysicalSpecV1,
} from "flarex-protocol/app-unique-constraint-definition";
import { canonicalizeAppDocumentV1, decodeAppCreationTimeV1 } from
  "flarex-protocol/app-document";
import { decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  SchemaManifestAppIndexDescriptorSchema,
} from "flarex-protocol/schema-manifest";
import { CommitSeqSchema, ScopeEpochSchema, ScopeIdSchema } from
  "flarex-protocol/storage-authority";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  ensureAppUniqueConstraintDefinitionBindingV1InTransaction,
  prepareAppUniqueConstraintDefinitionBindingV1Effect,
} from "../src/appUniqueConstraintDefinitions";
import {
  AppUniqueConstraintSetBuildIntegrationV1Error,
  advanceAppUniqueConstraintSetBackfillV1Effect,
  reconcileAppUniqueConstraintSetBuildV1Effect,
} from "../src/appUniqueConstraintSetBuildV1";
import {
  closeAppUniqueConstraintSetV1InTransactionEffect,
  prepareAppUniqueConstraintSetClosureV1Effect,
} from "../src/appUniqueConstraintSetClosureV1";
import { appendPreparedAppRowRevisionAndAdvanceCurrentInTransactionResult } from
  "../src/appRows";
import {
  createPostgresLocatedAppUniqueConstraintSetBuildTargetV1,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import type { ScopePhysicalLocator } from "../src/scopeMetadataTypes";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const LOCATOR = Object.freeze({
  kind: "shared_database",
  databaseKey: "primary",
  schemaName: "public",
} as const satisfies ScopePhysicalLocator);

describePostgres("real PostgreSQL C08-B1 unique-set build foundation", () => {
  it("serializes closure/build replay and proves rollback plus stale redeclaration", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const fixture = await fixtureFor(persistence);
      const version = await persistence.query<{ server_version: string }>(
        "show server_version",
      );
      expect(version.rows[0]?.server_version).toMatch(/^18\./);

      const prepared = await runEffect(prepareAppUniqueConstraintSetClosureV1Effect(
        persistence.drizzle,
        fixture.input,
      ));
      const closures = await Promise.all(Array.from({ length: 8 }, () =>
        persistence.drizzle.transaction((tx) => runEffect(
          closeAppUniqueConstraintSetV1InTransactionEffect(tx, prepared),
        ))
      ));
      expect(closures.filter((value) => value.status === "closed")).toHaveLength(1);
      expect(closures.filter((value) => value.status === "replayed")).toHaveLength(7);

      const builds = await Promise.all(Array.from(
        { length: 12 },
        () => reconcile(fixture),
      ));
      expect(builds.filter((value) =>
        value.status === "reconciled" && value.disposition === "created"
      )).toHaveLength(1);
      expect(builds.filter((value) =>
        value.status === "reconciled" && value.disposition === "replayed"
      )).toHaveLength(11);

      await persistence.query(
        "delete from fx_system_unique_constraint_set_build where scope_id = $1",
        [fixture.scopeId],
      );
      const failure = await runEffectFailure(
        reconcileAppUniqueConstraintSetBuildV1Effect(
          fixture.ports,
          fixture.input,
          { faultAfter: () => { throw new Error("postgres unique build rollback"); } },
        ),
      );
      expect(failure).toBeInstanceOf(
        AppUniqueConstraintSetBuildIntegrationV1Error,
      );
      expect(await buildCount(persistence, fixture.scopeId)).toBe(0);

      await expect(reconcile(fixture)).resolves.toMatchObject({
        disposition: "created",
        startCommitSeq: 0n,
        attemptFence: 1n,
      });
      await persistence.query(
        `update fx_system_scope_clock
            set storage_generation_fence = 2, epoch = $2, last_commit_seq = 19
          where scope_id = $1`,
        [fixture.scopeId, ScopeEpochSchema.make("epoch_unique_set_pg_2")],
      );
      await expect(reconcile(fixture)).resolves.toMatchObject({
        disposition: "redeclared",
        startCommitSeq: 19n,
        attemptFence: 2n,
      });
    });
  }, 120_000);

  it("serializes concurrent bounded backfill pages and publishes exact current claims", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const fixture = await fixtureFor(persistence);
      const prepared = await runEffect(prepareAppUniqueConstraintSetClosureV1Effect(
        persistence.drizzle,
        fixture.input,
      ));
      await persistence.drizzle.transaction((tx) => runEffect(
        closeAppUniqueConstraintSetV1InTransactionEffect(tx, prepared),
      ));
      await appendLiveRow(fixture, "73000000000040008000000000000001", "a@example.com");
      await appendLiveRow(fixture, "73000000000040008000000000000002", "b@example.com");
      await persistence.query(
        "update fx_system_scope_clock set last_commit_seq = 1 where scope_id = $1",
        [fixture.scopeId],
      );
      await reconcile(fixture);
      await advanceBackfill(fixture, 1);
      await advanceBackfill(fixture, 1);
      const settlements = await Promise.all(Array.from(
        { length: 4 },
        () => advanceBackfill(fixture, 1),
      ));
      expect(settlements.some((value) => value.claimed === 1)).toBe(true);
      expect(settlements.filter((value) =>
        value.lifecycle === "validating"
      )).toHaveLength(2);
      expect(settlements.filter((value) =>
        value.lifecycle === "enabled"
      )).toHaveLength(1);
      const build = await persistence.query<{ lifecycle: string }>(
        `select lifecycle from fx_system_unique_constraint_set_build
          where scope_id = $1 and schema_version_id = $2`,
        [fixture.scopeId, fixture.schemaVersionId],
      );
      expect(build.rows).toEqual([{ lifecycle: "enabled" }]);
      const claims = await persistence.query<{
        row_id_hex: string;
        commit_seq: string;
      }>(
        `select encode(row_id, 'hex') row_id_hex, commit_seq::text
           from fx_app_unique_key order by row_id asc`,
      );
      expect(claims.rows).toEqual([
        { row_id_hex: "73000000000040008000000000000001", commit_seq: "1" },
        { row_id_hex: "73000000000040008000000000000002", commit_seq: "1" },
      ]);
    });
  }, 120_000);
});

async function fixtureFor(persistence: PostgresFlarexPersistence) {
  const deploymentId = "deployment_unique_set_pg";
  const scopeId = ScopeIdSchema.make(
    "scope_74000000-0000-4000-8000-000000000001",
  );
  const schemaVersionId = CatalogSchemaVersionIdSchema.make(
    "schema_unique_set_pg",
  );
  await persistence.insertDeploymentMetadata({
    deploymentId,
    projectId: "project_unique_set_pg",
  });
  await persistence.insertScopeMetadata({
    scopeId,
    deploymentId,
    physicalLocator: LOCATOR,
  });
  await persistence.query(
    `insert into fx_system_scope_clock
      (scope_id, storage_generation, storage_generation_fence,
       last_commit_seq, last_outbox_seq, epoch)
     values ($1, 'flarexdb_v1', 1, 0, 0, $2)`,
    [scopeId, ScopeEpochSchema.make(
      "epoch_75000000-0000-4000-8000-000000000001",
    )],
  );
  const published = await persistence.publishAppSchemaV1({
    deploymentId,
    schemaVersionId,
    version: CatalogSchemaVersionSchema.make(1),
    tables: [{
      logicalName: "users",
      definition: {
        kind: "appDocument",
        definitionVersion: 1,
        documentType: {
          type: "object",
          value: {
            email: { fieldType: { type: "string" }, optional: false },
          },
        },
      },
    }],
    indexes: [],
  });
  const table = published.manifest.tableDefinitions.tables[0];
  if (table === undefined) throw new Error("Missing unique-set PG test table.");
  const prepared = await runEffect(
    prepareAppUniqueConstraintDefinitionBindingV1Effect(
      persistence.drizzle,
      {
        deploymentId,
        schemaVersionId,
        tableId: table.tableId,
        descriptor: SchemaManifestAppIndexDescriptorSchema.make("by_email"),
        physicalSpec: decodeAppUniqueConstraintPhysicalSpecV1({
          kind: "appUniqueConstraint",
          specVersion: 1,
          orderedFields: ["email"],
          sparse: false,
          localePolicy: { kind: "none" },
          keyCodecIdentity: APP_UNIQUE_KEY_CODEC_IDENTITY_V1,
          keyCodecVersion: APP_UNIQUE_KEY_CODEC_VERSION_V1,
        }),
      },
    ),
  );
  await persistence.drizzle.transaction((tx) => runEffect(
    ensureAppUniqueConstraintDefinitionBindingV1InTransaction(tx, prepared),
  ));
  const target = createPostgresLocatedAppUniqueConstraintSetBuildTargetV1(
    persistence,
    LOCATOR,
  );
  const input = Object.freeze({ deploymentId, schemaVersionId });
  const ports = {
    controlDb: persistence.drizzle,
    authority: {
      scopeMetadata: {
        getScopeMetadataByDeploymentId: (value: string) =>
          persistence.getScopeMetadataByDeploymentId(value),
      },
      provisioningReceipts: {
        getScopeAuthorityProvisioningReceipt: async () => null,
      },
      scopeClockTargets: { resolve: async () => target },
    },
  } as const;
  return Object.freeze({
    persistence,
    scopeId,
    epoch: ScopeEpochSchema.make(
      "epoch_75000000-0000-4000-8000-000000000001",
    ),
    schemaVersionId,
    tableId: table.tableId,
    input,
    ports,
  });
}

function reconcile(fixture: Awaited<ReturnType<typeof fixtureFor>>) {
  return runEffect(reconcileAppUniqueConstraintSetBuildV1Effect(
    fixture.ports,
    fixture.input,
  ));
}

function advanceBackfill(
  fixture: Awaited<ReturnType<typeof fixtureFor>>,
  pageSize: number,
) {
  return runEffect(advanceAppUniqueConstraintSetBackfillV1Effect(
    fixture.ports,
    { ...fixture.input, pageSize },
  ));
}

async function appendLiveRow(
  fixture: Awaited<ReturnType<typeof fixtureFor>>,
  rowIdText: string,
  email: string,
) {
  const rowId = decodeAppRowIdHexV1(rowIdText);
  const creationTime = decodeAppCreationTimeV1(1_750_000_000_000);
  const document = await canonicalizeAppDocumentV1({
    tableId: fixture.tableId,
    rowId,
    creationTime,
    fields: { email },
  });
  await fixture.persistence.drizzle.transaction(async (tx) => {
    Result.getOrThrow(
      await appendPreparedAppRowRevisionAndAdvanceCurrentInTransactionResult(
        tx,
        {
          kind: "live",
          scopeId: fixture.scopeId,
          tableId: fixture.tableId,
          rowId,
          writeEpoch: fixture.epoch,
          commitSeq: CommitSeqSchema.make(1n),
          prevCommitSeq: null,
          schemaVersionId: fixture.schemaVersionId,
          creationTime,
          document,
        },
      ),
    );
  });
}

async function buildCount(
  persistence: PostgresFlarexPersistence,
  scopeId: string,
) {
  const result = await persistence.query<{ count: number }>(
    "select count(*)::int count from fx_system_unique_constraint_set_build where scope_id = $1",
    [scopeId],
  );
  return result.rows[0]?.count ?? -1;
}
