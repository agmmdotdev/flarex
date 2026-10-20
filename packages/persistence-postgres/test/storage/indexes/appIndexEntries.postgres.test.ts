import { createHash } from "node:crypto";
import { lockInstallationForCurrentTransaction, closeInstallationAdmission } from "../../../src/installation/installationLifecycle";
import { verifyIndexBatches } from "./indexBatchScenario";
import { verifyMembershipReadPreparation } from "./indexMembershipReadScenario";
import { verifyRetainedHistoryReads } from "./retainedHistoryReadScenario";
import { verifyDemandVectorFreshness } from "../documents/logicalDependencyValidationScenario";
import { consumeLogicalIndexRanges, readLogicalIndexRange, sameLogicalIndexMembership } from "../../../src/storage/documents/logicalDocuments/indexReads";
import { closeExactAttemptScopeClockObservation, lockScopeClockRowsForOrdinaryWriteInTransactionEffect } from "../../../src/scope/scopeClock";
import { insertCurrentScopeClockFixture } from "../../scope/scopeClockFixture";
import {
  canonicalizeAppDocumentV1,
  decodeAppCreationTimeV1,
} from "flarex-protocol/app-document";
import { decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import {
  decodeCatalogIndexDefinitionId,
  decodeCatalogTableId,
} from "flarex-protocol/catalog";
import {
  APP_BY_CREATION_TIME_PHYSICAL_SPEC_V1,
  APP_BY_ID_PHYSICAL_SPEC_V1,
  decodeOrderedIndexBoundHexV1,
  encodeOrderedIndexComponentsV1,
  orderedIndexCreationTimeV1,
  type OrderedIndexKeyHexV1,
} from "flarex-protocol/ordered-index";
import { decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import {
  appIndexPhysicalSpecSha256HexV1ToBytes,
  canonicalAppIndexPhysicalSpecBytesHexV1ToBytes,
  canonicalizeAppIndexPhysicalSpecV1,
} from "flarex-protocol/index-definition";
import {
  CommitSeqSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
} from "flarex-protocol/storage-authority";
import { describe, expect, it, vi } from "vitest";
import { Deferred, Effect, Result, Schema } from "effect";
import { fillPlaceholders, sql } from "drizzle-orm";
import { rowsFromDriverExecuteResult } from "../../../src/database/driverExecuteResult";

import {
  AppIndexEntryRevisionAlreadyExistsError,
  AppIndexEntryStorageCorruptionError,
} from "../../../src/storage/indexes/appIndexEntryErrors";
import {
  appendAppIndexEntryRevisionsInTransactionEffect,
  scanAppIndexAtSnapshotInTransactionEffect,
  scanCurrentAppIndexInTransactionEffect,
  scanCurrentPublicationIndexInTransactionEffect,
  consumeCurrentAppIndexPagesInTransactionEffect,
} from "../../../src/storage/indexes/appIndexEntries";
import {
  locateAppIndexDefinitionByIdEffect,
  type LocatedAppIndexDefinitionV1,
} from "../../../src/storage/indexes/appIndexDefinitions";
import { appendPreparedAppRowRevisionsInTransactionEffect } from "../../../src/storage/documents/appRows";
import type { PostgresFlarexPersistence } from "../../../src/database/postgres";
import { runEffect, runEffectFailure } from "../../support/effectTestRuntime";
import { withPostgresExecutionObservation } from "../../performance/postgresExecutionObservation";
import {
  postgresUrl,
  withPostgresSequentialScansDisabled,
  useFileScopedPostgresPersistence,
} from "../../support/postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const withPersistence = useFileScopedPostgresPersistence();
const scopeId = ScopeIdSchema.make(
  "scope_53000000-0000-0000-0000-000000000001",
);
const epoch = ScopeEpochSchema.make(
  "epoch_53000000-0000-0000-0000-000000000002",
);
const tableId = decodeCatalogTableId(1);
const indexDefinitionId = decodeCatalogIndexDefinitionId(1);
const schemaVersionId = decodeCatalogSchemaVersionId(
  "schema_index_rows_postgres_v1",
);
const creationTime = decodeAppCreationTimeV1(1_725_000_000_200.5);
const rowA = decodeAppRowIdHexV1("5300000000000000000000000000000a");
const rowB = decodeAppRowIdHexV1("5300000000000000000000000000000b");
const keyA = key("a");
const keyB = key("b");
const keyC = key("c");
const physicalSpec = APP_BY_CREATION_TIME_PHYSICAL_SPEC_V1;
const deploymentId = "deployment_s10_postgres";
let locatedDefinition: LocatedAppIndexDefinitionV1;

describePostgres("real PostgreSQL S10 app-index storage", () => {
  it("reads complete bounded retained positions and canonical revisions after physical deletion", async () => {
    await withPersistence(async persistence => {
      await insertClock(persistence);
      await persistence.drizzle.transaction(async tx => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try { await verifyRetainedHistoryReads(tx, { identity: { scopeId, tableId, rowId: rowA }, otherRowId: rowB,
          definition: locatedDefinition, epoch, schemaVersionId, creationTime }); }
        finally { closeInstallationAdmission(tx); }
      });
    });
  });
  it("retains genuine frozen catalog specifications and authenticates raw publication digests", async () => {
    await withPersistence(async persistence => {
      await insertClock(persistence);
      const definition = locatedDefinition;
      expect(Object.isFrozen(definition)).toBe(true);
      expect(Object.isFrozen(definition.physicalSpec)).toBe(true);
      expect(Object.isFrozen(definition.physicalSpec.orderedFields)).toBe(true);
      expect(Object.isFrozen(definition.physicalSpec.orderedFields[0])).toBe(true);
      expect(Object.isFrozen(definition.physicalSpec.tieBreaker)).toBe(true);
      expect(Reflect.set(definition.physicalSpec, "maxEncodedKeyBytes", 1)).toBe(false);
      expect(Reflect.set(definition.physicalSpec.orderedFields, "0", { kind: "documentPath", path: "other" })).toBe(false);
      expect(Reflect.set(definition, "physicalSpecSha256Hex", "0".repeat(64))).toBe(false);
      expect(await persistence.drizzle.transaction(async (tx) => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try {
return await runEffect(scanAppIndexAtSnapshotInTransactionEffect(tx, {
        scopeId, definition, bounds: {}, snapshotCommitSeq: CommitSeqSchema.make(1n), limit: 10,
      }));
        } finally { closeInstallationAdmission(tx); }
      })).toMatchObject({ entries: [], isDone: true });
      for (const publicationIndex of [
        { indexDefinitionId: definition.indexDefinitionId, physicalSpec: definition.physicalSpec,
          physicalSpecSha256Hex: "0".repeat(64) },
        { indexDefinitionId: definition.indexDefinitionId, physicalSpec: APP_BY_ID_PHYSICAL_SPEC_V1,
          physicalSpecSha256Hex: definition.physicalSpecSha256Hex },
      ]) {
        const refused = await persistence.drizzle.transaction(async (tx) => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try {
return await runEffectFailure(
          scanCurrentPublicationIndexInTransactionEffect(tx, { scopeId, publicationIndex, bounds: {}, limit: 10 }));
        } finally { closeInstallationAdmission(tx); }
      });
        expect(refused).toBeInstanceOf(AppIndexEntryStorageCorruptionError);
        expect(refused).toMatchObject({ reason: "activation index digest mismatch" });
      }
    });
  });

  it("prepares mixed membership definitions with one fresh scope check per operation", async () => {
    await withPersistence(async persistence => {
      await insertClock(persistence);
      await verifyMembershipReadPreparation(persistence.drizzle, scopeId, epoch, locatedDefinition);
    });
  });

  it("retains rollback and fresh OCC across interleaved predicate writers", async () => {
    await withPersistence(async persistence => {
      await insertClock(persistence);
      await verifyDemandVectorFreshness(persistence.drizzle, scopeId, epoch, locatedDefinition);
    });
  });

  it("applies bounded index batches with exact returned keys and atomic rollback", async () => {
    await withPersistence(async persistence => {
      await insertClock(persistence);
      await verifyIndexBatches(persistence, persistence.drizzle, scopeId, epoch, locatedDefinition, async run => {
        const measured = await withPostgresExecutionObservation(persistence.pool, run, { returnedCommands: true });
        expect(measured.observation.checkouts).toBe(1);
        expect(measured.observation.releases).toBe(1);
        expect(measured.observation.returnedCommands.filter(command => command.submittedCommand === "begin" || command.submittedCommand === "commit"))
          .toEqual([{ checkout: 1, submittedCommand: "begin", returnedCommand: "BEGIN" },
            { checkout: 1, submittedCommand: "commit", returnedCommand: "ROLLBACK" }]);
      });
    });
  }, 120_000);

  it.each(["commit", "rollback", "acquisitionFailure"] as const)("keeps nonempty demand validation fresh across an overlapping writer %s", async disposition => {
    await withPersistence(async persistence => {
      await insertClock(persistence);
      const write = async (tx: Parameters<typeof appendRow>[0], sequence: bigint) => {
        await runEffect(lockScopeClockRowsForOrdinaryWriteInTransactionEffect(tx, scopeId));
        await appendRow(tx, rowA, sequence, sequence === 1n ? null : 1n, "overlap");
        await runEffect(appendAppIndexEntryRevisionsInTransactionEffect(tx,
          [{ ...indexEntry(rowA, keyA, sequence), kind: sequence === 1n ? "live" : "tombstone" }]));
      };
      await persistence.drizzle.transaction(async tx => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try { await write(tx, 1n); }
        finally { closeExactAttemptScopeClockObservation(tx); closeInstallationAdmission(tx); }
      });
      const entered = await runEffect(Deferred.make<void, unknown>());
      const release = await runEffect(Deferred.make<void>());
      const rollback = new Error("overlapping vector writer rollback");
      const acquisitionRefusal = new Error("overlapping vector writer acquisition refused");
      const transactionFailure = disposition === "acquisitionFailure"
        ? vi.spyOn(persistence.drizzle, "transaction").mockRejectedValueOnce(acquisitionRefusal) : undefined;
      const writer = runEffect(Effect.tryPromise({
        try: () => persistence.drizzle.transaction(async tx => {
          await runEffect(lockInstallationForCurrentTransaction(tx));
          try {
            await write(tx, 2n);
            await runEffect(Deferred.succeed(entered, undefined));
            await runEffect(Deferred.await(release));
            if (disposition === "rollback") throw rollback;
          } finally {
            closeExactAttemptScopeClockObservation(tx); closeInstallationAdmission(tx);
          }
        }), catch: cause => cause,
      }).pipe(Effect.onExit(exit => Deferred.done(entered, exit)), Effect.result));
      try {
        if (disposition === "acquisitionFailure") {
          await expect(runEffect(Deferred.await(entered))).rejects.toBe(acquisitionRefusal);
          Result.match(await writer, {
            onSuccess: () => expect.fail("Writer acquisition unexpectedly succeeded"),
            onFailure: cause => expect(cause).toBe(acquisitionRefusal),
          });
          return;
        }
        await runEffect(Deferred.await(entered));
        await persistence.drizzle.transaction(async tx => {
          await runEffect(lockInstallationForCurrentTransaction(tx));
          try {
            const bounds = { startInclusive: decodeOrderedIndexBoundHexV1(keyA),
              endExclusive: decodeOrderedIndexBoundHexV1(keyB) };
            const captured = await runEffect(readLogicalIndexRange(tx, scopeId, { definition: locatedDefinition, bounds }, 4096,
              reason => reason));
            expect(captured.map(entry => entry.commitSeq)).toEqual([1n]);
            const conflict = "overlapping writer changed the range";
            const validate = () => consumeLogicalIndexRanges(tx, scopeId,
              [{ definition: locatedDefinition, bounds, entries: captured }], 4096, reason => reason,
              (_, current) => sameLogicalIndexMembership(current, captured) ? Effect.void : Effect.fail(conflict));
            // The uncommitted pointer/revision must be invisible to the vector.
            await runEffect(validate());
            await runEffect(Deferred.succeed(release, undefined));
            const outcome = await writer;
            Result.match(outcome, {
              onSuccess: () => expect(disposition).toBe("commit"),
              onFailure: cause => { expect(disposition).toBe("rollback"); expect(cause).toBe(rollback); },
            });
            await runEffect(lockScopeClockRowsForOrdinaryWriteInTransactionEffect(tx, scopeId));
            if (disposition === "commit") expect(await runEffectFailure(validate())).toBe(conflict);
            else await runEffect(validate());
          } finally { closeExactAttemptScopeClockObservation(tx); closeInstallationAdmission(tx); }
        });
      } finally {
        await runEffect(Deferred.succeed(release, undefined)); await writer;
        transactionFailure?.mockRestore();
      }
    });
  }, 120_000);

  it("proves exact snapshot/current reads, concurrent replay, and intended plans", async () => {
    await withPersistence(async (persistence) => {
      await insertClock(persistence);
      await persistence.drizzle.transaction(async (tx) => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try {

        await appendRow(tx, rowA, 1n, null, "a");
        expect(await runEffect(appendAppIndexEntryRevisionsInTransactionEffect(tx, [indexEntry(rowA, keyA, 1n)])),).toHaveLength(1);
        await appendRow(tx, rowB, 2n, null, "b");
        expect(await runEffect(appendAppIndexEntryRevisionsInTransactionEffect(tx, [indexEntry(rowB, keyB, 2n)])),).toHaveLength(1);
      
        } finally { closeInstallationAdmission(tx); }
      });

      const snapshot = await persistence.drizzle.transaction(async (tx) => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try {
return await runEffect(
          scanAppIndexAtSnapshotInTransactionEffect(tx, {
            scopeId,
            definition: locatedDefinition,
            bounds: {},
            snapshotCommitSeq: CommitSeqSchema.make(2n),
            limit: 10,
          }),
        );
        } finally { closeInstallationAdmission(tx); }
      },
      );
      expect(
        snapshot.entries.map((entry) => [entry.encodedKey, entry.rowId]),
      ).toEqual([
        [keyA, rowA],
        [keyB, rowB],
      ]);

      await persistence.drizzle.transaction(async (tx) => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try {

        await appendRow(tx, rowA, 3n, 1n, "a-next");
        const released =
          await runEffect(appendAppIndexEntryRevisionsInTransactionEffect(tx, [{
              ...indexEntry(rowA, keyA, 3n),
              kind: "tombstone",
            }]));
        expect(released).toHaveLength(1);
      
        } finally { closeInstallationAdmission(tx); }
      });
      const attempts = await Promise.allSettled([
        appendConcurrent(persistence, rowA, keyC),
        appendConcurrent(persistence, rowA, keyC),
      ]);
      expect(attempts.filter(attempt => attempt.status === "fulfilled")).toHaveLength(1);
      const failure = attempts.find(attempt => attempt.status === "rejected");
      expect(failure?.reason).toBeInstanceOf(
        AppIndexEntryRevisionAlreadyExistsError,
      );
      const current = await persistence.drizzle.transaction(async (tx) => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try {
return await runEffect(
          scanCurrentAppIndexInTransactionEffect(tx, {
            scopeId,
            definition: locatedDefinition,
            bounds: {},
            limit: 10,
          }),
        );
        } finally { closeInstallationAdmission(tx); }
      },
      );
      expect(current.entries.map((entry) => entry.commitSeq)).toEqual([2n, 3n]);

      expect((await indexPlans(persistence)).snapshot).toMatch(
        /fx_app_index_entry_rev_range_idx/,
      );
      await seedCurrentLookupPlanHistory(persistence);
      const plans = await indexPlans(persistence);
      expect(plans.current).toMatch(/fx_app_index_entry_current_pk/);
      // Either complete-key index can serve the point lookup. Assert all join keys
      // are index conditions; a whole revision scan plus Join Filter is not this proof.
      expect(plans.current).toMatch(
        /Index Scan using fx_app_index_entry_rev_(?:pk|commit_range_idx)/,
      );
      const revisionCondition = plans.current
        .split("\n")
        .find(
          (line) =>
            line.includes("Index Cond:") &&
            line.includes("current_entry.commit_seq"),
        );
      expect(revisionCondition).toBeDefined();
      for (const field of [
        "scope_uuid",
        "index_definition_id",
        "encoded_key",
        "row_id",
        "commit_seq",
      ]) {
        expect(revisionCondition).toContain(field);
      }
      for (const field of ["encoded_key", "row_id", "commit_seq"]) {
        expect(revisionCondition).toContain(`current_entry.${field}`);
      }
      expect(plans.current).not.toMatch(/Join Filter:/);
      await verifyDemandVectorPlanReuse(persistence);
    });
  }, 30_000);
});

/** Real named executions on one checkout with the default planner. Inspect the
 * server counters, then explain that exact prepared command and bound vector. */
async function verifyDemandVectorPlanReuse(persistence: PostgresFlarexPersistence) {
  await persistence.drizzle.transaction(async tx => {
    await runEffect(lockInstallationForCurrentTransaction(tx));
    const nativePrepare = tx._.session.prepareQuery.bind(tx._.session);
    let lastBindings: readonly unknown[] = [];
    const prepare = vi.spyOn(tx._.session, "prepareQuery").mockImplementation((...args) => {
      const prepared = nativePrepare(...args);
      if (args[2]?.startsWith("fx_index_demands_")) {
        vi.spyOn(prepared, "execute").mockImplementation(bindings => {
          lastBindings = fillPlaceholders(args[0].params, bindings ?? {});
          return nativePrepare(...args).execute(bindings);
        });
      }
      return prepared;
    });
    try {
      for (let attempt = 0; attempt < 20; attempt++) {
        const count = [1, 26, 4, 32][attempt % 4];
        if (count === undefined) throw new Error("Missing demand-count witness");
        let consumed = 0;
        await runEffect(consumeCurrentAppIndexPagesInTransactionEffect(tx, Array.from({ length: count }, (_, ordinal) => ({
          scopeId, definition: locatedDefinition,
          bounds: ordinal % 2 === 0 ? {} : { startInclusive: decodeOrderedIndexBoundHexV1(keyC) }, limit: 10,
        })), cause => cause, (ordinal, page) => Effect.sync(() => {
          expect(ordinal).toBe(consumed++);
          expect(page.entries.map(entry => entry.rowId)).toEqual(ordinal % 2 === 0 ? [rowB, rowA] : [rowA]);
        })));
        expect(consumed).toBe(count);
      }
      const records = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({
        name: Schema.String, statement: Schema.String,
        generic: Schema.BigIntFromString, custom: Schema.BigIntFromString,
      })))(rowsFromDriverExecuteResult(await tx.execute(sql`
        select name, statement, generic_plans::text as generic, custom_plans::text as custom
        from pg_prepared_statements where name like 'fx_index_demands_%'
      `), () => { throw new Error("Missing prepared statement rows"); }));
      expect(records).toHaveLength(1);
      const command = records[0];
      if (command === undefined) throw new Error("Missing prepared demand command");
      expect(command.statement.match(/union all/gi)).toHaveLength(7);
      expect(command.statement.length).toBeLessThan(8000);
      expect(command.generic).toBeGreaterThan(0n);
      expect(command.generic + command.custom).toBeGreaterThanOrEqual(20n);
      expect(lastBindings).toHaveLength(1);
      // EXECUTE requires utility-statement literals, not protocol placeholders.
      // The observed binding is internally encoded scalar JSON; escape SQL
      // quotes explicitly, and retain default standard-conforming string policy.
      expect(rowsFromDriverExecuteResult(await tx.execute(sql`show standard_conforming_strings`),
        () => { throw new Error("Missing string policy"); })).toEqual([{ standard_conforming_strings: "on" }]);
      const literals = lastBindings.map(value => {
        if (typeof value !== "string") throw new Error("Demand binding is not encoded JSON");
        return sql.raw(`'${value.replaceAll("'", "''")}'`);
      });
      const explained = rowsFromDriverExecuteResult(await tx.execute(sql`
        explain (costs off) execute ${sql.identifier(command.name)}(${sql.join(literals, sql`, `)})
      `), () => { throw new Error("Missing prepared plan"); });
      const text = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ "QUERY PLAN": Schema.String })))(explained)
        .map(row => row["QUERY PLAN"]).join("\n");
      expect(text).toMatch(/Function Scan on jsonb_to_recordset d/);
      expect(text).toMatch(/fx_app_index_entry_rev_(?:pk|commit_range_idx)/);
      expect(text).toContain("current_entry.commit_seq");
      // Genuine encoded keys preceding the late cursor. Clone the existing
      // authoritative row identity and index metadata, preserving both FKs.
      const keys = Array.from({ length: 10000 }, (_, ordinal) => {
        const encoded = encodeOrderedIndexComponentsV1([orderedIndexCreationTimeV1(90 + ordinal / 100000)]);
        return { key: encoded, sha: createHash("sha256").update(Buffer.from(encoded, "hex")).digest("hex") };
      });
      await tx.execute(sql`
        insert into fx_app_index_entry_rev
          (scope_uuid,index_definition_id,table_id,key_codec_version,physical_spec_sha256,
           encoded_key,key_sha256,row_id,commit_seq,is_tombstone)
        select r.scope_uuid,r.index_definition_id,r.table_id,r.key_codec_version,r.physical_spec_sha256,
          decode(k.key,'hex'),decode(k.sha,'hex'),r.row_id,r.commit_seq,r.is_tombstone
        from fx_app_index_entry_rev r cross join jsonb_to_recordset(${JSON.stringify(keys)}::jsonb) as k(key text,sha text)
        where r.row_id=decode(${rowB},'hex') and r.commit_seq=2
      `);
      await tx.execute(sql`
        insert into fx_app_index_entry_current (scope_uuid,index_definition_id,encoded_key,row_id,commit_seq)
        select r.scope_uuid,r.index_definition_id,r.encoded_key,r.row_id,r.commit_seq
        from fx_app_index_entry_rev r where r.row_id=decode(${rowB},'hex') and r.commit_seq=2
          and r.encoded_key < decode(${keyA},'hex')
      `);
      await tx.execute(sql`analyze fx_app_index_entry_current`);
      await tx.execute(sql`analyze fx_app_index_entry_rev`);
      const scalePlans: string[] = [];
      for (const demand of [
        { scopeId, definition: locatedDefinition, bounds: {}, after: { encodedKey: keyB, rowId: rowB }, limit: 10 },
        { scopeId, definition: locatedDefinition, bounds: { endExclusive: decodeOrderedIndexBoundHexV1(keys[0]?.key ?? keyA) }, limit: 10 },
      ]) {
        await runEffect(consumeCurrentAppIndexPagesInTransactionEffect(tx, [demand], cause => cause,
          (_, page) => Effect.sync(() => expect(page.entries.map(entry => entry.rowId))
            .toEqual(demand.after === undefined ? [] : [rowA]))));
        const binding = lastBindings[0];
        if (typeof binding !== "string") throw new Error("Missing scale demand binding");
        const result = rowsFromDriverExecuteResult(await tx.execute(sql`
          explain (analyze, costs off, timing off) execute ${sql.identifier(command.name)}
            (${sql.raw(`'${binding.replaceAll("'", "''")}'`)})
        `), () => { throw new Error("Missing scale plan"); });
        const plan = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ "QUERY PLAN": Schema.String })))(result)
          .map(row => row["QUERY PLAN"]).join("\n");
        scalePlans.push(plan);
        expect(plan.match(/One-Time Filter:/g)).toHaveLength(8);
        expect(plan.match(/Index (?:Only )?Scan using fx_app_index_entry_current_pk[^\n]*\(never executed\)/g)).toHaveLength(7);
        // Pointer selection alone is insufficient: unknown JSON page limits
        // must not turn the revision point lookup into a whole-history hash join.
        expect(plan).not.toMatch(/Seq Scan on fx_app_index_entry_rev/);
        for (const match of plan.matchAll(/Rows Removed by Filter: (\d+)/g)) expect(Number(match[1])).toBeLessThan(20);
      }
      console.log(JSON.stringify({ demandVectorPlan: { chars: command.statement.length,
        genericPlans: command.generic.toString(), customPlans: command.custom.toString(), plan: text, scalePlans } }));
    } finally { prepare.mockRestore(); closeInstallationAdmission(tx); }
  });
}

async function insertClock(
  persistence: PostgresFlarexPersistence,
): Promise<void> {
  await seedLocatedDefinition(persistence);
  await insertCurrentScopeClockFixture(persistence.drizzle, { scopeId, epoch, lastCommitSeq: 100n });
}

async function seedLocatedDefinition(
  persistence: PostgresFlarexPersistence,
): Promise<void> {
  const canonical = await canonicalizeAppIndexPhysicalSpecV1(physicalSpec);
  await persistence.query(
    `insert into deployments (deployment_id, project_id)
     values ($1, 'project_s10_postgres')`,
    [deploymentId],
  );
  await persistence.query(
    `insert into fx_control_table
       (deployment_id, table_id, namespace, logical_name)
     values ($1, $2, 'app', 'documents')`,
    [deploymentId, tableId],
  );
  await persistence.query(
    `insert into fx_control_scope
       (id, deployment_id, isolation_kind, physical_locator_json)
     values ($1, $2, 'shared_database', $3)`,
    [
      scopeId,
      deploymentId,
      {
        kind: "shared_database",
        databaseKey: "s10_postgres",
        schemaName: "public",
      },
    ],
  );
  await persistence.query(
    `insert into fx_control_index_definition
       (deployment_id, index_definition_id, access_kind, access_identity_id,
        table_id, logical_index_id, physical_spec_codec_version,
        physical_spec_json, physical_spec_bytes, physical_spec_sha256)
     values ($1, $2, 'by_creation_time', $3, $3, null, 1, $4, $5, $6)`,
    [
      deploymentId,
      indexDefinitionId,
      tableId,
      physicalSpec,
      canonicalAppIndexPhysicalSpecBytesHexV1ToBytes(
        canonical.canonicalBytesHex,
      ),
      appIndexPhysicalSpecSha256HexV1ToBytes(canonical.sha256Hex),
    ],
  );
  const located = await runEffect(
    locateAppIndexDefinitionByIdEffect(
      persistence.drizzle,
      scopeId,
      indexDefinitionId,
    ),
  );
  if (located === null)
    throw new Error("Expected located S10 index definition");
  locatedDefinition = located;
}

async function appendRow(
  tx: Parameters<
    typeof appendPreparedAppRowRevisionsInTransactionEffect
  >[0],
  rowId: typeof rowA,
  commitSeq: bigint,
  prevCommitSeq: bigint | null,
  title: string,
): Promise<void> {
  const document = await canonicalizeAppDocumentV1({
    tableId,
    rowId,
    creationTime,
    fields: { title },
  });
  await runEffect(appendPreparedAppRowRevisionsInTransactionEffect(tx, [{
      kind: "live",
      scopeId,
      tableId,
      rowId,
      writeEpoch: epoch,
      commitSeq: CommitSeqSchema.make(commitSeq),
      prevCommitSeq:
        prevCommitSeq === null ? null : CommitSeqSchema.make(prevCommitSeq),
      schemaVersionId,
      creationTime,
      document,
    }]));
}

async function appendConcurrent(
  persistence: PostgresFlarexPersistence,
  rowId: typeof rowA,
  encodedKey: OrderedIndexKeyHexV1,
) {
  return persistence.drizzle.transaction(async (tx) => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try {
return await runEffect(appendAppIndexEntryRevisionsInTransactionEffect(tx, [indexEntry(rowId, encodedKey, 3n)]));
        } finally { closeInstallationAdmission(tx); }
      },
  );
}

function indexEntry(
  rowId: typeof rowA,
  encodedKey: OrderedIndexKeyHexV1,
  commitSeq: bigint,
) {
  return {
    kind: "live" as const,
    scopeId,
    definition: locatedDefinition,
    encodedKey,
    rowId,
    writeEpoch: epoch,
    commitSeq: CommitSeqSchema.make(commitSeq),
  };
}

/** Plan-only history cohort: many revisions and two current pointers distinguish a point lookup from a tiny whole-index scan. */
async function seedCurrentLookupPlanHistory(
  persistence: PostgresFlarexPersistence,
) {
  await persistence.query(
    `insert into fx_app_row_rev
    (scope_uuid,table_id,row_id,commit_seq,prev_commit_seq,write_epoch_uuid,is_tombstone,schema_version_id,creation_time,value_codec_version,value_bytes,value_sha256)
    select scope_uuid,table_id,row_id,n,n-1,write_epoch_uuid,is_tombstone,schema_version_id,creation_time,value_codec_version,value_bytes,value_sha256
    from fx_app_row_rev cross join generate_series(4,1003) as n where row_id=decode($1,'hex') and commit_seq=3`,
    [rowA],
  );
  await persistence.query(
    `insert into fx_app_index_entry_rev
    (scope_uuid,index_definition_id,table_id,key_codec_version,physical_spec_sha256,encoded_key,key_sha256,row_id,commit_seq,is_tombstone)
    select scope_uuid,index_definition_id,table_id,key_codec_version,physical_spec_sha256,encoded_key,key_sha256,row_id,n,is_tombstone
    from fx_app_index_entry_rev cross join generate_series(4,1003) as n where row_id=decode($1,'hex') and commit_seq=3`,
    [rowA],
  );
  await persistence.query(
    `update fx_app_row_current set commit_seq=1003 where row_id=decode($1,'hex')`,
    [rowA],
  );
  await persistence.query(
    `update fx_app_index_entry_current set commit_seq=1003 where row_id=decode($1,'hex')`,
    [rowA],
  );
  await persistence.query(
    `update fx_system_scope_clock set last_commit_seq=1003 where scope_id=$1`,
    [scopeId],
  );
  await persistence.query("analyze fx_app_index_entry_rev");
  await persistence.query("analyze fx_app_index_entry_current");
}

async function indexPlans(
  persistence: PostgresFlarexPersistence,
): Promise<{ readonly snapshot: string; readonly current: string }> {
  const scopeUuid = "53000000-0000-0000-0000-000000000001";
  return withPostgresSequentialScansDisabled(persistence, async (client) => {
    const snapshot = await client.query<{ "QUERY PLAN": string }>(
      `explain (costs off)
       select distinct on (encoded_key, row_id) encoded_key, row_id, commit_seq
       from fx_app_index_entry_rev
       where scope_uuid = $1 and index_definition_id = 1 and commit_seq <= 3
       order by encoded_key, row_id, commit_seq desc`,
      [scopeUuid],
    );
    const current = await client.query<{ "QUERY PLAN": string }>(
      `explain (costs off)
       select revision.encoded_key, revision.row_id, revision.commit_seq
       from fx_app_index_entry_current as current_entry
       join fx_app_index_entry_rev as revision
         on revision.scope_uuid = current_entry.scope_uuid
         and revision.index_definition_id = current_entry.index_definition_id
         and revision.encoded_key = current_entry.encoded_key
         and revision.row_id = current_entry.row_id
         and revision.commit_seq = current_entry.commit_seq
       where current_entry.scope_uuid = $1
         and current_entry.index_definition_id = 1
         and not revision.is_tombstone
       order by current_entry.encoded_key, current_entry.row_id`,
      [scopeUuid],
    );
    return {
      snapshot: snapshot.rows.map((row) => row["QUERY PLAN"]).join("\n"),
      current: current.rows.map((row) => row["QUERY PLAN"]).join("\n"),
    };
  });
}

function key(value: string): OrderedIndexKeyHexV1 {
  return encodeOrderedIndexComponentsV1([
    orderedIndexCreationTimeV1(value.charCodeAt(0)),
  ]);
}
