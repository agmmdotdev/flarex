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
  createPGliteLocatedApplicationRevisionRegistrationTargetV1,
  createPGliteLocatedPointMutationSessionActivationTargetV1,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import {
  fxSystemCommitAppRowChanges,
  fxSystemCommits,
  fxSystemScopeClocks,
} from "../src/schema";
import {
  type C07SeedLiveRowV1,
} from "./c07PrivatePointMutationHarness";
import {
  type Fsv03PrivateAnalyzerToPostgresLaneV1,
  proveFsv03PrivateAnalyzerToPostgresSystemV1,
} from "./fsv03PrivateAnalyzerToPostgresHarness";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";

const physicalLocator = Object.freeze({
  kind: "shared_database",
  databaseKey: "fsv03-private",
  schemaName: "public",
} as const);

describe("FSV03 private analyzer-to-Postgres system - PGlite", () => {
  it("crosses real analysis, inactive registration, C07 mutation, and durable reload", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const proof = await proveFsv03PrivateAnalyzerToPostgresSystemV1(
      pgliteLane(persistence),
    );
    expect(proof).toMatchObject({
      lane: "pglite",
      analysisKind: "registration_page",
      registrationKind: "registered",
      replayKind: "replayed",
      durableAnalyzerEvidenceReloads: ["parse_module", "link_page"],
      revisionStatus: "inactive",
      forgedSelectionRejected: true,
      mutationResultKind: "published",
      mutationCommitSeq: "2",
      mutationCount: 1,
      mutationCommitSeqs: ["2"],
      mutationValue: { ok: true },
      coldOutcomeCommitSeq: "2",
      durable: {
        currentValue: { status: "complete" },
        commitSeqs: ["1", "2"],
        changeCommitSeqs: ["1", "2"],
        outcomeCommitSeqs: ["2"],
        outboxCommitSeqs: ["2"],
        completedRowCount: 1,
      },
    });
  }, 180_000);

  it("rejects canonical function bytes that do not match the registered digest", async () => {
    const persistence = await createMigratedPGlitePersistence();
    await expect(proveFsv03PrivateAnalyzerToPostgresSystemV1(
      pgliteLane(persistence, "functionMetadataDigestMismatch"),
    )).rejects.toThrow("FSV03 durable function metadata failed closed.");
  }, 180_000);
});

function pgliteLane(
  persistence: PGliteFlarexPersistence,
  selectionFault?:
    Fsv03PrivateAnalyzerToPostgresLaneV1["selectionFault"],
): Fsv03PrivateAnalyzerToPostgresLaneV1 {
  return {
    name: "pglite",
    persistence,
    ...(selectionFault === undefined ? {} : { selectionFault }),
    registrationTarget:
      createPGliteLocatedApplicationRevisionRegistrationTargetV1(
        persistence,
        physicalLocator,
      ),
    c07: {
      name: "pglite",
      persistence,
      controlDb: persistence.drizzle,
      ensureScope: async () => {
        throw new Error("FSV03 reuses the registered scope.");
      },
      locateTarget: () =>
        createPGliteLocatedPointMutationSessionActivationTargetV1(
          persistence,
          physicalLocator,
        ),
      seedBaselineLiveRow: input =>
        seedBaselineLiveRow(persistence, input),
    },
  };
}

async function seedBaselineLiveRow(
  persistence: PGliteFlarexPersistence,
  input: C07SeedLiveRowV1,
): Promise<void> {
  const clock = await persistence.getScopeClock(input.scopeId);
  if (clock === null) throw new Error("FSV03 PGlite scope clock is missing.");
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
