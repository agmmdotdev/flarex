import { lockInstallationForCurrentTransaction, closeInstallationAdmission } from "../src/installationLifecycle";
import {
  canonicalizeAppDocumentV1,
  decodeAppCreationTimeV1,
} from "flarex-protocol/app-document";
import { decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { orderedIndexValueFromFlarexValueV1 } from "flarex-protocol/ordered-index";
import { decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
} from "flarex-protocol/storage-authority";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  decodeAppUniqueConstraintIdV1Result,
  type AppUniqueKeyProjectionV1,
} from "../src/appUniqueKeyContract";
import {
  AppUniqueKeyConflictError,
  applyAppUniqueKeyMutationsInTransactionEffect,
} from "../src/appUniqueKeys";
import {
  appendPreparedAppRowRevisionsInTransactionEffect,
  type AppendPreparedAppRowRevisionV1Input,
} from "../src/appRows";
import type { PostgresFlarexPersistence } from "../src/postgres";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import { verifyUniqueBatches } from "./uniqueBatchScenario";
import { withPostgresExecutionObservation } from "./postgresExecutionObservation";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const scopeId = ScopeIdSchema.make(
  "scope_55000000-0000-0000-0000-000000000001",
);
const otherScopeId = ScopeIdSchema.make(
  "scope_55000000-0000-0000-0000-000000000099",
);
const epoch = ScopeEpochSchema.make(
  "epoch_55000000-0000-0000-0000-000000000002",
);
const otherEpoch = ScopeEpochSchema.make(
  "epoch_55000000-0000-0000-0000-000000000098",
);
const tableId = decodeCatalogTableId(1);
const constraintId = Result.getOrThrow(decodeAppUniqueConstraintIdV1Result(1));
const schemaVersionId = decodeCatalogSchemaVersionId(
  "schema_unique_rows_postgres_v1",
);
const creationTime = decodeAppCreationTimeV1(1_725_000_000_400.5);
const rowA = decodeAppRowIdHexV1("5500000000000000000000000000000a");
const rowB = decodeAppRowIdHexV1("5500000000000000000000000000000b");
const rowC = decodeAppRowIdHexV1("5500000000000000000000000000000c");
const key = projection("same-key");

describePostgres("real PostgreSQL S11 unique-key storage", () => {
  it("applies bounded unique sets and rolls back later-batch failures", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      await insertClocks(persistence);
      await verifyUniqueBatches(persistence, persistence.drizzle, scopeId, epoch, async run => {
        const measured = await withPostgresExecutionObservation(persistence.pool, run, { returnedCommands: true });
        expect(measured.observation.checkouts).toBe(1);
        expect(measured.observation.releases).toBe(1);
        expect(measured.observation.returnedCommands.filter(command => command.submittedCommand === "begin" || command.submittedCommand === "commit"))
          .toEqual([{ checkout: 1, submittedCommand: "begin", returnedCommand: "BEGIN" },
            { checkout: 1, submittedCommand: "commit", returnedCommand: "ROLLBACK" }]);
      });
    });
  }, 60_000);
  it("preserves exact ownership, rejects overwrite, and permits another scope", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await insertClocks(persistence);
      await appendRow(persistence, await liveRow(
        scopeId,
        epoch,
        rowA,
        1n,
        "owner",
      ));
      const claimed = await apply(persistence, scopeId, epoch, rowA, 1n);
      expect(claimed.status).toBe("claimed");

      expect(claimed.claim).toMatchObject({scopeId, constraintId, tableId, rowId: rowA});
      const repeatedClaim = await persistence.drizzle.transaction(async (tx) => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try {
return await runEffectFailure(applyAppUniqueKeyMutationsInTransactionEffect(tx, [{
          scopeId,
          constraintId,
          tableId,
          rowId: rowA,
          writeEpoch: epoch,
          previous: null,
          next: key,
        }]));
        } finally { closeInstallationAdmission(tx); }
      }
      );
      expect(repeatedClaim).toBeInstanceOf(AppUniqueKeyConflictError);

      await appendRow(persistence, await liveRow(
        scopeId,
        epoch,
        rowB,
        2n,
        "conflict",
      ));
      const conflict = await persistence.drizzle.transaction(async (tx) => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try {
return await runEffectFailure(applyAppUniqueKeyMutationsInTransactionEffect(tx, [{
          scopeId,
          constraintId,
          tableId,
          rowId: rowB,
          writeEpoch: epoch,
          previous: null,
          next: key,
        }]));
        } finally { closeInstallationAdmission(tx); }
      }
      );
      expect(conflict).toBeInstanceOf(AppUniqueKeyConflictError);

      await appendRow(persistence, await liveRow(
        otherScopeId,
        otherEpoch,
        rowC,
        1n,
        "other-scope",
      ));
      expect((await apply(
        persistence,
        otherScopeId,
        otherEpoch,
        rowC,
        1n,
      )).status).toBe("claimed");

      const stored = await persistence.query<{
        count: string;
        codecs: string;
        scopes: string;
      }>(`
        select count(*)::text as count,
               string_agg(distinct key_codec_version::text, ',' order by key_codec_version::text) as codecs,
               count(distinct scope_uuid)::text as scopes
        from fx_app_unique_key
      `);
      expect(stored.rows).toEqual([{ count: "2", codecs: "1", scopes: "2" }]);
    });
  }, 30_000);
});

async function insertClocks(
  persistence: PostgresFlarexPersistence,
): Promise<void> {
  await persistence.query(
    `with clock as (
       insert into fx_system_scope_clock (scope_id, last_commit_seq)
       values ($1, 100), ($3, 100) returning scope_id
     )
     insert into fx_system_scope_execution_authority (scope_id, storage_generation, epoch)
     select scope_id, 'flarexdb_v1', case when scope_id = $1 then $2 else $4 end from clock`,
    [scopeId, epoch, otherScopeId, otherEpoch],
  );
}

async function appendRow(
  persistence: PostgresFlarexPersistence,
  input: AppendPreparedAppRowRevisionV1Input,
): Promise<void> {
  await persistence.drizzle.transaction(async (tx) => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try {

    await runEffect(appendPreparedAppRowRevisionsInTransactionEffect(tx, [input]));
  
        } finally { closeInstallationAdmission(tx); }
      });
}

async function apply(
  persistence: PostgresFlarexPersistence,
  owningScopeId: typeof scopeId,
  writeEpoch: typeof epoch,
  rowId: typeof rowA,
  commitSeq: bigint,
) {
  const results = await persistence.drizzle.transaction(async (tx) => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try {
return await runEffect(applyAppUniqueKeyMutationsInTransactionEffect(tx, [{
      scopeId: owningScopeId,
      constraintId,
      tableId,
      rowId,
      writeEpoch,
      previous: null,
      next: key,
    }]));
        } finally { closeInstallationAdmission(tx); }
      }
  );
  expect(results).toHaveLength(1);
  const result = results[0];
  if (result === undefined) throw new Error("Missing unique mutation result");
  return result;
}

async function liveRow(
  owningScopeId: typeof scopeId,
  writeEpoch: typeof epoch,
  rowId: typeof rowA,
  commitSeq: bigint,
  title: string,
): Promise<AppendPreparedAppRowRevisionV1Input> {
  return {
    kind: "live",
    scopeId: owningScopeId,
    tableId,
    rowId,
    writeEpoch,
    commitSeq: CommitSeqSchema.make(commitSeq),
    prevCommitSeq: null,
    schemaVersionId,
    creationTime,
    document: await canonicalizeAppDocumentV1({
      tableId,
      rowId,
      creationTime,
      fields: { title },
    }),
  };
}

function projection(value: string): AppUniqueKeyProjectionV1 {
  return Object.freeze({
    sparse: true,
    localeKey: null,
    values: Object.freeze([orderedIndexValueFromFlarexValueV1(value)]),
  });
}
