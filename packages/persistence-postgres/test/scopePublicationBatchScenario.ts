import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect } from "vitest";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import { appRowIdHexV1ToBytes, decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { CatalogTableIdSchema } from "flarex-protocol/catalog";
import { canonicalizeSuccessfulResultV1Effect } from "flarex-protocol/commit-protocol";
import { CatalogSchemaVersionIdSchema } from "flarex-protocol/schema-manifest";
import { FLAREX_VALUE_CODEC_VERSION_V1 } from "flarex-protocol/value";
import {
  CommitSeqSchema, ScopeEpochSchema, ScopeEpochUuidV1Schema,
  ScopeUuidV1Schema, FlarexDbV1StorageGenerationSchema, decodeReplacementScopeIdV1,
} from "flarex-protocol/storage-authority";
import { TransactionFunctionPathV1Schema, TransactionRequestKeyV1Schema } from "flarex-protocol/transaction-session";
import { writeScopePublicationPrefix, advanceScopePublicationClock } from "../src/commitPublication/publication";
import { ScopePublicationCorruptionError, type ScopePublicationContribution, type ScopePublicationKernel } from "../src/commitPublication/scopePublicationModel";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import { getScopeClock, lockScopeClockForUpdateInTransactionEffect } from "../src/scopeClock";
import { fxAppRowRevisions, fxSystemCommitAppRowChanges, fxSystemCommits, fxSystemIdempotency, fxSystemCommitWakes, fxSystemScopeClocks } from "../src/schema";
import { runEffect } from "./effectTestRuntime";

/** Tests the private SQL publication owner, independently of participant admission limits. */
export async function scopePublicationBatchScenario(persistence: PGliteFlarexPersistence | PostgresFlarexPersistence) {
  for (const count of [0, 1, 499, 500, 501, 1000, 1001]) {
    const scopeUuid = ScopeUuidV1Schema.make(randomUUID());
    const epochUuid = ScopeEpochUuidV1Schema.make(randomUUID());
    const scopeId = decodeReplacementScopeIdV1(`scope_${scopeUuid}`);
    await persistence.drizzle.insert(fxSystemScopeClocks).values({
      scopeId, epoch: ScopeEpochSchema.make(`epoch_${epochUuid}`),
      storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
    });
    const commitSeq = CommitSeqSchema.make(1n);
    const tableId = CatalogTableIdSchema.make(1);
    const rowIntents = Array.from({ length: count }, (_, index) => ({
      tableId, rowId: decodeAppRowIdHexV1((index + 1).toString(16).padStart(32, "0")),
    }));
    const result = await runEffect(canonicalizeSuccessfulResultV1Effect(null));
    const command = {
      authorityPins: { scopeId, requestKey: TransactionRequestKeyV1Schema.make(randomUUID()),
        functionPath: TransactionFunctionPathV1Schema.make("publication:batch") },
      rowIntents, successfulResult: { ...result, encoding: "application-value" }, resultSha256: Buffer.from(result.evidence.sha256Hex, "hex"),
      requestSha256: new Uint8Array(32), identityAccessPolicySha256: new Uint8Array(32),
    } satisfies ScopePublicationContribution;
    const readState = async () => ({
      rows: await persistence.drizzle.select().from(fxAppRowRevisions).where(eq(fxAppRowRevisions.scopeUuid, scopeUuid)),
      facts: await persistence.drizzle.select().from(fxSystemCommitAppRowChanges).where(eq(fxSystemCommitAppRowChanges.scopeUuid, scopeUuid)).orderBy(fxSystemCommitAppRowChanges.changeOrdinal),
      headers: await persistence.drizzle.select().from(fxSystemCommits).where(eq(fxSystemCommits.scopeUuid, scopeUuid)),
      outcomes: await persistence.drizzle.select().from(fxSystemIdempotency).where(eq(fxSystemIdempotency.scopeUuid, scopeUuid)),
      wakes: await persistence.drizzle.select().from(fxSystemCommitWakes).where(eq(fxSystemCommitWakes.scopeUuid, scopeUuid)),
      clock: await getScopeClock(persistence.drizzle, scopeId),
    });
    const publish = (failAtBatch?: number) => {
      const parameters: number[] = [];
      let steps = 0;
      const work = persistence.drizzle.transaction(async tx => {
        const record = await runEffect(lockScopeClockForUpdateInTransactionEffect(tx, scopeId));
        const kernel = {
          clock: { record, scopeUuid, epochUuid }, commitSeq,
          publicationTimeMilliseconds: Date.now(),
          relationAdjacencyChanges: [],
        } satisfies ScopePublicationKernel;
        // Pre-existing row owner output is a fixture input to this publication-only proof.
        if (rowIntents.length > 0) await tx.insert(fxAppRowRevisions).values(rowIntents.map(row => ({
          scopeUuid, tableId, rowId: appRowIdHexV1ToBytes(row.rowId), commitSeq,
          writeEpochUuid: epochUuid, schemaVersionId: CatalogSchemaVersionIdSchema.make("batch_fixture"),
          creationTime: AppCreationTimeV1Schema.make(1), valueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1, isTombstone: true,
        })));
        const options = {
          observeQuery: (query: { readonly name: string; readonly params: readonly unknown[] }) => {
            if (query.name === "writeCommitChange") parameters.push(query.params.length);
          },
          afterTransactionStep: async (event: { readonly step: string }) => {
            if (event.step === "commitChangeWritten" && ++steps === failAtBatch)
              throw new Error("Deliberate batch rollback");
          },
        };
        await writeScopePublicationPrefix(tx, command, kernel, options);
        await advanceScopePublicationClock(tx, command, kernel, options);
      });
      return { work, parameters, steps: () => steps };
    };
    const before = await readState();
    if (count === 1001) {
      for (const failAt of [1, 2, 3]) {
        const failed = publish(failAt);
        await expect(failed.work).rejects.toThrow("Deliberate batch rollback");
        expect(failed.steps()).toBe(failAt);
        expect(await readState()).toEqual(before);
      }
      // Valid SQL shapes with incomplete or out-of-batch RETURNING evidence must roll back.
      for (const body of ["return null;", "new.change_ordinal := new.change_ordinal + 10000; return new;"]) {
        await persistence.exec(`create function fx_test_batch_return() returns trigger language plpgsql as $$ begin ${body} end $$`);
        try {
          await persistence.exec("create trigger fx_test_batch_return before insert on fx_system_commit_app_row_change for each row execute function fx_test_batch_return()");
          await expect(publish().work).rejects.toBeInstanceOf(ScopePublicationCorruptionError);
          expect(await readState()).toEqual(before);
        } finally {
          await persistence.exec("drop trigger if exists fx_test_batch_return on fx_system_commit_app_row_change");
          await persistence.exec("drop function fx_test_batch_return()");
        }
      }
    }
    const published = publish();
    await published.work;
    expect(published.parameters).toEqual(Array.from({ length: Math.ceil(count / 500) },
      (_, index) => Math.min(500, count - index * 500) * 6));
    expect(published.steps()).toBe(Math.ceil(count / 500));
    const after = await readState();
    expect(after.facts.map(fact => ({
      tableId: fact.tableId, rowId: Buffer.from(fact.rowId).toString("hex"),
      commitSeq: fact.commitSeq, changeOrdinal: fact.changeOrdinal,
    }))).toEqual(rowIntents.map((row, changeOrdinal) => ({ ...row, commitSeq, changeOrdinal })));
    expect(after.headers).toHaveLength(1);
    expect(after.headers[0]?.changeCount).toBe(count);
    expect(after.outcomes).toHaveLength(1);
    expect(after.wakes).toHaveLength(1);
    expect(after.clock?.lastCommitSeq).toBe(1n);
  }
}
