import { lockInstallationForCurrentTransaction, closeInstallationAdmission } from "../src/installationLifecycle";
import { describe, expect, it } from "vitest";
import { insertCurrentScopeClockFixture } from "./scopeClockFixture";
import {
  canonicalizeAppDocumentV1,
  decodeAppCreationTimeV1,
} from "flarex-protocol/app-document";
import { decodeAppRowIdHexV1 } from "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
} from "flarex-protocol/storage-authority";
import {
  appendPreparedAppRowRevisionsInTransactionEffect,
  type AppendPreparedAppRowRevisionV1Input,
} from "../src/appRows";
import { runEffect } from "./effectTestRuntime";
import { withPostgresExecutionObservation } from "./postgresExecutionObservation";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";
import { verifyAppRowBatches, verifyAppRowBatchBindings } from "./appRowBatchScenario";

const describePostgres = postgresUrl === null ? describe.skip : describe;
describePostgres("ordinary-role PostgreSQL prepared row batches", () => {
  it("preserves exact identities, predecessors and complete rollback", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      await verifyAppRowBatches(persistence, persistence.drizzle, async run => {
        const measured = await withPostgresExecutionObservation(persistence.pool, run, { returnedCommands: true });
        expect(measured.observation.checkouts).toBe(1);
        expect(measured.observation.releases).toBe(1);
        expect(measured.observation.returnedCommands.filter(command => command.submittedCommand === "begin" || command.submittedCommand === "commit"))
          .toEqual([{ checkout: 1, submittedCommand: "begin", returnedCommand: "BEGIN" },
            { checkout: 1, submittedCommand: "commit", returnedCommand: "ROLLBACK" }]);
      }, async run => {
        const measured = await withPostgresExecutionObservation(persistence.pool, run);
        expect(measured.observation.checkouts).toBe(1);
        expect(measured.observation.releases).toBe(1);
        expect(measured.observation.familyQueries.fx_apply_app_row_batch ?? 0).toBe(0);
      });
      await verifyAppRowBatchBindings(persistence, persistence.drizzle);
    });
  }, 120_000);
  it("splits row writes by encoded bytes before the row-count limit", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const scopeId = ScopeIdSchema.make(
        "scope_50191000-0000-0000-0000-000000000001",
      );
      const writeEpoch = ScopeEpochSchema.make(
        "epoch_50191000-0000-0000-0000-000000000002",
      );
      await insertCurrentScopeClockFixture(persistence.drizzle, { scopeId, epoch: writeEpoch });
      const tableId = decodeCatalogTableId(1);
      const creationTime = decodeAppCreationTimeV1(42);
      const rows: AppendPreparedAppRowRevisionV1Input[] = [];
      for (let i = 0; i < 3; i += 1) {
        const rowId = decodeAppRowIdHexV1(i.toString(16).padStart(32, "0"));
        rows.push({
          kind: "live",
          scopeId,
          writeEpoch,
          tableId,
          rowId,
          creationTime,
          commitSeq: CommitSeqSchema.make(1n),
          prevCommitSeq: null,
          schemaVersionId: decodeCatalogSchemaVersionId("ce1_bytes"),
          document: await canonicalizeAppDocumentV1({
            tableId,
            rowId,
            creationTime,
            fields: { body: "x".repeat(200_000) },
          }),
        });
      }
      const measured = await withPostgresExecutionObservation(
        persistence.pool,
        () =>
          persistence.drizzle.transaction(async (tx) => {
        await runEffect(lockInstallationForCurrentTransaction(tx));
        try {
return await runEffect(
              appendPreparedAppRowRevisionsInTransactionEffect(tx, rows),
            );
        } finally { closeInstallationAdmission(tx); }
      },
          ),
      );
      expect(measured.value).toHaveLength(3);
      expect(measured.observation.familyQueries.fx_apply_app_row_batch).toBe(3);
      expect(measured.observation.commands.begin).toBe(1);
      expect(measured.observation.commands.commit).toBe(1);
    });
  }, 120_000);
});
