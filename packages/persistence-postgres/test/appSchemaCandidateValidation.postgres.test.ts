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
} from "flarex-protocol/storage-authority";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  createAppSchemaCandidateValidationPort,
  createLocatedAppSchemaCandidateValidationTarget,
  advanceAppSchemaCandidateValidationEffect,
  installAppSchemaCandidateValidationEffect,
  loadAppSchemaCandidateValidationEffect,
  settleAppSchemaCandidateValidationEffect,
} from "../src/appSchemaCandidateValidation";
import { appendPreparedAppRowRevisionAndAdvanceCurrentInTransactionResult } from
  "../src/appRows";
import type { PostgresFlarexPersistence } from "../src/postgres";
import type { ScopePhysicalLocator } from "../src/scopeMetadataTypes";
import { runEffect } from "./effectTestRuntime";
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

describePostgres("M03-A candidate validation - PostgreSQL", () => {
  it("serializes concurrent replacements behind the scope clock", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const fixture = await fixtureFor(persistence, "concurrency");
      await runEffect(installAppSchemaCandidateValidationEffect(
        port(fixture),
        input(fixture, fixture.schemaVersionId),
      ));

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
    await withTemporaryPostgresPersistence(async persistence => {
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
    await withTemporaryPostgresPersistence(async persistence => {
      const fixture = await fixtureFor(persistence, "frontier_plan");
      await appendLive(fixture, rowId(1), 1n, null, { name: "eligible" });
      await setClockCommit(fixture, 1n);
      await install(fixture, fixture.schemaVersionId);

      await persistence.query(
        `insert into fx_app_row_rev
          (scope_uuid, table_id, row_id, commit_seq, prev_commit_seq,
           write_epoch_uuid, schema_version_id, creation_time,
           value_codec_version, is_tombstone, value_json, value_bytes,
           value_sha256)
         select clock.scope_uuid, $2::integer,
           decode(lpad(to_hex(series.value), 32, '0'), 'hex'),
           2, null, clock.epoch_uuid, $3, 1750000000000,
           1, true, null, null, null
         from fx_system_scope_clock as clock
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
  await persistence.query(
    `insert into fx_system_scope_clock
      (scope_id, storage_generation, storage_generation_fence,
       last_commit_seq, last_outbox_seq, epoch)
     values ($1, 'flarexdb_v1', 1, 0, 0, $2)`,
    [scopeId, epoch],
  );
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
    Result.getOrThrow(
      await appendPreparedAppRowRevisionAndAdvanceCurrentInTransactionResult(
        tx,
        {
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
        },
      ),
    );
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
  return createAppSchemaCandidateValidationPort({
    controlDb: fixture.persistence.drizzle,
    authority: {
      scopeMetadata: {
        getScopeMetadataByDeploymentId: (deploymentId: string) =>
          fixture.persistence.getScopeMetadataByDeploymentId(deploymentId),
      },
      provisioningReceipts: {
        getScopeAuthorityProvisioningReceipt: async () => null,
      },
      scopeClockTargets: { resolve: async () => fixture.target },
    },
  });
}

function input(fixture: Fixture, schemaVersionId: Fixture["schemaVersionId"]) {
  return Object.freeze({ deploymentId: fixture.deploymentId, schemaVersionId });
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
