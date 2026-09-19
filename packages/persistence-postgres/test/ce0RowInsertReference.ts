import type { PoolClient } from "pg";
import { appRowIdHexV1ToBytes } from "flarex-protocol/app-document-id";
import {
  projectScopeIdUuidV1,
  projectScopeEpochUuidV1,
} from "flarex-protocol/storage-authority";
import { FLAREX_VALUE_CODEC_VERSION_V1 } from "flarex-protocol/value";
import {
  AppRowRevisionAlreadyExistsError,
  AppRowScopeAuthorityUnavailableError,
  type AppendPreparedLiveAppRowRevisionV1Input,
  type LiveAppRowRevisionV1,
} from "../src/appRows";

/** Deliberately narrow, test-only row-store reference. Callers supply canonical
 * factory-produced documents and valid typed scalar identities. Only first live
 * revisions are supported. Admission, earlier-read OCC, derived indexes and
 * publication are outside BOTH compared boundaries. This is not a request or
 * materializer replacement. The existing physical runner owns settlement. */
export async function insertCe0ReferenceRow(
  client: PoolClient,
  input: AppendPreparedLiveAppRowRevisionV1Input & {
    readonly prevCommitSeq: null;
  },
): Promise<LiveAppRowRevisionV1> {
  if (
    input.kind !== "live" ||
    input.prevCommitSeq !== null ||
    input.commitSeq < 1n
  ) {
    throw new Error("Unsupported CE0 row-insert reference input.");
  }
  const scope = projectScopeIdUuidV1(input.scopeId);
  const epoch = projectScopeEpochUuidV1(input.writeEpoch);
  const identity = {
    scopeId: input.scopeId,
    tableId: input.tableId,
    rowId: input.rowId,
  };
  const found = await client.query(
    "select scope_uuid from fx_system_scope_clock where scope_id = $1 and scope_uuid = $2::uuid limit 1",
    [input.scopeId, scope.scopeUuid],
  );
  if (found.rows.length !== 1)
    throw new AppRowScopeAuthorityUnavailableError(input.scopeId);
  const rowId = appRowIdHexV1ToBytes(input.rowId);
  const inserted = await client.query(
    `insert into fx_app_row_rev
      (scope_uuid, table_id, row_id, commit_seq, prev_commit_seq, write_epoch_uuid,
       schema_version_id, creation_time, value_codec_version, is_tombstone, value_bytes, value_sha256)
     values ($1, $2, $3, $4, null, $5, $6, $7, $8, false, $9, $10)
     on conflict do nothing returning commit_seq`,
    [
      scope.scopeUuid,
      input.tableId,
      rowId,
      input.commitSeq,
      epoch.epochUuid,
      input.schemaVersionId,
      input.creationTime,
      FLAREX_VALUE_CODEC_VERSION_V1,
      Buffer.from(input.document.canonicalBytes),
      Buffer.from(input.document.sha256),
    ],
  );
  if (inserted.rows.length !== 1)
    throw new AppRowRevisionAlreadyExistsError(identity, input.commitSeq);
  const advanced = await client.query(
    `insert into fx_app_row_current (scope_uuid, table_id, row_id, commit_seq)
     values ($1, $2, $3, $4) on conflict do nothing returning commit_seq`,
    [scope.scopeUuid, input.tableId, rowId, input.commitSeq],
  );
  // In the admitted first-revision profile, the unique-first-revision index and
  // pointer FK prevent an independent existing pointer. Still fail closed and
  // let the enclosing transaction roll back if that invariant is ever broken.
  if (advanced.rows.length !== 1)
    throw new Error(
      "CE0 first-revision pointer invariant violated; comparison is unsupported.",
    );
  return Object.freeze({
    kind: "live",
    ...identity,
    scopeUuid: scope.scopeUuid,
    writeEpochUuid: epoch.epochUuid,
    commitSeq: input.commitSeq,
    prevCommitSeq: null,
    schemaVersionId: input.schemaVersionId,
    creationTime: input.creationTime,
    document: input.document,
  });
}
