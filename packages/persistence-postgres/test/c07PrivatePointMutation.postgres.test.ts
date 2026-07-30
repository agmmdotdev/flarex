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
  createPostgresLocatedPointMutationSessionActivationTargetV1,
  createPostgresSharedScopeAuthorityProvisioner,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import {
  fxSystemCommitAppRowChanges,
  fxSystemCommits,
  fxSystemScopeClocks,
} from "../src/schema";
import {
  proveC07PrivatePointMutationCorrectnessV1,
  type C07SeedLiveRowV1,
} from "./c07PrivatePointMutationHarness";
import {
  postgresUrl,
  withTemporaryPostgresPersistence,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const physicalLocator = Object.freeze({
  kind: "shared_database",
  databaseKey: "c07-private-postgres",
  schemaName: "public",
} as const);

describe("C07 PostgreSQL acceptance environment", () => {
  it("requires an authenticated real-PostgreSQL URL", () => {
    expect(
      postgresUrl,
      "Set FLAREX_POSTGRES_DATABASE_URL before accepting C07.",
    ).not.toBeNull();
  });
});

describePostgres("C07 private point-mutation correctness gate — PostgreSQL", () => {
  it("runs the same authenticated execution, OCC rerun, commit, and cold replay proof", async () => {
    await withTemporaryPostgresPersistence(async (persistence) => {
      const proof = await proveC07PrivatePointMutationCorrectnessV1({
        name: "postgres",
        persistence,
        ensureScope: async (deploymentId, projectId, randomUuid) => {
          const provisioned =
            await createPostgresSharedScopeAuthorityProvisioner(
              persistence,
              { physicalLocator, randomUuid },
            ).ensure({ deploymentId, projectId });
          return Object.freeze({
            scopeId: decodeReplacementScopeIdV1(
              provisioned.scope.scopeId,
            ),
          });
        },
        locateTarget: () =>
          createPostgresLocatedPointMutationSessionActivationTargetV1(
            persistence,
            physicalLocator,
          ),
        seedBaselineLiveRow: (input) =>
          seedBaselineLiveRow(persistence, input),
      });

      expect(proof).toMatchObject({
        lane: "postgres",
        clonedActivationFailure:
          "InvalidActivatedPointMutationSessionV1Error",
        firstResultKind: "published",
        firstCommitSeq: "3",
        competingResultKind: "published",
        competingCommitSeq: "2",
        runtimeExecutions: 2,
        competingRuntimeExecutions: 1,
        disposedRuntimeResponses: 3,
        consumedActivationFailure: "InvalidPointMutationExecutionClaimV1Error",
        coldOutcomeKind: "available",
        coldOutcomeCommitSeq: "3",
        coldOutcomeValue: { ok: true },
        durable: {
          sessionCount: "2",
          lifecycle: "committed",
          revisions: "3",
          currentRows: "1",
          currentCommitSeq: "3",
          currentValue: { name: "c07-postgres-2" },
          commitSeqs: ["1", "2", "3"],
          changeCommitSeqs: ["1", "2", "3"],
          outcomeCommitSeqs: ["2", "3"],
          outboxSeqs: ["1", "2"],
          outboxCommitSeqs: ["2", "3"],
          lastCommitSeq: "3",
          lastOutboxSeq: "2",
        },
      });
    });
  }, 120_000);
});

async function seedBaselineLiveRow(
  persistence: PostgresFlarexPersistence,
  input: C07SeedLiveRowV1,
): Promise<void> {
  const clock = await persistence.getScopeClock(input.scopeId);
  if (clock === null) throw new Error("C07 PostgreSQL scope clock is missing.");
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
      scopeId: input.scopeId,
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
