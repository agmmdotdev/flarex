import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { ScopeIdSchema, CommitSeqSchema } from "flarex-protocol/storage-authority";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { decodeAppRowIdHexV1, appRowIdHexV1ToBytes } from "flarex-protocol/app-document-id";
import { consumeCapturedAppRowsAtSnapshotEffect, prepareAppRowsSnapshotReadEffect, type AppRowStorageCorruptionError } from "../src/appRows";
import { runEffect } from "./effectTestRuntime";
import { decodeCapturedApplicationWriteOwnershipEffect } from "../src/applicationWriteOwnership/Repository";
import { ApplicationWriteOwnershipHistoryBudget } from "../src/applicationWriteOwnership/Policy";
import { decodeCapturedApplicationOwnershipPolicyManifest } from "../src/applicationWriteOwnership/Successor";
import { decodeCapturedOwnershipUniqueClosure } from "../src/applicationWriteOwnership/UniqueEvidence";
import { decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";

const scopeUuid = "60000000-0000-0000-0000-000000000001";
const scopeId = ScopeIdSchema.make(`scope_${scopeUuid}`);
const ids = [1, 2, 3, 4].map(n => decodeAppRowIdHexV1(`6000000000000000000000000000000${n}`));

describe("fixed historical storage primitives", () => {
  it("retains missing/tombstone ordinals and the complete first crossing body", async () => {
    const db = new PGlite();
    try {
      await db.exec(`create table fx_app_row_rev (scope_uuid uuid, table_id integer, row_id bytea,
        commit_seq bigint, prev_commit_seq bigint, write_epoch_uuid uuid, schema_version_id text,
        creation_time double precision, value_codec_version integer, is_tombstone boolean,
        value_sha256 bytea, value_bytes bytea);
        create table fx_app_index_entry_rev (scope_uuid uuid, index_definition_id integer, table_id integer,
        key_codec_version integer, physical_spec_sha256 bytea, encoded_key bytea, key_sha256 bytea,
        row_id bytea, commit_seq bigint, is_tombstone boolean);`);
      const migration = await readFile(new URL("../drizzle/0129_finite_storage_reads.sql", import.meta.url), "utf8");
      // This small lane tests the exact installed storage function bodies. Full
      // migration/lifecycle/role attestation runs in the connected owner lanes.
      for (const statement of migration.split("--> statement-breakpoint").slice(1)) await db.exec(statement);
      await db.exec(await readFile(new URL("../drizzle/0132_finite_historical_identity.sql", import.meta.url), "utf8"));
      for (const [index, id] of ids.entries()) {
        if (index === 0) continue;
        await db.query(`insert into fx_app_row_rev values ($1, 1, $2, 1, null, $1, 'schema_test', 1, 1,
          $3, $4, $5)`, [scopeUuid, appRowIdHexV1ToBytes(id), index === 1,
          index === 1 ? null : new Uint8Array(32), index === 1 ? null : new Uint8Array(4).fill(index)]);
      }
      await db.query(`insert into fx_app_row_rev select scope_uuid, table_id, row_id, 2, 1, write_epoch_uuid,
        schema_version_id, creation_time, value_codec_version, false, value_sha256, decode('ff','hex')
        from fx_app_row_rev where row_id = $1`, [appRowIdHexV1ToBytes(ids[2]!)]);
      for (const [ordinal, id] of ids.entries()) {
        expect((await db.query(`select * from fx_read_historical_row_identity($1,1,$2)`,
          [scopeUuid, appRowIdHexV1ToBytes(id)])).rows).toEqual([{ ordinal: 0, identity_exists: ordinal !== 0 }]);
      }
      expect((await db.query(`select * from fx_read_historical_row_identity($1,2,$2)`,
        [scopeUuid, appRowIdHexV1ToBytes(ids[1]!)])).rows).toEqual([{ ordinal: 0, identity_exists: false }]);
      await expect(db.query(`select * from fx_read_historical_row_identity($1,1,$2)`, [scopeUuid, new Uint8Array(0)]))
        .rejects.toMatchObject({ code: "22023" });
      const read = await db.query<{ ordinal: number; row_present: boolean; is_tombstone: boolean | null;
        commit_seq_text: string | null; value_bytes: Uint8Array | null; body_withheld: boolean }>(
        `select * from fx_read_snapshot_rows($1,1,array[$2::bytea,$3::bytea,$4::bytea,$5::bytea],1,0,false)`,
        [scopeUuid, ...ids.map(appRowIdHexV1ToBytes)]);
      expect(read.rows.map(row => [row.ordinal, row.row_present, row.is_tombstone, row.commit_seq_text,
        row.value_bytes?.byteLength ?? null, row.body_withheld])).toEqual([
        [0, false, null, null, null, false], [1, true, true, "1", null, false],
        [2, true, false, "1", 4, false], [3, true, false, "1", null, true],
      ]);
      await expect(db.query(`select * from fx_read_snapshot_rows($1,1,array[$2::bytea,$2::bytea],1,0,false)`,
        [scopeUuid, appRowIdHexV1ToBytes(ids[0]!)]))
        .rejects.toMatchObject({ code: "22023" });

      // Historical unique lookups use ordered membership history: a later
      // tombstone must not erase the snapshot's row or page lookahead.
      for (const [index, id] of ids.slice(0, 3).entries()) await db.query(
        `insert into fx_app_index_entry_rev values ($1,1,1,1,$2,$3,$2,$4,1,false)`,
        [scopeUuid, new Uint8Array(32), new Uint8Array([index + 1]), appRowIdHexV1ToBytes(id)]);
      await db.query(`insert into fx_app_index_entry_rev select scope_uuid,index_definition_id,table_id,
        key_codec_version,physical_spec_sha256,encoded_key,key_sha256,row_id,2,true
        from fx_app_index_entry_rev where row_id=$1`, [appRowIdHexV1ToBytes(ids[0]!)]);
      const historical = await db.query<{ ordinal: number; commit_seq_text: string; encoded_key_bytes: Uint8Array }>(
        `select * from fx_read_snapshot_index_page($1,1,1,null,null,null,null,2)`, [scopeUuid]);
      expect(historical.rows.map(row => [row.ordinal, row.commit_seq_text, row.encoded_key_bytes[0]]))
        .toEqual([[0, "1", 1], [1, "1", 2], [2, "1", 3]]);
      const later = await db.query<{ ordinal: number; encoded_key_bytes: Uint8Array }>(
        `select * from fx_read_snapshot_index_page($1,1,2,null,null,null,null,2)`, [scopeUuid]);
      expect(later.rows.map(row => [row.ordinal, row.encoded_key_bytes[0]])).toEqual([[0, 2], [1, 3]]);
    } finally { await db.close(); }
  });

  it("defers later row columns until earlier consumer acceptance and retains column failure order", async () => {
    const prepared = await runEffect(prepareAppRowsSnapshotReadEffect({ scopeId, tableId: decodeCatalogTableId(1),
      rowIds: ids.slice(0, 2), snapshotCommitSeq: CommitSeqSchema.make(1n) }));
    let observedLater = false;
    const rows = [{ ordinal: 0, requestedRowId: appRowIdHexV1ToBytes(ids[0]!), rowPresent: false, bodyWithheld: false },
      { get ordinal() { observedLater = true; throw new Error("later row must remain deferred"); } }];
    expect(await runEffect(Effect.result(consumeCapturedAppRowsAtSnapshotEffect<AppRowStorageCorruptionError | "firstRefusal", never>(prepared, rows,
      cause => cause, () => Effect.fail("firstRefusal" as const))))).toEqual(Result.fail("firstRefusal"));
    expect(observedLater).toBe(false);
    const corruption = await runEffect(Effect.result(consumeCapturedAppRowsAtSnapshotEffect({ ...prepared, rowIds: [ids[0]!] },
      [{ ordinal: 0, requestedRowId: appRowIdHexV1ToBytes(ids[0]!), rowPresent: true, bodyWithheld: false,
        rowId: new Uint8Array(0), get scopeUuid() { throw new Error("later column must remain deferred"); } }],
      cause => cause, () => Effect.void)));
    expect(corruption).toMatchObject({ _tag: "Failure", failure: { _tag: "AppRowStorageCorruptionError" } });
  });

  it("rejects oversized ownership groups before touching withheld metadata bodies", async () => {
    let touched = false;
    const rows = Array.from({ length: 65 }, (_, ordinal) => ({ kind: "ownership", ordinal, scopeId,
      sequenceText: String(ordinal + 1), previousSequenceText: null, revisionId: null,
      evidenceLength: 1, bodyWithheld: true,
      get evidenceBytes() { touched = true; throw new Error("withheld body must remain deferred"); },
    }));
    expect(await runEffect(Effect.result(decodeCapturedApplicationWriteOwnershipEffect(scopeId, rows,
      new ApplicationWriteOwnershipHistoryBudget())))).toMatchObject({ _tag: "Failure", failure: { reason: "historyLimit" } });
    expect(touched).toBe(false);
  });

  it("charges demanded successor manifests and catalog closure before any withheld body", async () => {
    let touched = false;
    const budget = new ApplicationWriteOwnershipHistoryBudget();
    expect(budget.consume(64, 0)).toEqual(Result.succeed(undefined));
    const manifest = [{ evidenceLength: 1, get bytes() { touched = true; throw new Error("manifest must remain deferred"); } }];
    expect(await runEffect(Effect.result(decodeCapturedApplicationOwnershipPolicyManifest(manifest, budget))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "historyLimit" } });
    const definitions = [{ kind: "definition", ordinal: 0, evidenceLength: 1,
      get physicalSpecBytes() { touched = true; throw new Error("catalog must remain deferred"); } }];
    expect(await runEffect(Effect.result(decodeCapturedOwnershipUniqueClosure("deployment_test", decodeCatalogSchemaVersionId("schema_test"),
      definitions, budget)))).toMatchObject({ _tag: "Failure", failure: { reason: "historyLimit" } });
    expect(touched).toBe(false);
  });
});
