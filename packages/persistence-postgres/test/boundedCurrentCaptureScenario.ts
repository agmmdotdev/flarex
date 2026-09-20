import { and, eq, sql } from "drizzle-orm";
import { expect } from "vitest";
import { Effect } from "effect";
import {
  canonicalizeAppDocumentV1,
  decodeAppCreationTimeV1,
} from "flarex-protocol/app-document";
import {
  appRowIdHexV1ToBytes,
  decodeAppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
  FlarexDbV1StorageGenerationSchema,
  projectScopeIdUuidV1,
} from "flarex-protocol/storage-authority";
import { CanonicalFlarexValueBytesV1Schema } from "flarex-protocol/value";
import type { FlarexMetadataDatabase } from "../src/deployments";
import {
  appendPreparedAppRowRevisionsInTransactionEffect,
  readBoundedCurrentAppRowsInTransactionEffect,
} from "../src/appRows";
import {
  fxAppRowCurrent,
  fxAppRowRevisions,
  fxSystemScopeClocks,
} from "../src/schema";
import { lockScopeClockForUpdateInTransactionEffect } from "../src/scopeClock";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

/** Shared semantic cases; PostgreSQL additionally observes the driver's received bytes. */
export async function verifyBoundedCurrentCapture(
  db: FlarexMetadataDatabase,
  observe?: (
    kind: "accepted" | "rejected",
    run: () => Promise<void>,
  ) => Promise<void>,
) {
  const scopeId = ScopeIdSchema.make(
    "scope_50195000-0000-0000-0000-000000000001",
  );
  const otherScopeId = ScopeIdSchema.make(
    "scope_50195000-0000-0000-0000-000000000003",
  );
  const { scopeUuid } = projectScopeIdUuidV1(scopeId);
  const writeEpoch = ScopeEpochSchema.make(
    "epoch_50195000-0000-0000-0000-000000000002",
  );
  const tableId = decodeCatalogTableId(1);
  const rowIds = [1, 2, 3].map((id) =>
    decodeAppRowIdHexV1(id.toString(16).padStart(32, "0")),
  );
  const [firstId, secondId, tombstoneId] = rowIds;
  if (
    firstId === undefined ||
    secondId === undefined ||
    tombstoneId === undefined
  )
    throw new Error("Missing capture fixture identities");
  const creationTime = decodeAppCreationTimeV1(42);
  const schemaVersionId = decodeCatalogSchemaVersionId(
    "bounded_current_capture",
  );
  const snapshotCommitSeq = CommitSeqSchema.make(2n);
  await db.insert(fxSystemScopeClocks).values(
    [scopeId, otherScopeId].map((id) => ({
      scopeId: id,
      storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
      epoch: writeEpoch,
      lastCommitSeq: snapshotCommitSeq,
    })),
  );
  const documents = await Promise.all(
    rowIds.map((rowId, index) =>
      canonicalizeAppDocumentV1({
        tableId,
        rowId,
        creationTime,
        fields: { title: index === 0 ? "x".repeat(80_000) : `row-${index}` },
      }),
    ),
  );
  const firstDocument = documents[0];
  const secondDocument = documents[1];
  if (firstDocument === undefined || secondDocument === undefined)
    throw new Error("Missing capture fixture documents");
  const firstRow = {
    kind: "live" as const,
    scopeId,
    writeEpoch,
    tableId,
    rowId: firstId,
    creationTime,
    schemaVersionId,
    commitSeq: CommitSeqSchema.make(1n),
    prevCommitSeq: null,
    document: firstDocument,
  };
  await db.transaction(async (tx) => {
    await runEffect(
      appendPreparedAppRowRevisionsInTransactionEffect(
        tx,
        rowIds.map((rowId, index) => {
          const document = documents[index];
          if (document === undefined)
            throw new Error("Missing capture fixture document");
          return { ...firstRow, rowId, document };
        }),
      ),
    );
    await runEffect(
      appendPreparedAppRowRevisionsInTransactionEffect(tx, [
        {
          ...firstRow,
          rowId: tombstoneId,
          kind: "tombstone",
          commitSeq: snapshotCommitSeq,
          prevCommitSeq: CommitSeqSchema.make(1n),
        },
      ]),
    );
    await runEffect(
      appendPreparedAppRowRevisionsInTransactionEffect(tx, [
        { ...firstRow, scopeId: otherScopeId },
      ]),
    );
    await runEffect(
      appendPreparedAppRowRevisionsInTransactionEffect(tx, [
        {
          ...firstRow,
          tableId: decodeCatalogTableId(2),
          document: await canonicalizeAppDocumentV1({
            tableId: decodeCatalogTableId(2),
            rowId: firstId,
            creationTime,
            fields: { title: "other table" },
          }),
        },
      ]),
    );
  });
  const bounds = {
    scopeId,
    tableId,
    minimumCommitSeq: snapshotCommitSeq,
    maximumIdentities: 3,
    maximumDocumentBytes: 1_048_576,
    maximumTotalValueBytes: 1_048_576,
  };
  await db.transaction(async (tx) => {
    await runEffect(lockScopeClockForUpdateInTransactionEffect(tx, scopeId));
    const captured: string[] = [];
    const read = (
      input: Partial<typeof bounds> & {
        rowId?: typeof firstId;
        rowIds?: readonly (typeof firstId)[];
      } = {},
    ) =>
      readBoundedCurrentAppRowsInTransactionEffect(
        tx,
        { ...bounds, ...input },
        (query) => captured.push(query.name),
      ).pipe(Effect.map(capture => capture.rows));
    for (const rowId of [undefined, firstId]) {
      captured.length = 0;
      const inspectAccepted = async () => {
        const result = await runEffect(read(rowId === undefined ? {} : { rowId }));
        expect(result.map((row) => [row.rowId, row.kind])).toEqual(
          rowId === undefined
            ? [
                [firstId, "live"],
                [secondId, "live"],
                [tombstoneId, "tombstone"],
              ]
            : [[firstId, "live"]],
        );
        expect(result[0]).toMatchObject({ document: firstDocument });
        expect(captured).toEqual(["currentCapture"]);
      };
      if (observe === undefined) await inspectAccepted();
      else await observe("accepted", inspectAccepted);
    }
    expect(
      await runEffect(
        read({
          rowId: firstId,
          maximumDocumentBytes: firstDocument.canonicalBytes.byteLength,
          maximumTotalValueBytes: firstDocument.canonicalBytes.byteLength,
        }),
      ),
    ).toHaveLength(1);
    expect(
      (await runEffect(read({ rowIds: [tombstoneId, firstId] }))).map(
        (row) => row.rowId,
      ),
    ).toEqual([firstId, tombstoneId]);
    expect(
      await runEffect(read({ rowId: decodeAppRowIdHexV1("ff".repeat(16)) })),
    ).toEqual([]);
    expect(
      await runEffect(
        read({
          rowId: decodeAppRowIdHexV1("ff".repeat(16)),
          maximumIdentities: 0,
          maximumTotalValueBytes: 0,
        }),
      ),
    ).toEqual([]);
    expect(await runEffect(read({ rowIds: [] }))).toEqual([]);
    expect(
      await runEffect(
        read({
          tableId: decodeCatalogTableId(99),
          maximumIdentities: 0,
          maximumTotalValueBytes: 0,
        }),
      ),
    ).toEqual([]);
    expect(
      await runEffect(read({ rowId: tombstoneId, maximumTotalValueBytes: 0 })),
    ).toMatchObject([{ kind: "tombstone" }]);
    await runEffect(
      lockScopeClockForUpdateInTransactionEffect(tx, otherScopeId),
    );
    expect(await runEffect(read({ scopeId: otherScopeId }))).toHaveLength(1);
    expect(
      await runEffect(read({ scopeId: otherScopeId, rowId: firstId })),
    ).toHaveLength(1);
    expect(
      await runEffect(
        read({ tableId: decodeCatalogTableId(2), rowId: firstId }),
      ),
    ).toMatchObject([{ document: { value: { title: "other table" } } }]);
    expect(
      await runEffect(
        read({
          maximumTotalValueBytes:
            firstDocument.canonicalBytes.byteLength +
            secondDocument.canonicalBytes.byteLength,
        }),
      ),
    ).toHaveLength(3);
    for (const limit of [
      { maximumIdentities: 2 },
      { maximumIdentities: 0 },
      { rowId: firstId, maximumIdentities: 0 },
      { rowId: tombstoneId, maximumIdentities: 0 },
      {
        rowId: firstId,
        maximumDocumentBytes: firstDocument.canonicalBytes.byteLength - 1,
      },
      {
        rowId: firstId,
        maximumTotalValueBytes: firstDocument.canonicalBytes.byteLength - 1,
      },
      { maximumDocumentBytes: firstDocument.canonicalBytes.byteLength - 1 },
      {
        maximumTotalValueBytes:
          firstDocument.canonicalBytes.byteLength +
          secondDocument.canonicalBytes.byteLength -
          1,
      },
    ]) {
      const reject = async () => {
        expect(await runEffectFailure(read(limit))).toMatchObject({
          issue: { reason: "rowLimitExceeded" },
        });
      };
      if (observe === undefined) await reject();
      else await observe("rejected", reject);
    }
    expect(
      await runEffectFailure(read({ rowIds: [firstId, firstId] })),
    ).toMatchObject({ issue: { reason: "rowLimitExceeded" } });
    captured.length = 0;
    expect(
      await runEffectFailure(
        read({ minimumCommitSeq: CommitSeqSchema.make(3n) }),
      ),
    ).toMatchObject({ issue: { reason: "invalidSnapshotCommitSeq" } });
    expect(captured).toHaveLength(1);
  });
  const rollback = new Error("Rollback capture corruption probe");
  for (const corruption of ["dangling", "future", "canonical"] as const) {
    await expect(
      db.transaction(async (tx) => {
        await runEffect(
          lockScopeClockForUpdateInTransactionEffect(tx, scopeId),
        );
        if (corruption === "dangling") {
          // Disposable, transaction-local constraint removal permits a corruption witness.
          await tx.execute(
            sql`alter table fx_app_row_current drop constraint fx_app_row_current_revision_fk`,
          );
          await tx
            .update(fxAppRowCurrent)
            .set({ commitSeq: CommitSeqSchema.make(3n) })
            .where(
              and(
                eq(fxAppRowCurrent.scopeUuid, scopeUuid),
                eq(fxAppRowCurrent.tableId, tableId),
                eq(fxAppRowCurrent.rowId, appRowIdHexV1ToBytes(firstId)),
              ),
            );
        } else if (corruption === "future") {
          await runEffect(
            appendPreparedAppRowRevisionsInTransactionEffect(tx, [
              {
                ...firstRow,
                commitSeq: CommitSeqSchema.make(3n),
                prevCommitSeq: CommitSeqSchema.make(1n),
              },
            ]),
          );
        } else {
          await tx
            .update(fxAppRowRevisions)
            .set({
              valueBytes: CanonicalFlarexValueBytesV1Schema.make(
                new Uint8Array([1]),
              ),
            })
            .where(
              and(
                eq(fxAppRowRevisions.scopeUuid, scopeUuid),
                eq(fxAppRowRevisions.tableId, tableId),
                eq(fxAppRowRevisions.rowId, appRowIdHexV1ToBytes(firstId)),
                eq(fxAppRowRevisions.isTombstone, false),
              ),
            );
        }
        expect(
          await runEffectFailure(
            readBoundedCurrentAppRowsInTransactionEffect(tx, bounds),
          ),
        ).toMatchObject({ _tag: "AppRowStorageCorruptionError" });
        expect(
          await runEffectFailure(
            readBoundedCurrentAppRowsInTransactionEffect(tx, {
              ...bounds,
              rowId: firstId,
            }),
          ),
        ).toMatchObject({ _tag: "AppRowStorageCorruptionError" });
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  }
}
