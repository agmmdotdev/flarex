import { expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { createPGlitePersistence } from "../src/pglite";
import { verifyAppRowBatches } from "./appRowBatchScenario";
import {
  appendPreparedAppRowRevisionsInTransactionEffect,
  AppRowStorageCorruptionError,
  type AppRowTransaction,
} from "../src/appRows";
import { decodeAppCreationTimeV1 } from "flarex-protocol/app-document";
import { decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
} from "flarex-protocol/storage-authority";
import { runEffectFailure } from "./effectTestRuntime";

it("applies bounded prepared row batches with exact identities and atomic rollback", async () => {
  const db = new PGlite();
  const persistence = await createPGlitePersistence({ db });
  try {
    await persistence.migrate();
    await verifyAppRowBatches(persistence, persistence.drizzle);
  } finally {
    await db.close();
  }
}, 120_000);

it("classifies malformed stored batch columns as corruption before writes", async () => {
  const scopeUuid = "50192000-0000-0000-0000-000000000001";
  const input = {
    kind: "tombstone",
    scopeId: ScopeIdSchema.make(`scope_${scopeUuid}`),
    writeEpoch: ScopeEpochSchema.make(
      "epoch_50192000-0000-0000-0000-000000000002",
    ),
    tableId: decodeCatalogTableId(1),
    rowId: decodeAppRowIdHexV1("00".repeat(16)),
    creationTime: decodeAppCreationTimeV1(42),
    schemaVersionId: decodeCatalogSchemaVersionId("ce1_decode"),
    commitSeq: CommitSeqSchema.make(2n),
    prevCommitSeq: CommitSeqSchema.make(1n),
  } as const;
  const valid = {
    scopeUuid,
    tableId: 1,
    rowId: new Uint8Array(16),
    commitSeq: 1n,
    creationTime: 42,
  };
  const cases = [
    [{ ...valid, scopeUuid: "invalid" }],
    [{ ...valid, tableId: 0 }],
    [{ ...valid, rowId: new Uint8Array(2) }],
    [{ ...valid, commitSeq: 0n }],
    [{ ...valid, creationTime: Infinity }],
    [],
  ];
  for (const predecessors of cases) {
    let selects = 0;
    // Deliberately malformed driver rows; there is no insert capability to hide
    // accidental writes before the corruption verdict.
    const tx = {
      select() {
        const rows =
          selects++ === 0
            ? [{ scopeUuid }]
            : selects === 2
              ? predecessors
              : [{ commitSeq: 0n }];
        return {
          from() {
            return {
              where() {
                return Object.assign(Promise.resolve(rows), {
                  limit: () => Promise.resolve(rows),
                });
              },
            };
          },
        };
      },
    } as unknown as AppRowTransaction;
    expect(
      await runEffectFailure(
        appendPreparedAppRowRevisionsInTransactionEffect(tx, [input]),
      ),
    ).toBeInstanceOf(AppRowStorageCorruptionError);
  }
});
