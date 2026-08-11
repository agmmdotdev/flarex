import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  canonicalizeAppDocumentV1,
  decodeAppCreationTimeV1,
} from "flarex-protocol/app-document";
import { decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
} from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
} from "flarex-protocol/storage-authority";

import { locateAppIndexDefinitionByIdEffect } from
  "../src/appIndexDefinitions";
import { appendAppRowRevisionAndAdvanceCurrentInTransaction } from
  "../src/appRows";
import {
  AppDeveloperOrderedIndexBuildIntegrationV1Error,
  buildAppDeveloperOrderedIndexV1Effect,
} from "../src/intrinsicCreationTimeIndexBuildV1";
import { reconcilePublishedIndexBuildsV1Effect } from
  "../src/indexBuildReconciliation";
import {
  createPostgresLocatedIndexBuildReconciliationTargetV1,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import { fxSystemScopeClocks } from "../src/schema";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const LOCATOR = Object.freeze({
  kind: "shared_database",
  databaseKey: "c08-developer-build-postgres",
  schemaName: "public",
} as const);

describe("C08 developer ordered-index PostgreSQL environment", () => {
  it("requires an authenticated PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting the developer build.",
    ).not.toBeNull();
  });
});

describePostgres("real PostgreSQL C08 developer ordered-index build", () => {
  it("proves rollback, scope-clock serialization, replay, and the validation access path", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const fixture = await makeFixture(persistence);
      const version = await persistence.query<{ server_version: string }>(
        "show server_version",
      );
      expect(version.rows[0]?.server_version).toMatch(/^18\./);

      await buildStep(fixture);
      await buildStep(fixture);
      const fault = await runEffectFailure(buildAppDeveloperOrderedIndexV1Effect(
        fixture.ports,
        fixture.input,
        {
          faultAfter: point => {
            if (point === "afterEntryWrite") {
              throw new Error("postgres developer-index rollback");
            }
          },
        },
      ));
      expect(fault).toBeInstanceOf(
        AppDeveloperOrderedIndexBuildIntegrationV1Error,
      );
      expect(await counts(persistence, fixture.indexDefinitionId)).toEqual({
        revisions: "0",
        current: "0",
        lifecycle: "backfilling",
      });

      const clockLocked = deferredSignal();
      const releaseClock = deferredSignal();
      const first = runEffect(buildAppDeveloperOrderedIndexV1Effect(
        fixture.ports,
        fixture.input,
        {
          faultAfter: async point => {
            if (point !== "afterScopeClockLock") return;
            clockLocked.resolve();
            await releaseClock.promise;
          },
        },
      ));
      await clockLocked.promise;
      const second = buildStep(fixture);
      try {
        await waitForBlockedScopeClock(persistence);
      } finally {
        releaseClock.resolve();
      }
      const concurrent = await Promise.all([first, second]);
      expect(concurrent.map(result => result.lifecycle)).toEqual([
        "backfilling",
        "validating",
      ]);
      for (let step = 0; step < 4; step += 1) {
        if ((await buildStep(fixture)).lifecycle === "enabled") break;
      }
      expect(await counts(persistence, fixture.indexDefinitionId)).toEqual({
        revisions: "18",
        current: "18",
        lifecycle: "enabled",
      });
      expect((await buildStep(fixture)).status).toBe("replayed");

      await seedPlannerRows(persistence, fixture.indexDefinitionId, 20_000);
      const scope = await persistence.query<{ scope_uuid: string }>(
        "select scope_uuid::text from fx_system_scope_clock limit 1",
      );
      const scopeUuid = scope.rows[0]?.scope_uuid;
      if (scopeUuid === undefined) throw new Error("Developer build scope missing.");
      const plan = await persistence.query<{ "QUERY PLAN": unknown }>(
        `explain (analyze, buffers, format json)
         select distinct row_id
           from fx_app_index_entry_current
          where scope_uuid = $1 and index_definition_id = $2
            and row_id > decode(repeat('00', 16), 'hex')
          order by row_id
          limit 17`,
        [scopeUuid, fixture.indexDefinitionId],
      );
      expect(JSON.stringify(plan.rows)).toContain(
        "fx_app_index_entry_current_scope_definition_row_idx",
      );
    });
  }, 180_000);
});

async function makeFixture(persistence: PostgresFlarexPersistence) {
  const deploymentId = "deployment_c08_dev_postgres";
  const scopeId = ScopeIdSchema.make(
    "scope_c08e0000-0000-0000-0000-000000000001",
  );
  const schemaVersionId = CatalogSchemaVersionIdSchema.make(
    "schema_c08_dev_postgres",
  );
  await persistence.insertDeploymentMetadata({
    deploymentId,
    projectId: "project_c08_dev_postgres",
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
    [
      scopeId,
      ScopeEpochSchema.make("epoch_c08e0000-0000-0000-0000-000000000001"),
    ],
  );
  await persistence.publishAppSchemaV1({
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
            name: { fieldType: { type: "string" }, optional: false },
          },
        },
      },
    }],
    indexes: [{
      tableLogicalName: "users",
      descriptor: "by_name",
      fields: ["name"],
    }],
  });
  for (let value = 1; value <= 18; value += 1) {
    await insertRow(
      persistence,
      scopeId,
      schemaVersionId,
      value,
      BigInt(value),
    );
  }
  const target = createPostgresLocatedIndexBuildReconciliationTargetV1(
    persistence,
    LOCATOR,
  );
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
  const reconciliation = await runEffect(reconcilePublishedIndexBuildsV1Effect(
    ports,
    { deploymentId, schemaVersionId },
  ));
  if (reconciliation.status !== "reconciled") {
    throw new Error("Developer PostgreSQL fixture did not reconcile.");
  }
  let indexDefinitionId: (typeof reconciliation.definitionIds)[number] | undefined;
  for (const candidate of reconciliation.definitionIds) {
    const definition = await runEffect(locateAppIndexDefinitionByIdEffect(
      persistence.drizzle,
      scopeId,
      candidate,
    ));
    if (definition?.access.kind === "developer") {
      indexDefinitionId = candidate;
      break;
    }
  }
  if (indexDefinitionId === undefined) {
    throw new Error("Developer PostgreSQL fixture omitted its definition.");
  }
  return Object.freeze({
    ports,
    indexDefinitionId,
    input: Object.freeze({
      deploymentId,
      indexDefinitionId,
      pageSize: 16,
    }),
  });
}

async function waitForBlockedScopeClock(
  persistence: PostgresFlarexPersistence,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await persistence.query<{ blocked: number }>(
      `select count(*)::int as blocked
         from pg_stat_activity
        where datname = current_database()
          and wait_event_type = 'Lock'
          and cardinality(pg_blocking_pids(pid)) > 0
          and query ilike '%fx_system_scope_clock%'`,
    );
    if ((result.rows[0]?.blocked ?? 0) >= 1) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for a blocked developer-index builder.");
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

async function insertRow(
  persistence: PostgresFlarexPersistence,
  scopeId: ReturnType<typeof ScopeIdSchema.make>,
  schemaVersionId: ReturnType<typeof CatalogSchemaVersionIdSchema.make>,
  rowByte: number,
  commitSeqValue: bigint,
) {
  const rowId = decodeAppRowIdHexV1(
    rowByte.toString(16).padStart(2, "0").repeat(16),
  );
  const tableId = decodeCatalogTableId(1);
  const creationTime = decodeAppCreationTimeV1(Number(commitSeqValue));
  const document = await canonicalizeAppDocumentV1({
    tableId,
    rowId,
    creationTime,
    fields: { name: `user-${String(19 - rowByte).padStart(2, "0")}` },
  });
  const clock = await persistence.getScopeClock(scopeId);
  if (clock === null) throw new Error("Developer PostgreSQL clock missing.");
  const commitSeq = CommitSeqSchema.make(commitSeqValue);
  await persistence.drizzle.transaction(async tx => {
    await appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
      kind: "live",
      scopeId,
      tableId,
      rowId,
      writeEpoch: clock.epoch,
      commitSeq,
      prevCommitSeq: null,
      schemaVersionId,
      creationTime,
      value: {
        codecVersion: document.codecVersion,
        valueJson: document.valueJson,
        canonicalBytes: document.canonicalBytes,
        sha256: document.sha256,
      },
    });
    await tx.update(fxSystemScopeClocks).set({ lastCommitSeq: commitSeq }).where(
      eq(fxSystemScopeClocks.scopeId, scopeId),
    );
  });
}

function buildStep(fixture: Awaited<ReturnType<typeof makeFixture>>) {
  return runEffect(buildAppDeveloperOrderedIndexV1Effect(
    fixture.ports,
    fixture.input,
  ));
}

function counts(
  persistence: PostgresFlarexPersistence,
  indexDefinitionId: number,
) {
  return persistence.query<{
    revisions: string;
    current: string;
    lifecycle: string;
  }>(
    `select
       (select count(*)::text from fx_app_index_entry_rev
         where index_definition_id = $1) as revisions,
       (select count(*)::text from fx_app_index_entry_current
         where index_definition_id = $1) as current,
       (select lifecycle from fx_system_index_build_state
         where index_definition_id = $1) as lifecycle`,
    [indexDefinitionId],
  ).then(result => result.rows[0]);
}

async function seedPlannerRows(
  persistence: PostgresFlarexPersistence,
  indexDefinitionId: number,
  rowCount: number,
): Promise<void> {
  const firstCommit = 1_000;
  const lastCommit = firstCommit + rowCount - 1;
  await persistence.query(
    `with template as (
       select scope_uuid, table_id, write_epoch_uuid, schema_version_id,
              value_codec_version, value_json, value_bytes, value_sha256
         from fx_app_row_rev
        order by commit_seq
        limit 1
     )
     insert into fx_app_row_rev
       (scope_uuid, table_id, row_id, commit_seq, prev_commit_seq,
        write_epoch_uuid, schema_version_id, creation_time,
        value_codec_version, is_tombstone, value_json, value_bytes,
        value_sha256)
     select template.scope_uuid, template.table_id,
            decode(lpad(to_hex(series.value), 32, '0'), 'hex'),
            series.value, null, template.write_epoch_uuid,
            template.schema_version_id, series.value,
            template.value_codec_version, false, template.value_json,
            template.value_bytes, template.value_sha256
       from template
       cross join generate_series($1::integer, $2::integer) as series(value)`,
    [firstCommit, lastCommit],
  );
  await persistence.query(
    `with generated as (
       select series.value,
              decode(lpad(to_hex(series.value), 32, '0'), 'hex') as row_id,
              1 + mod(series.value - $2::integer, 18) as template_byte
         from generate_series($2::integer, $3::integer) as series(value)
     )
     insert into fx_app_index_entry_rev
       (scope_uuid, index_definition_id, table_id, key_codec_version,
        physical_spec_sha256, encoded_key, key_sha256, row_id,
        commit_seq, prev_commit_seq, write_epoch_uuid, is_tombstone)
     select template.scope_uuid, template.index_definition_id,
            template.table_id, template.key_codec_version,
            template.physical_spec_sha256, template.encoded_key,
            template.key_sha256, generated.row_id, generated.value, null,
            template.write_epoch_uuid, false
       from generated
       join lateral (
         select revision.*
           from fx_app_index_entry_rev as revision
          where revision.index_definition_id = $1
            and revision.commit_seq between 1 and 18
            and get_byte(revision.row_id, 0) = generated.template_byte
          limit 1
       ) as template on true`,
    [indexDefinitionId, firstCommit, lastCommit],
  );
  await persistence.query(
    `insert into fx_app_index_entry_current
       (scope_uuid, index_definition_id, encoded_key, row_id, commit_seq)
     select scope_uuid, index_definition_id, encoded_key, row_id, commit_seq
       from fx_app_index_entry_rev
      where index_definition_id = $1
        and commit_seq between $2::integer and $3::integer`,
    [indexDefinitionId, firstCommit, lastCommit],
  );
  await persistence.query("analyze fx_app_index_entry_current");
}
