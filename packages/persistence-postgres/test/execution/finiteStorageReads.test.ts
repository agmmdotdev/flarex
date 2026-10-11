import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { Cause, Effect, Exit, Result } from "effect";
import { describe, expect, it } from "vitest";
import { ScopeIdSchema, ScopeUuidV1Schema, CommitSeqSchema } from "flarex-protocol/storage-authority";
import { decodeCatalogTableId, decodeCatalogIndexDefinitionId } from "flarex-protocol/catalog";
import { APP_BY_ID_PHYSICAL_SPEC_V1 } from "flarex-protocol/ordered-index";
import { decodeAppRowIdHexV1, appRowIdHexV1ToBytes } from "flarex-protocol/app-document-id";
import {
  consumeCapturedAppRowsAtSnapshotEffect,
  prepareAppRowsSnapshotReadResult,
} from "../../src/storage/documents/appRows";
import { decodeCapturedAppIndexSnapshotPageEffect, type PreparedAppIndexSnapshotRead } from "../../src/storage/indexes/appIndexEntries";
import {
  type AppRowStorageCorruptionError,
} from "../../src/storage/documents/appRowErrors";
import { runEffect } from "../support/effectTestRuntime";
import { decodeCapturedApplicationWriteOwnershipEffect } from "../../src/application/ownership/Repository";
import { ApplicationWriteOwnershipHistoryBudget } from "../../src/application/ownership/Policy";
import { decodeCapturedApplicationOwnershipPolicyManifest } from "../../src/application/ownership/Successor";
import { decodeCapturedOwnershipUniqueClosure } from "../../src/application/ownership/UniqueEvidence";
import { decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";

const scopeUuid = "60000000-0000-0000-0000-000000000001";
const scopeId = ScopeIdSchema.make(`scope_${scopeUuid}`);
const ids = [1, 2, 3, 4].map(n => decodeAppRowIdHexV1(`6000000000000000000000000000000${n}`));

describe("fixed historical storage primitives", () => {
  it("refuses duplicate row preparation before reading the later snapshot field", () => {
    let snapshotAccessed = false;
    const verdict = prepareAppRowsSnapshotReadResult({ scopeId, tableId: decodeCatalogTableId(1), rowIds: [ids[0]!, ids[0]!],
      get snapshotCommitSeq(): never { snapshotAccessed = true; throw new Error("later snapshot must remain deferred"); } });
    expect(Result.isFailure(verdict)).toBe(true);
    if (Result.isFailure(verdict)) expect(verdict.failure.issue.reason).toBe("invalidRowId");
    expect(snapshotAccessed).toBe(false);
  });

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
      const migration = await readFile(new URL("../../drizzle/0129_finite_storage_reads.sql", import.meta.url), "utf8");
      // This small lane tests the exact installed storage function bodies. Full
      // migration/lifecycle/role attestation runs in the connected owner lanes.
      for (const statement of migration.split("--> statement-breakpoint").slice(1)) await db.exec(statement);
      await db.exec(await readFile(new URL("../../drizzle/0132_finite_historical_identity.sql", import.meta.url), "utf8"));
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
    const prepared = Result.getOrThrow(prepareAppRowsSnapshotReadResult({ scopeId, tableId: decodeCatalogTableId(1),
      rowIds: ids.slice(0, 2), snapshotCommitSeq: CommitSeqSchema.make(1n) }));
    let observedLater = false;
    const rows = [{ ordinal: 0, requestedRowId: appRowIdHexV1ToBytes(ids[0]!), rowPresent: false, bodyWithheld: false },
      { get ordinal() { observedLater = true; throw new Error("later row must remain deferred"); } }];
    const refused = await runEffect(Effect.result(consumeCapturedAppRowsAtSnapshotEffect<AppRowStorageCorruptionError | "firstRefusal", never>(prepared, rows,
      cause => cause, () => Effect.fail("firstRefusal" as const))));
    expect(Result.isFailure(refused)).toBe(true);
    if (Result.isFailure(refused)) expect(refused.failure).toBe("firstRefusal");
    expect(observedLater).toBe(false);
    const corruption = await runEffect(Effect.result(consumeCapturedAppRowsAtSnapshotEffect({ ...prepared, rowIds: [ids[0]!] },
      [{ ordinal: 0, requestedRowId: appRowIdHexV1ToBytes(ids[0]!), rowPresent: true, bodyWithheld: false,
        rowId: new Uint8Array(0), get scopeUuid() { throw new Error("later column must remain deferred"); } }],
      cause => cause, () => Effect.void)));
    expect(Result.isFailure(corruption)).toBe(true);
    if (Result.isFailure(corruption)) expect(corruption.failure).toMatchObject({
      _tag: "AppRowStorageCorruptionError", reason: "stored revision columns do not decode",
    });
  });

  it("keeps row consumption lazy and stops after interruption before later row access", async () => {
    const prepared = Result.getOrThrow(prepareAppRowsSnapshotReadResult({ scopeId, tableId: decodeCatalogTableId(1),
      rowIds: ids.slice(0, 2), snapshotCommitSeq: CommitSeqSchema.make(1n) }));
    let consumed = 0, finalized = 0, observedLater = false;
    const rows = [{ ordinal: 0, requestedRowId: appRowIdHexV1ToBytes(ids[0]!), rowPresent: false, bodyWithheld: false },
      { get ordinal() { observedLater = true; throw new Error("Interrupted consumer must stop before later row access"); } }];
    const work = consumeCapturedAppRowsAtSnapshotEffect(prepared, rows, cause => cause, () => Effect.suspend(() => {
      consumed++;
      return Effect.interrupt.pipe(Effect.ensuring(Effect.sync(() => { finalized++; })));
    }));
    expect(consumed).toBe(0);
    const exit = await runEffect(Effect.exit(work));
    if (!Exit.isFailure(exit)) throw new Error("Expected row-consumer interruption");
    expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    expect(consumed).toBe(1);
    expect(finalized).toBe(1);
    expect(observedLater).toBe(false);
  });

  it.each(["missing", "tombstone"] as const)("interrupts before accessing the next array slot after a %s row", async kind => {
    const prepared = Result.getOrThrow(prepareAppRowsSnapshotReadResult({ scopeId, tableId: decodeCatalogTableId(1),
      rowIds: ids.slice(0, 2), snapshotCommitSeq: CommitSeqSchema.make(1n) }));
    const first = { ordinal: 0, requestedRowId: appRowIdHexV1ToBytes(ids[0]!), rowPresent: kind === "tombstone", bodyWithheld: false,
      rowId: appRowIdHexV1ToBytes(ids[0]!), scopeUuid, writeEpochUuid: scopeUuid, commitSeq: "1", prevCommitSeq: null,
      schemaVersionId: "finite_schema", creationTime: 1, isTombstone: true, valueBytes: null, valueSha256: null };
    let laterAccessed = false;
    const rows: unknown[] = [first];
    Object.defineProperty(rows, 1, { get() { laterAccessed = true; throw new Error("next array slot must remain deferred"); } });
    const exit = await runEffect(Effect.exit(consumeCapturedAppRowsAtSnapshotEffect(prepared, rows, cause => cause, (_id, revision) => {
      expect(revision.kind).toBe(kind);
      return Effect.interrupt;
    })));
    if (!Exit.isFailure(exit)) throw new Error("Expected row-consumer interruption");
    expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    expect(laterAccessed).toBe(false);
  });

  it.each(["ordinal", "requestedRowId", "rowPresent", "bodyWithheld"] as const)(
    "preserves the original first-row %s getter defect without accessing a later row", async field => {
    const prepared = Result.getOrThrow(prepareAppRowsSnapshotReadResult({ scopeId, tableId: decodeCatalogTableId(1),
      rowIds: ids.slice(0, 2), snapshotCommitSeq: CommitSeqSchema.make(1n) }));
    const defect = new Error("original driver getter defect");
    let laterAccessed = false;
    const first = { ordinal: 0, requestedRowId: appRowIdHexV1ToBytes(ids[0]!), rowPresent: false, bodyWithheld: false };
    Object.defineProperty(first, field, { get() { throw defect; } });
    const rows = [first,
      { get ordinal() { laterAccessed = true; throw new Error("later row must remain deferred"); } }];
    const exit = await runEffect(Effect.exit(consumeCapturedAppRowsAtSnapshotEffect(prepared, rows, cause => cause, () => Effect.void)));
    if (!Exit.isFailure(exit)) throw new Error("Expected original getter defect");
    expect(exit.cause.reasons.filter(Cause.isDieReason).map(reason => reason.defect)).toEqual([defect]);
    expect(laterAccessed).toBe(false);
  });

  it("stops settlement at a withheld body and preserves trusted hydration's defect", async () => {
    const prepared = Result.getOrThrow(prepareAppRowsSnapshotReadResult({ scopeId, tableId: decodeCatalogTableId(1),
      rowIds: ids.slice(0, 2), snapshotCommitSeq: CommitSeqSchema.make(1n) }));
    let consumed = 0, bodyAccessed = false, laterAccessed = false;
    const rows = [{ ordinal: 0, requestedRowId: appRowIdHexV1ToBytes(ids[0]!), rowPresent: true, bodyWithheld: true,
      get rowId() { bodyAccessed = true; throw new Error("withheld body must remain deferred"); } },
    { get ordinal() { laterAccessed = true; throw new Error("later row must remain deferred"); } }];
    const consume = () => Effect.sync(() => { consumed++; });
    expect(await runEffect(consumeCapturedAppRowsAtSnapshotEffect(prepared, rows, cause => cause, consume, true))).toBe(0);
    const exit = await runEffect(Effect.exit(consumeCapturedAppRowsAtSnapshotEffect(prepared, rows, cause => cause, consume)));
    if (!Exit.isFailure(exit)) throw new Error("Expected trusted hydration defect");
    expect(Cause.hasDies(exit.cause)).toBe(true);
    expect(consumed).toBe(0);
    expect(bodyAccessed).toBe(false);
    expect(laterAccessed).toBe(false);
  });

  it("checks an index ordinal before its body and refuses the first corrupt member before later array access", async () => {
    const input: PreparedAppIndexSnapshotRead = { scopeId, scopeUuid: ScopeUuidV1Schema.make(scopeUuid),
      indexDefinitionId: decodeCatalogIndexDefinitionId(1), physicalSpec: APP_BY_ID_PHYSICAL_SPEC_V1,
      physicalSpecSha256: new Uint8Array(32), bounds: {}, limit: 2, snapshotCommitSeq: CommitSeqSchema.make(1n) };
    let bodyAccessed = false, laterAccessed = false;
    const wrongOrdinal = [{ ordinal: 1, get tableIdText() { bodyAccessed = true; throw new Error("body must remain deferred"); } }];
    const ordinalFailure = await runEffect(Effect.result(decodeCapturedAppIndexSnapshotPageEffect(input, wrongOrdinal)));
    expect(Result.isFailure(ordinalFailure)).toBe(true);
    if (Result.isFailure(ordinalFailure)) expect(ordinalFailure.failure)
      .toMatchObject({ _tag: "AppIndexEntryStorageCorruptionError", reason: "snapshot membership ordinal differs" });
    expect(bodyAccessed).toBe(false);
    const rows: unknown[] = [{ ordinal: 0, tableIdText: "0", keyCodecVersionText: "1", physicalSpecSha256: new Uint8Array(32),
      encodedKeyBytes: new Uint8Array(), keySha256: new Uint8Array(32), rowIdBytes: appRowIdHexV1ToBytes(ids[0]!),
      commitSeqText: "1", isTombstone: false }];
    Object.defineProperty(rows, 1, { get() { laterAccessed = true; throw new Error("later membership must remain deferred"); } });
    const corruption = await runEffect(Effect.result(decodeCapturedAppIndexSnapshotPageEffect(input, rows)));
    expect(Result.isFailure(corruption)).toBe(true);
    if (Result.isFailure(corruption)) expect(corruption.failure).toMatchObject({ _tag: "AppIndexEntryStorageCorruptionError" });
    expect(laterAccessed).toBe(false);
  });

  it.each(["ordinal", "tableIdText", "rowIdBytes"] as const)(
    "preserves the original index %s getter defect before later array access", async field => {
    const input: PreparedAppIndexSnapshotRead = { scopeId, scopeUuid: ScopeUuidV1Schema.make(scopeUuid),
      indexDefinitionId: decodeCatalogIndexDefinitionId(1), physicalSpec: APP_BY_ID_PHYSICAL_SPEC_V1,
      physicalSpecSha256: new Uint8Array(32), bounds: {}, limit: 2, snapshotCommitSeq: CommitSeqSchema.make(1n) };
    const defect = new Error(`original index ${field} getter defect`);
    const first = { ordinal: 0, tableIdText: "1", keyCodecVersionText: "1", physicalSpecSha256: new Uint8Array(32),
      encodedKeyBytes: new Uint8Array(), keySha256: new Uint8Array(32), rowIdBytes: appRowIdHexV1ToBytes(ids[0]!),
      commitSeqText: "1", isTombstone: false };
    Object.defineProperty(first, field, { get() { throw defect; } });
    let laterAccessed = false;
    const rows: unknown[] = [first];
    Object.defineProperty(rows, 1, { get() { laterAccessed = true; throw new Error("later index must remain deferred"); } });
    const exit = await runEffect(Effect.exit(decodeCapturedAppIndexSnapshotPageEffect(input, rows)));
    if (!Exit.isFailure(exit)) throw new Error("Expected original index getter defect");
    expect(exit.cause.reasons.filter(Cause.isDieReason).map(reason => reason.defect)).toEqual([defect]);
    expect(Cause.hasFails(exit.cause)).toBe(false);
    expect(laterAccessed).toBe(false);
  });

  it("rejects oversized ownership groups before touching withheld metadata bodies", async () => {
    let touched = false;
    const rows = Array.from({ length: 65 }, (_, ordinal) => ({ kind: "ownership", ordinal, scopeId,
      sequenceText: String(ordinal + 1), previousSequenceText: null, revisionId: null,
      evidenceLength: 1, bodyWithheld: true,
      get evidenceBytes() { touched = true; throw new Error("withheld body must remain deferred"); },
    }));
    const refusal = await runEffect(Effect.result(decodeCapturedApplicationWriteOwnershipEffect(scopeId, rows,
      new ApplicationWriteOwnershipHistoryBudget())));
    expect(Result.isFailure(refusal)).toBe(true);
    if (Result.isFailure(refusal)) expect(refusal.failure.reason).toBe("historyLimit");
    expect(touched).toBe(false);
  });

  it("charges demanded successor manifests and catalog closure before any withheld body", async () => {
    let touched = false;
    const budget = new ApplicationWriteOwnershipHistoryBudget();
    const charge = budget.consume(64, 0);
    expect(Result.isSuccess(charge)).toBe(true);
    if (Result.isSuccess(charge)) expect(charge.success).toBeUndefined();
    const manifest = [{ evidenceLength: 1, get bytes() { touched = true; throw new Error("manifest must remain deferred"); } }];
    const manifestRefusal = await runEffect(Effect.result(decodeCapturedApplicationOwnershipPolicyManifest(manifest, budget)));
    expect(Result.isFailure(manifestRefusal)).toBe(true);
    if (Result.isFailure(manifestRefusal)) expect(manifestRefusal.failure.reason).toBe("historyLimit");
    const definitions = [{ kind: "definition", ordinal: 0, evidenceLength: 1,
      get physicalSpecBytes() { touched = true; throw new Error("catalog must remain deferred"); } }];
    const closureRefusal = await runEffect(Effect.result(decodeCapturedOwnershipUniqueClosure("deployment_test", decodeCatalogSchemaVersionId("schema_test"),
      definitions, budget)));
    expect(Result.isFailure(closureRefusal)).toBe(true);
    if (Result.isFailure(closureRefusal)) expect(closureRefusal.failure.reason).toBe("historyLimit");
    expect(touched).toBe(false);
  });
});
