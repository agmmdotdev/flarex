import type { PoolClient } from "pg";
import { Schema } from "effect";
import { appRowIdHexV1ToBytes } from "flarex-protocol/app-document-id";
import { projectScopeIdUuidV1, projectScopeEpochUuidV1 } from "flarex-protocol/storage-authority";
import { FLAREX_VALUE_CODEC_VERSION_V1 } from "flarex-protocol/value";
import {
  AppRowRevisionAlreadyExistsError, AppRowScopeAuthorityUnavailableError, InvalidAppRowBatchInputError,
  type AppendPreparedLiveAppRowRevisionV1Input, type LiveAppRowRevisionV1,
} from "../../src/storage/documents/appRows";

// Independent comparison policy, checked against actual core statement scaling.
const ROWS_PER_BATCH = 32;
const TARGET_DOCUMENT_BYTES = 256 * 1024;
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;
type Insert = AppendPreparedLiveAppRowRevisionV1Input & { readonly prevCommitSeq: null };
const decodeWritten = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({
  scope_uuid: Schema.String, table_id: Schema.Int, row_id: Schema.String, commit_seq: Schema.String,
})));
const returning = "returning scope_uuid::text, table_id, encode(row_id, 'hex') as row_id, commit_seq::text";

/** Node/PostgreSQL reference boundary, borrowing the physical runner's client.
 * Only factory-produced canonical first revisions with valid scalar identities
 * are admitted. No authority/OCC/index/publication or recovery engine is supplied.
 * The caller must roll back on ANY rejection; this function never settles. */
export async function insertCe0ReferenceRows(client: PoolClient, inputs: readonly Insert[]): Promise<readonly LiveAppRowRevisionV1[]> {
  const first = inputs[0];
  if (first === undefined) return [];
  const scope = projectScopeIdUuidV1(first.scopeId);
  const epoch = projectScopeEpochUuidV1(first.writeEpoch);
  const found = await client.query(
    "select scope_uuid from fx_system_scope_clock where scope_id = $1 and scope_uuid = $2::uuid limit 1",
    [first.scopeId, scope.scopeUuid],
  );
  if (found.rows.length !== 1) throw new AppRowScopeAuthorityUnavailableError(first.scopeId);
  const identities = new Set<string>();
  for (const input of inputs) {
    if (input.kind !== "live" || input.prevCommitSeq !== null || input.commitSeq < 1n)
      throw new Error("Unsupported CE0 first-row reference input");
    if (input.scopeId !== first.scopeId || input.writeEpoch !== first.writeEpoch || input.commitSeq !== first.commitSeq)
      throw new InvalidAppRowBatchInputError("mixedPublication");
    const key = identity(input);
    if (identities.has(key)) throw new InvalidAppRowBatchInputError("duplicateIdentity");
    identities.add(key);
    if (input.document.canonicalBytes.byteLength > MAX_DOCUMENT_BYTES)
      throw new InvalidAppRowBatchInputError("documentBytesExceeded");
  }
  let offset = 0;
  while (offset < inputs.length) {
    const batch: Insert[] = [];
    let bytes = 0;
    while (offset < inputs.length && batch.length < ROWS_PER_BATCH) {
      const input = inputs[offset];
      if (input === undefined) throw new Error("Missing CE0 batch input");
      const size = input.document.canonicalBytes.byteLength;
      if (batch.length !== 0 && bytes + size > TARGET_DOCUMENT_BYTES) break;
      batch.push(input); bytes += size; offset++;
    }
    const parameters: unknown[] = [];
    const values = batch.map(input => {
      const start = parameters.length;
      parameters.push(scope.scopeUuid, input.tableId, appRowIdHexV1ToBytes(input.rowId), input.commitSeq,
        epoch.epochUuid, input.schemaVersionId, input.creationTime, FLAREX_VALUE_CODEC_VERSION_V1,
        Buffer.from(input.document.canonicalBytes), Buffer.from(input.document.sha256));
      const p = (n: number) => '$' + (start + n);
      return '(' + [p(1), p(2), p(3), p(4), 'null', p(5), p(6), p(7), p(8), 'false', p(9), p(10)].join(',') + ')';
    });
    const inserted = await client.query(
      "insert into fx_app_row_rev (scope_uuid, table_id, row_id, commit_seq, prev_commit_seq, write_epoch_uuid, schema_version_id, creation_time, value_codec_version, is_tombstone, value_bytes, value_sha256) values " + values.join(',') + " on conflict do nothing " + returning,
      parameters,
    );
    requireWritten(batch, scope.scopeUuid, inserted.rows, "revision");
    const pointers: unknown[] = [];
    const pointerValues = batch.map(input => {
      const start = pointers.length;
      pointers.push(scope.scopeUuid, input.tableId, appRowIdHexV1ToBytes(input.rowId), input.commitSeq);
      return '(' + [1, 2, 3, 4].map(n => '$' + (start + n)).join(',') + ')';
    });
    const advanced = await client.query(
      "insert into fx_app_row_current (scope_uuid, table_id, row_id, commit_seq) values " + pointerValues.join(',') + " on conflict do nothing " + returning,
      pointers,
    );
    requireWritten(batch, scope.scopeUuid, advanced.rows, "pointer");
  }
  return inputs.map(input => Object.freeze({ kind: "live", scopeId: input.scopeId,
    tableId: input.tableId, rowId: input.rowId, commitSeq: input.commitSeq, prevCommitSeq: null,
    schemaVersionId: input.schemaVersionId, creationTime: input.creationTime, document: input.document,
    scopeUuid: scope.scopeUuid, writeEpochUuid: epoch.epochUuid }));
}

function identity(input: Pick<Insert, "tableId" | "rowId" | "commitSeq">): string {
  return input.tableId + '/' + input.rowId + '/' + input.commitSeq;
}

function requireWritten(batch: readonly Insert[], scopeUuid: string, raw: unknown, phase: "revision" | "pointer"): void {
  const expected = new Map(batch.map(input => [identity(input), input]));
  for (const row of decodeWritten(raw)) {
    const key = row.table_id + '/' + row.row_id + '/' + row.commit_seq;
    if (row.scope_uuid !== scopeUuid || !expected.delete(key))
      throw new Error("Unexpected or duplicate CE0 " + phase + " RETURNING identity");
  }
  const missing = expected.values().next().value;
  if (missing === undefined) return;
  if (phase === "revision") throw new AppRowRevisionAlreadyExistsError(missing, missing.commitSeq);
  throw new Error("Incomplete CE0 pointer writes; transaction must roll back");
}
