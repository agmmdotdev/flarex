import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  decodeAppCreationTimeV1,
} from "flarex-protocol/app-document";
import {
  appRowIdHexV1ToBytes,
} from "flarex-protocol/app-document-id";
import {
  CommitSeqSchema,
  decodeReplacementScopeIdV1,
  projectScopeEpochUuidV1,
  projectScopeIdUuidV1,
} from "flarex-protocol/storage-authority";
import {
  canonicalizeFlarexValueV1,
} from "flarex-protocol/value";

import {
  appendAppRowRevisionAndAdvanceCurrentInTransaction,
} from "../src/appRows";
import {
  createPostgresLocatedApplicationRevisionRegistrationTargetV1,
  createPostgresLocatedPointMutationSessionActivationTargetV1,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import {
  fxSystemCommitAppRowChanges,
  fxSystemCommits,
  fxSystemScopeClocks,
} from "../src/schema";
import {
  type C07SeedLiveRowV1,
} from "./c07PrivatePointMutationHarness";
import {
  proveFsv03PrivateAnalyzerToPostgresSystemV1,
} from "./fsv03PrivateAnalyzerToPostgresHarness";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const physicalLocator = Object.freeze({
  kind: "shared_database",
  databaseKey: "fsv03-private",
  schemaName: "public",
} as const);

describe("FSV03 PostgreSQL acceptance environment", () => {
  it("requires an authenticated genuine PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting FSV03.",
    ).not.toBeNull();
  });
});

describePostgres("FSV03 private analyzer-to-Postgres system - PostgreSQL", () => {
  it("runs concurrent registered-revision mutations and bounded stress", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const proof = await proveFsv03PrivateAnalyzerToPostgresSystemV1({
        name: "postgres",
        persistence,
        mutationCount: 8,
        registrationTarget:
          createPostgresLocatedApplicationRevisionRegistrationTargetV1(
            persistence,
            physicalLocator,
          ),
        c07: {
          name: "postgres",
          persistence,
          ensureScope: async () => {
            throw new Error("FSV03 reuses the registered scope.");
          },
          locateTarget: () =>
            createPostgresLocatedPointMutationSessionActivationTargetV1(
              persistence,
              physicalLocator,
            ),
          seedBaselineLiveRow: input =>
            seedBaselineLiveRow(persistence, input),
        },
      });
      expect(proof).toMatchObject({
        lane: "postgres",
        analysisKind: "registration_page",
        registrationKind: "registered",
        replayKind: "replayed",
        durableAnalyzerEvidenceReloads: ["parse_module", "link_page"],
        revisionStatus: "inactive",
        forgedSelectionRejected: true,
        mutationResultKind: "published",
        mutationCount: 8,
        mutationCommitSeqs: [
          "9",
          "10",
          "11",
          "12",
          "13",
          "14",
          "15",
          "16",
        ],
        mutationValue: { ok: true },
        durable: {
          currentValue: { status: "complete" },
          commitSeqs: [
            "1",
            "2",
            "3",
            "4",
            "5",
            "6",
            "7",
            "8",
            "9",
            "10",
            "11",
            "12",
            "13",
            "14",
            "15",
            "16",
          ],
          changeCommitSeqs: [
            "1",
            "2",
            "3",
            "4",
            "5",
            "6",
            "7",
            "8",
            "9",
            "10",
            "11",
            "12",
            "13",
            "14",
            "15",
            "16",
          ],
          outcomeCommitSeqs: [
            "9",
            "10",
            "11",
            "12",
            "13",
            "14",
            "15",
            "16",
          ],
          outboxCommitSeqs: [
            "9",
            "10",
            "11",
            "12",
            "13",
            "14",
            "15",
            "16",
          ],
          completedRowCount: 8,
        },
      });
    });
  }, 180_000);
});

async function seedBaselineLiveRow(
  persistence: PostgresFlarexPersistence,
  input: C07SeedLiveRowV1,
): Promise<void> {
  const clock = await persistence.getScopeClock(input.scopeId);
  if (clock === null) {
    throw new Error("FSV03 PostgreSQL scope clock is missing.");
  }
  const scopeUuid = projectScopeIdUuidV1(input.scopeId).scopeUuid;
  const commitSeq = CommitSeqSchema.make(clock.lastCommitSeq + 1n);
  const epochUuid = projectScopeEpochUuidV1(clock.epoch).epochUuid;
  const document = await canonicalizeFlarexValueV1(
    input.value,
    "appDocument",
  );
  await persistence.drizzle.transaction(async (tx) => {
    await appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
      kind: "live",
      scopeId: decodeReplacementScopeIdV1(input.scopeId),
      tableId: input.tableId,
      rowId: input.rowId,
      writeEpoch: clock.epoch,
      commitSeq,
      prevCommitSeq: null,
      schemaVersionId: input.schemaVersionId,
      creationTime: decodeAppCreationTimeV1(input.creationTime),
      value: {
        codecVersion: document.codecVersion,
        valueJson: document.valueJson,
        canonicalBytes: document.canonicalBytes,
        sha256: document.sha256,
      },
    });
    await tx.insert(fxSystemCommits).values({
      scopeUuid,
      epochUuid,
      commitSeq,
      changeCount: 1,
    });
    await tx.insert(fxSystemCommitAppRowChanges).values({
      scopeUuid,
      epochUuid,
      commitSeq,
      changeOrdinal: 0,
      tableId: input.tableId,
      rowId: appRowIdHexV1ToBytes(input.rowId),
    });
    await tx
      .update(fxSystemScopeClocks)
      .set({ lastCommitSeq: commitSeq })
      .where(eq(fxSystemScopeClocks.scopeUuid, scopeUuid));
  });
}
