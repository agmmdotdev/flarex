import { eq, sql } from "drizzle-orm";
import { Cause, Effect, Exit, Fiber, Result } from "effect";
import type { PoolClient } from "pg";
import {
  canonicalizeAppDocumentV1,
  decodeAppCreationTimeV1,
} from "flarex-protocol/app-document";
import {
  appDocumentIdV1FromRowIdentity,
  appRowIdHexV1ToBytes,
  decodeAppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { decodeCatalogSchemaVersionId } from
  "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  projectScopeEpochUuidV1,
  projectScopeIdUuidV1,
} from "flarex-protocol/storage-authority";

import {
  activateApplicationRevisionV1,
  createLocatedApplicationRevisionActivationTargetV1,
  readActiveApplicationRevisionV1,
  type ApplicationRevisionActivationContextV1,
  type LocatedApplicationRevisionActivationTargetV1,
} from "@flarex/persistence-postgres/internal/system-test/applicationRevisionActivationV1";
import {
  ApplicationPointQuerySnapshotBudgetV1Error,
  ApplicationPointQuerySnapshotStaleV1Error,
  inspectApplicationPointQuerySnapshotV1,
  InvalidApplicationPointQuerySnapshotV1Error,
  openApplicationPointQuerySnapshotV1,
  readApplicationPointQueryDocumentV1,
  revalidateApplicationPointQuerySnapshotV1,
  type AuthenticatedApplicationPointQuerySnapshotV1,
  type ReadApplicationPointQueryDocumentV1Result,
} from "@flarex/persistence-postgres/internal/system-test/applicationPointQuerySnapshotV1";
import {
  appendAppRowRevisionAndAdvanceCurrentInTransaction,
  type AppRowTransaction,
} from "@flarex/persistence-postgres/internal/system-test/appRows";
import type { PGliteFlarexPersistence } from "@flarex/persistence-postgres/internal/system-test/pglite";
import type { PostgresFlarexPersistence } from "@flarex/persistence-postgres/internal/system-test/postgres";
import {
  fxSystemCommitAppRowChanges,
  fxSystemCommits,
  fxSystemScopeClocks,
} from "@flarex/persistence-postgres/internal/system-test/schema";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
} from "@flarex/persistence-postgres/internal/system-test/transactionSessionAttemptKernel";
import {
  FSV05_SUPPORTED_LOCATOR,
  prepareFsv05ReadyRevisionFixtureV1,
  type Fsv05ApplicationRevisionActivationLaneV1,
} from "./fsv05ApplicationRevisionActivationHarness";
import { makeMemoryRuntimeArtifactStoreV1 } from
  "./memoryRuntimeArtifactStoreV1";

type Persistence = PGliteFlarexPersistence | PostgresFlarexPersistence;

export interface PqvA1ApplicationPointQuerySnapshotLaneV1
  extends Fsv05ApplicationRevisionActivationLaneV1 {
  readonly persistence: Persistence;
}

export interface PqvA1ApplicationPointQuerySnapshotProofV1 {
  readonly lane: "pglite" | "postgres";
  readonly snapshotCommitSeq: bigint;
  readonly firstStatus: "pending";
  readonly repeatedStatus: "pending";
  readonly concurrentWriterPinnedStatus: "pending";
  readonly coldStatus: "complete";
  readonly missing: true;
  readonly unknownFunctionRejected: true;
  readonly invalidDeploymentRejected: true;
  readonly wrongTableRejected: true;
  readonly wrongDocumentTableRejected: true;
  readonly unsupportedTargetRejected: true;
  readonly cloneRejected: true;
  readonly closedRejected: true;
  readonly generationRejected: true;
  readonly fenceRejected: true;
  readonly epochRejected: true;
  readonly floorRejected: true;
  readonly supersededRejected: true;
  readonly countBudgetRejected: true;
  readonly byteBudgetRejected: true;
  readonly interruptionPreserved: true;
  readonly cleanupCausePreserved: true;
  readonly noMutationPublication: true;
  readonly postgresVersion: string | null;
}

export interface PqvA1RetainedFloorBoundaryProofV1 {
  readonly lane: "pglite" | "postgres";
  readonly snapshotCommitSeq: bigint;
  readonly aboveFloorAccepted: true;
  readonly atFloorAccepted: true;
  readonly belowFloorRejected: true;
}

const QUERY_BUDGET = Object.freeze({
  maximumPointReads: 32,
  maximumDocumentBytes: 1_048_576,
});
const ROW_ID = decodeAppRowIdHexV1("71".repeat(16));
const MISSING_ROW_ID = decodeAppRowIdHexV1("72".repeat(16));

export interface AppendPqvA1DocumentCommitInputV1 {
  readonly deploymentId: string;
  readonly tableId: ReturnType<typeof decodeCatalogTableId>;
  readonly rowId: ReturnType<typeof decodeAppRowIdHexV1>;
  readonly schemaVersionId: string;
  readonly previousCommitSeq: bigint | null;
  readonly status: "pending" | "complete";
  readonly beforeClockAdvance?: (backendPid: number) => void | Promise<void>;
}

export async function provePqvA1RetainedFloorBoundariesV1(
  lane: PqvA1ApplicationPointQuerySnapshotLaneV1,
): Promise<PqvA1RetainedFloorBoundaryProofV1> {
  const fixture = await prepareFsv05ReadyRevisionFixtureV1(
    lane,
    makeMemoryRuntimeArtifactStoreV1(),
    "pqv-a1-query",
    true,
  );
  const proof = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    yield* activateApplicationRevisionV1(
      fixture.revisionId,
      null,
      fixture.context,
    );
    const active = yield* readActiveApplicationRevisionV1(fixture.context);
    yield* Effect.promise(() => lane.persistence.query(
      `update fx_system_scope_clock
       set last_commit_seq = 2, oldest_available_commit_seq = 1
       where scope_id = $1`,
      [active.metadata.scopeId],
    ));
    const opened = yield* openApplicationPointQuerySnapshotV1(
      active.selection,
      "orders:get",
      QUERY_BUDGET,
      fixture.context,
    );
    const aboveFloor = yield* revalidateApplicationPointQuerySnapshotV1(
      opened.capability,
    );
    yield* Effect.promise(() => lane.persistence.query(
      `update fx_system_scope_clock
       set oldest_available_commit_seq = 2 where scope_id = $1`,
      [active.metadata.scopeId],
    ));
    const atFloor = yield* revalidateApplicationPointQuerySnapshotV1(
      opened.capability,
    );
    yield* Effect.promise(() => lane.persistence.query(
      `update fx_system_scope_clock
       set last_commit_seq = 3, oldest_available_commit_seq = 3
       where scope_id = $1`,
      [active.metadata.scopeId],
    ));
    const belowFloor = yield* Effect.result(
      revalidateApplicationPointQuerySnapshotV1(opened.capability),
    );
    return Object.freeze({ opened, aboveFloor, atFloor, belowFloor });
  })));
  const belowFloorRejected = Result.isFailure(proof.belowFloor) &&
    proof.belowFloor.failure instanceof ApplicationPointQuerySnapshotStaleV1Error &&
    proof.belowFloor.failure.reason === "historyUnavailable";
  return Object.freeze({
    lane: lane.name,
    snapshotCommitSeq: proof.opened.metadata.snapshotToken.commitSeq,
    aboveFloorAccepted: requireTrue(
      proof.aboveFloor.snapshotToken.commitSeq === 2n,
      `${lane.name} snapshot above retained floor`,
    ),
    atFloorAccepted: requireTrue(
      proof.atFloor.snapshotToken.commitSeq === 2n,
      `${lane.name} snapshot at retained floor`,
    ),
    belowFloorRejected: requireTrue(
      belowFloorRejected,
      `${lane.name} snapshot below retained floor`,
    ),
  });
}

export async function provePqvA1ApplicationPointQuerySnapshotV1(
  lane: PqvA1ApplicationPointQuerySnapshotLaneV1,
): Promise<PqvA1ApplicationPointQuerySnapshotProofV1> {
  const artifacts = makeMemoryRuntimeArtifactStoreV1();
  const first = await prepareFsv05ReadyRevisionFixtureV1(
    lane,
    artifacts,
    "pqv-a1-query",
    true,
  );
  const firstActivation = await Effect.runPromise(Effect.scoped(
    activateApplicationRevisionV1(first.revisionId, null, first.context),
  ));
  const second = await prepareFsv05ReadyRevisionFixtureV1(
    lane,
    artifacts,
    "pqv-a1-query-second",
    false,
  );

  const initialActive = await Effect.runPromise(Effect.scoped(
    readActiveApplicationRevisionV1(first.context),
  ));
  const tableId = await pqvA1TableIdForRevision(lane.persistence, first.revisionId);
  const schemaVersionId = initialActive.metadata.schemaVersionId;
  const documentId = appDocumentIdV1FromRowIdentity({ tableId, rowId: ROW_ID });
  const missingDocumentId = appDocumentIdV1FromRowIdentity({
    tableId,
    rowId: MISSING_ROW_ID,
  });
  await appendPqvA1DocumentCommitV1(lane.persistence, {
    deploymentId: first.deploymentId,
    tableId,
    rowId: ROW_ID,
    schemaVersionId,
    previousCommitSeq: null,
    status: "pending",
  });

  let issued:
    | AuthenticatedApplicationPointQuerySnapshotV1
    | undefined;
  const beforeReads = await publicationCounts(lane.persistence);
  const concurrentReader = lane.name === "postgres"
    ? makeConcurrentReadBarrier(lane, first.context)
    : null;
  const warmContext = concurrentReader?.context ?? first.context;
  const warm = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const active = yield* readActiveApplicationRevisionV1(warmContext);
    const opened = yield* openApplicationPointQuerySnapshotV1(
      active.selection,
      "orders:get",
      QUERY_BUDGET,
      warmContext,
    );
    issued = opened.capability;
    const cloneRejected = Result.isFailure(
      inspectApplicationPointQuerySnapshotV1(
        Object.freeze({ ...opened.capability }),
      ),
    );
    const firstRead = yield* readApplicationPointQueryDocumentV1(
      opened.capability,
      { tableName: "orders", documentId },
    );
    const repeated = yield* readApplicationPointQueryDocumentV1(
      opened.capability,
      { tableName: "orders", documentId },
    );
    const missing = yield* readApplicationPointQueryDocumentV1(
      opened.capability,
      { tableName: "orders", documentId: missingDocumentId },
    );
    const afterPreWriterReads = yield* Effect.tryPromise({
      try: () => publicationCounts(lane.persistence),
      catch: cause => cause,
    });
    if (!countsEqual(beforeReads, afterPreWriterReads)) {
      return yield* Effect.die(new Error(
        `PQV-A1 ${lane.name} warm reads published mutation state.`,
      ));
    }
    const writerInput = Object.freeze({
      deploymentId: first.deploymentId,
      tableId,
      rowId: ROW_ID,
      schemaVersionId,
      previousCommitSeq: opened.metadata.snapshotToken.commitSeq,
      status: "complete" as const,
    });
    const afterWriter = concurrentReader === null
      ? yield* Effect.tryPromise({
        try: async () => {
          await appendPqvA1DocumentCommitV1(lane.persistence, writerInput);
          return Effect.runPromise(readApplicationPointQueryDocumentV1(
            opened.capability,
            { tableName: "orders", documentId },
          ));
        },
        catch: cause => cause,
      })
      : yield* Effect.tryPromise({
        try: () => concurrentReader.readThroughWriter(
          opened.capability,
          documentId,
          writerInput,
        ),
        catch: cause => cause,
      });

    const generationRejected = yield* withClockFault(
      lane.persistence,
      "storage_generation = 'legacy_v1'",
      "storage_generation = 'flarexdb_v1'",
      opened.capability,
      documentId,
    );
    const fenceRejected = yield* withClockFault(
      lane.persistence,
      "storage_generation_fence = storage_generation_fence + 1",
      `storage_generation_fence = ${opened.metadata.scopeAuthority.storageGenerationFence}`,
      opened.capability,
      documentId,
    );
    const epochRejected = yield* withClockFault(
      lane.persistence,
      "epoch = 'epoch_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'",
      `epoch = '${opened.metadata.scopeAuthority.epoch}'`,
      opened.capability,
      documentId,
    );
    const floorRejected = yield* withClockFault(
      lane.persistence,
      "oldest_available_commit_seq = last_commit_seq",
      "oldest_available_commit_seq = 0",
      opened.capability,
      documentId,
    );

    yield* activateApplicationRevisionV1(
      second.revisionId,
      firstActivation.expectedActiveRevision,
      second.context,
    );
    const superseded = yield* Effect.exit(
      readApplicationPointQueryDocumentV1(opened.capability, {
        tableName: "orders",
        documentId,
      }),
    );
    return Object.freeze({
      snapshotCommitSeq: opened.metadata.snapshotToken.commitSeq,
      firstStatus: requireStatus(firstRead, "pending"),
      repeatedStatus: requireStatus(repeated, "pending"),
      concurrentWriterPinnedStatus: requireStatus(afterWriter, "pending"),
      missing: missing.kind === "missing",
      cloneRejected,
      generationRejected,
      fenceRejected,
      epochRejected,
      floorRejected,
      preWriterReadsNoPublication: true as const,
      supersededRejected: hasFailure(
        superseded,
        ApplicationPointQuerySnapshotStaleV1Error,
      ),
    });
  })));
  if (issued === undefined) throw new Error("PQV-A1 did not issue a capability.");
  const closedRejected = Result.isFailure(
    inspectApplicationPointQuerySnapshotV1(issued),
  );

  const afterWriter = await publicationCounts(lane.persistence);
  const cold = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const active = yield* readActiveApplicationRevisionV1(second.context);
    const opened = yield* openApplicationPointQuerySnapshotV1(
      active.selection,
      "orders:get",
      QUERY_BUDGET,
      second.context,
    );
    const current = yield* readApplicationPointQueryDocumentV1(
      opened.capability,
      { tableName: "orders", documentId },
    );
    return requireStatus(current, "complete");
  })));
  const afterCold = await publicationCounts(lane.persistence);

  const countBudgetRejected = await proveCountBudget(
    lane,
    second.context,
    documentId,
  );
  const byteBudgetRejected = await proveByteBudget(
    lane,
    second.context,
    documentId,
  );
  const invalids = await proveInvalidInputs(
    lane,
    second.context,
    tableId,
    documentId,
  );
  const interruptionPreserved = await proveInterruption(
    lane,
    second.context,
    documentId,
  );
  const cleanupCausePreserved = await proveCleanupCausePreservation(
    lane,
    second.context,
    documentId,
  );
  const finalCounts = await publicationCounts(lane.persistence);
  const noMutationPublication = warm.preWriterReadsNoPublication &&
    hasExactWriterDelta(beforeReads, afterWriter) &&
    countsEqual(afterWriter, afterCold) &&
    countsEqual(afterCold, finalCounts) &&
    afterWriter.appRowRevisions === beforeReads.appRowRevisions + 1;
  const postgresVersion = lane.name === "postgres"
    ? await loadPostgresVersion(lane.persistence)
    : null;

  return Object.freeze({
    lane: lane.name,
    snapshotCommitSeq: warm.snapshotCommitSeq,
    firstStatus: warm.firstStatus,
    repeatedStatus: warm.repeatedStatus,
    concurrentWriterPinnedStatus: warm.concurrentWriterPinnedStatus,
    coldStatus: cold,
    missing: requireTrue(warm.missing, "missing document"),
    unknownFunctionRejected: invalids.unknownFunctionRejected,
    invalidDeploymentRejected: invalids.invalidDeploymentRejected,
    wrongTableRejected: invalids.wrongTableRejected,
    wrongDocumentTableRejected: invalids.wrongDocumentTableRejected,
    unsupportedTargetRejected: invalids.unsupportedTargetRejected,
    cloneRejected: requireTrue(warm.cloneRejected, "cloned capability"),
    closedRejected: requireTrue(closedRejected, "closed capability"),
    generationRejected: requireTrue(
      warm.generationRejected,
      "stale storage generation",
    ),
    fenceRejected: requireTrue(warm.fenceRejected, "stale generation fence"),
    epochRejected: requireTrue(warm.epochRejected, "stale scope epoch"),
    floorRejected: requireTrue(warm.floorRejected, "retained-history floor"),
    supersededRejected: requireTrue(
      warm.supersededRejected,
      "superseded active revision",
    ),
    countBudgetRejected,
    byteBudgetRejected,
    interruptionPreserved,
    cleanupCausePreserved,
    noMutationPublication: requireTrue(
      noMutationPublication,
      "read-only publication counts",
    ),
    postgresVersion,
  });
}

export async function pqvA1TableIdForRevision(
  persistence: Persistence,
  revisionId: string,
) {
  const rows = await persistence.query<{ table_id: number }>(
    `select catalog.table_id
       from fx_system_application_revision_v1 as revision
       join fx_control_table as catalog
         on catalog.deployment_id = revision.deployment_id
      where revision.revision_id = $1
        and catalog.namespace = 'app'
        and catalog.logical_name = 'orders'
      limit 1`,
    [revisionId],
  );
  const row = rows.rows[0];
  if (row === undefined) throw new Error("PQV-A1 orders table is missing.");
  return decodeCatalogTableId(row.table_id);
}

export async function appendPqvA1DocumentCommitV1(
  persistence: Persistence,
  input: AppendPqvA1DocumentCommitInputV1,
): Promise<void> {
  const scope = await persistence.getScopeMetadataByDeploymentId(
    input.deploymentId,
  );
  if (scope === null) throw new Error("PQV-A1 scope metadata is missing.");
  const clock = await persistence.getScopeClock(scope.scopeId);
  if (clock === null) throw new Error("PQV-A1 scope clock is missing.");
  const scopeUuid = projectScopeIdUuidV1(clock.scopeId).scopeUuid;
  const commitSeq = CommitSeqSchema.make(clock.lastCommitSeq + 1n);
  const epochUuid = projectScopeEpochUuidV1(clock.epoch).epochUuid;
  const documentId = appDocumentIdV1FromRowIdentity({
    tableId: input.tableId,
    rowId: input.rowId,
  });
  const document = await canonicalizeAppDocumentV1({
    tableId: input.tableId,
    rowId: input.rowId,
    creationTime: decodeAppCreationTimeV1(1),
    fields: { status: input.status },
  });
  await persistence.drizzle.transaction(async tx => {
    await appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
      kind: "live",
      scopeId: clock.scopeId,
      tableId: input.tableId,
      rowId: input.rowId,
      writeEpoch: clock.epoch,
      commitSeq,
      prevCommitSeq: input.previousCommitSeq === null
        ? null
        : CommitSeqSchema.make(input.previousCommitSeq),
      schemaVersionId: decodeCatalogSchemaVersionId(input.schemaVersionId),
      creationTime: decodeAppCreationTimeV1(1),
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
    if (input.beforeClockAdvance !== undefined) {
      await input.beforeClockAdvance(await backendPid(tx));
    }
    await tx.update(fxSystemScopeClocks).set({ lastCommitSeq: commitSeq }).where(
      eq(fxSystemScopeClocks.scopeUuid, scopeUuid),
    );
  });
}

function makeConcurrentReadBarrier(
  lane: PqvA1ApplicationPointQuerySnapshotLaneV1,
  context: ApplicationRevisionActivationContextV1,
) {
  const base = lane.makeActivationTarget();
  let armed: Readonly<{
    readonly reached: (backendPid: number) => void;
    readonly release: Promise<void>;
    readonly settled: () => void;
  }> | null = null;
  const target = createLocatedApplicationRevisionActivationTargetV1(
    lane.persistence.drizzle,
    FSV05_SUPPORTED_LOCATOR,
    async work => {
      const result = await base[RUN_LOCATED_READ_COMMITTED_V1](async tx => {
        const value = await work(tx);
        const barrier = armed;
        if (barrier !== null) {
          barrier.reached(await backendPid(tx));
          await barrier.release;
        }
        return value;
      });
      armed?.settled();
      return result;
    },
  );
  const controlledContext: ApplicationRevisionActivationContextV1 =
    Object.freeze({
      ...context,
      authority: Object.freeze({
        ...context.authority,
        scopeClockTargets: { resolve: async () => target },
      }),
    });
  return Object.freeze({
    context: controlledContext,
    readThroughWriter: async (
      capability: AuthenticatedApplicationPointQuerySnapshotV1,
      documentId: ReturnType<typeof appDocumentIdV1FromRowIdentity>,
      writerInput: AppendPqvA1DocumentCommitInputV1,
    ) => {
      let announceReached: ((backendPid: number) => void) | undefined;
      const reached = new Promise<number>(resolve => {
        announceReached = resolve;
      });
      let releaseSettlement: (() => void) | undefined;
      const release = new Promise<void>(resolve => {
        releaseSettlement = resolve;
      });
      let announceSettled: (() => void) | undefined;
      const settled = new Promise<void>(resolve => {
        announceSettled = resolve;
      });
      armed = Object.freeze({
        reached: backendPid => announceReached?.(backendPid),
        release,
        settled: () => announceSettled?.(),
      });
      const read = Effect.runPromise(readApplicationPointQueryDocumentV1(
        capability,
        { tableName: "orders", documentId },
      ));
      let announceWriterReached: ((backendPid: number) => void) | undefined;
      const writerReached = new Promise<number>(resolve => {
        announceWriterReached = resolve;
      });
      let writer: Promise<void> | undefined;
      if (!("pool" in lane.persistence)) {
        throw new Error("PQV-A1 concurrency proof requires PostgreSQL.");
      }
      const pool = lane.persistence.pool;
      const observer = await pool.connect();
      try {
        const readerPid = await reached;
        writer = appendPqvA1DocumentCommitV1(lane.persistence, {
          ...writerInput,
          beforeClockAdvance: writerPid => announceWriterReached?.(writerPid),
        });
        const writerPid = await writerReached;
        await waitForPostgresBlockingRelationship(
          observer,
          writerPid,
          readerPid,
        );
        releaseSettlement?.();
        const result = await read;
        await settled;
        await writer;
        await waitForPostgresBackendIdle(observer, readerPid);
        if (
          pool.waitingCount !== 0 ||
          pool.idleCount !== pool.totalCount - 1
        ) {
          throw new Error(
            "PQV-A1 PostgreSQL transaction clients were not returned to the pool.",
          );
        }
        return result;
      } finally {
        releaseSettlement?.();
        armed = null;
        await Promise.allSettled([
          read,
          ...(writer === undefined ? [] : [writer]),
        ]);
        observer.release();
      }
    },
  });
}

function withClockFault(
  persistence: Persistence,
  mutation: string,
  restore: string,
  capability: AuthenticatedApplicationPointQuerySnapshotV1,
  documentId: ReturnType<typeof appDocumentIdV1FromRowIdentity>,
) {
  return Effect.acquireUseRelease(
    Effect.tryPromise({
      try: () => persistence.query(
        `update fx_system_scope_clock set ${mutation}
          where scope_id = (select scope_id from fx_control_scope limit 1)`,
      ),
      catch: cause => cause,
    }),
    () => Effect.exit(readApplicationPointQueryDocumentV1(capability, {
      tableName: "orders",
      documentId,
    })).pipe(Effect.map(exit =>
      hasFailure(exit, ApplicationPointQuerySnapshotStaleV1Error)
    )),
    () => Effect.tryPromise({
      try: () => persistence.query(
        `update fx_system_scope_clock set ${restore}
          where scope_id = (select scope_id from fx_control_scope limit 1)`,
      ),
      catch: cause => cause,
    }),
  );
}

async function proveCountBudget(
  lane: PqvA1ApplicationPointQuerySnapshotLaneV1,
  context: ApplicationRevisionActivationContextV1,
  documentId: ReturnType<typeof appDocumentIdV1FromRowIdentity>,
) {
  const proof = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const active = yield* readActiveApplicationRevisionV1(context);
    const opened = yield* openApplicationPointQuerySnapshotV1(
      active.selection,
      "orders:get",
      { maximumPointReads: 1, maximumDocumentBytes: 1_048_576 },
      context,
    );
    const invalid = yield* Effect.exit(readApplicationPointQueryDocumentV1(
      opened.capability,
      { tableName: "missing", documentId },
    ));
    const exhausted = yield* Effect.exit(readApplicationPointQueryDocumentV1(
      opened.capability,
      { tableName: "orders", documentId },
    ));
    return Object.freeze({ invalid, exhausted });
  })));
  return requireTrue(
    isTaggedFailure(
      proof.invalid,
      "InvalidApplicationPointQuerySnapshotInputV1Error",
    ) && hasFailure(
      proof.exhausted,
      ApplicationPointQuerySnapshotBudgetV1Error,
    ),
    `${lane.name} point-read budget`,
  );
}

async function proveByteBudget(
  lane: PqvA1ApplicationPointQuerySnapshotLaneV1,
  context: ApplicationRevisionActivationContextV1,
  documentId: ReturnType<typeof appDocumentIdV1FromRowIdentity>,
) {
  const exit = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const active = yield* readActiveApplicationRevisionV1(context);
    const opened = yield* openApplicationPointQuerySnapshotV1(
      active.selection,
      "orders:get",
      { maximumPointReads: 1, maximumDocumentBytes: 1 },
      context,
    );
    return yield* Effect.exit(readApplicationPointQueryDocumentV1(
      opened.capability,
      { tableName: "orders", documentId },
    ));
  })));
  return requireTrue(
    hasFailure(exit, ApplicationPointQuerySnapshotBudgetV1Error),
    `${lane.name} document-byte budget`,
  );
}

async function proveInvalidInputs(
  lane: PqvA1ApplicationPointQuerySnapshotLaneV1,
  context: ApplicationRevisionActivationContextV1,
  tableId: ReturnType<typeof decodeCatalogTableId>,
  documentId: ReturnType<typeof appDocumentIdV1FromRowIdentity>,
) {
  const storedScope = await lane.persistence.getScopeMetadataByDeploymentId(
    context.deploymentId,
  );
  if (storedScope === null) throw new Error("PQV-A1 scope metadata is missing.");
  const unsupportedLocator = Object.freeze({
    kind: "shared_database",
    databaseKey: "not-primary",
    schemaName: "public",
  } as const);
  const unsupportedTarget = createLocatedApplicationRevisionActivationTargetV1(
    lane.persistence.drizzle,
    unsupportedLocator,
  );
  const unsupportedContext: ApplicationRevisionActivationContextV1 =
    Object.freeze({
      ...context,
      authority: Object.freeze({
        scopeMetadata: {
          getScopeMetadataByDeploymentId: async () => Object.freeze({
            scopeId: storedScope.scopeId,
            deploymentId: storedScope.deploymentId,
            activeSchemaVersionId: storedScope.activeSchemaVersionId,
            createdAt: storedScope.createdAt,
            isolationKind: "shared_database" as const,
            physicalLocator: unsupportedLocator,
          }),
        },
        provisioningReceipts: {
          getScopeAuthorityProvisioningReceipt: async () => null,
        },
        scopeClockTargets: { resolve: async () => unsupportedTarget },
      }),
    });
  return Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const active = yield* readActiveApplicationRevisionV1(context);
    const unknownFunction = yield* Effect.exit(
      openApplicationPointQuerySnapshotV1(
        active.selection,
        "orders:missing",
        QUERY_BUDGET,
        context,
      ),
    );
    const opened = yield* openApplicationPointQuerySnapshotV1(
      active.selection,
      "orders:get",
      QUERY_BUDGET,
      context,
    );
    const wrongTable = yield* Effect.exit(
      readApplicationPointQueryDocumentV1(opened.capability, {
        tableName: "missing",
        documentId,
      }),
    );
    const wrongDocument = yield* Effect.exit(
      readApplicationPointQueryDocumentV1(opened.capability, {
        tableName: "orders",
        documentId: appDocumentIdV1FromRowIdentity({
          tableId: decodeCatalogTableId(Number(tableId) + 1),
          rowId: ROW_ID,
        }),
      }),
    );
    const invalidContext = Object.freeze({
      ...context,
      deploymentId: `missing:${lane.name}`,
    });
    const invalidDeployment = yield* Effect.exit(
      openApplicationPointQuerySnapshotV1(
        active.selection,
        "orders:get",
        QUERY_BUDGET,
        invalidContext,
      ),
    );
    const unsupportedTargetExit = yield* Effect.exit(
      openApplicationPointQuerySnapshotV1(
        active.selection,
        "orders:get",
        QUERY_BUDGET,
        unsupportedContext,
      ),
    );
    return Object.freeze({
      unknownFunctionRejected: requireTrue(
        isTaggedFailure(unknownFunction, "ApplicationPointQuerySnapshotFunctionV1Error"),
        "unknown query function",
      ),
      invalidDeploymentRejected: requireTrue(
        isTaggedFailure(invalidDeployment, "TrustedScopeAuthorityResolutionError"),
        "invalid deployment",
      ),
      wrongTableRejected: requireTrue(
        isTaggedFailure(wrongTable, "InvalidApplicationPointQuerySnapshotInputV1Error"),
        "unknown table",
      ),
      wrongDocumentTableRejected: requireTrue(
        isTaggedFailure(wrongDocument, "AppDocumentIdV1Error"),
        "document table mismatch",
      ),
      unsupportedTargetRejected: requireTrue(
        isTaggedFailure(
          unsupportedTargetExit,
          "UnsupportedApplicationPointQuerySnapshotTargetV1Error",
        ),
        "unsupported target",
      ),
    });
  })));
}

async function proveInterruption(
  lane: PqvA1ApplicationPointQuerySnapshotLaneV1,
  context: ApplicationRevisionActivationContextV1,
  documentId: ReturnType<typeof appDocumentIdV1FromRowIdentity>,
) {
  const base = lane.makeActivationTarget();
  let blockSettlement = false;
  let announceReached: (() => void) | undefined;
  const reached = new Promise<void>(resolve => {
    announceReached = resolve;
  });
  let releaseSettlement: (() => void) | undefined;
  const release = new Promise<void>(resolve => {
    releaseSettlement = resolve;
  });
  let announceSettled: (() => void) | undefined;
  const settled = new Promise<void>(resolve => {
    announceSettled = resolve;
  });
  const target = createLocatedApplicationRevisionActivationTargetV1(
    lane.persistence.drizzle,
    FSV05_SUPPORTED_LOCATOR,
    async work => {
      const result = await base[RUN_LOCATED_READ_COMMITTED_V1](async tx => {
        const value = await work(tx);
        if (blockSettlement) {
          announceReached?.();
          await release;
        }
        return value;
      });
      if (blockSettlement) announceSettled?.();
      return result;
    },
  );
  const blockedContext: ApplicationRevisionActivationContextV1 = Object.freeze({
    ...context,
    authority: Object.freeze({
      ...context.authority,
      scopeClockTargets: { resolve: async () => target },
    }),
  });
  const fiber = Effect.runFork(Effect.scoped(Effect.gen(function* () {
    const active = yield* readActiveApplicationRevisionV1(blockedContext);
    const opened = yield* openApplicationPointQuerySnapshotV1(
      active.selection,
      "orders:get",
      QUERY_BUDGET,
      blockedContext,
    );
    yield* Effect.sync(() => {
      blockSettlement = true;
    });
    return yield* readApplicationPointQueryDocumentV1(opened.capability, {
      tableName: "orders",
      documentId,
    });
  })));
  await reached;
  let interruptSettled = false;
  const interrupt = Effect.runPromise(Fiber.interrupt(fiber));
  void interrupt.then(() => {
    interruptSettled = true;
  });
  await new Promise(resolve => setTimeout(resolve, 25));
  if (interruptSettled) {
    throw new Error(
      `PQV-A1 ${lane.name} interruption abandoned a live transaction.`,
    );
  }
  releaseSettlement?.();
  await settled;
  await interrupt;
  const exit = await Effect.runPromise(Fiber.await(fiber));
  await lane.persistence.query("select 1 as connection_reusable");
  return requireTrue(
    Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause),
    `${lane.name} read interruption`,
  );
}

async function proveCleanupCausePreservation(
  lane: PqvA1ApplicationPointQuerySnapshotLaneV1,
  context: ApplicationRevisionActivationContextV1,
  documentId: ReturnType<typeof appDocumentIdV1FromRowIdentity>,
) {
  const base = lane.makeActivationTarget();
  const target = createLocatedApplicationRevisionActivationTargetV1(
    lane.persistence.drizzle,
    FSV05_SUPPORTED_LOCATOR,
    async work => {
      try {
        return await base[RUN_LOCATED_READ_COMMITTED_V1](work);
      } catch (cause) {
        if (
          cause instanceof LocatedReadCommittedTransactionFailureV1 &&
          cause.issue.kind === "callbackRolledBack"
        ) {
          throw new LocatedReadCommittedTransactionFailureV1({
            kind: "callbackCleanupFailed",
            callbackCause: cause.issue.callbackCause,
            transactionCause: new Error(
              "PQV-A1 injected rollback cleanup failure.",
            ),
          });
        }
        throw cause;
      }
    },
  );
  const cleanupContext: ApplicationRevisionActivationContextV1 = Object.freeze({
    ...context,
    authority: Object.freeze({
      ...context.authority,
      scopeClockTargets: { resolve: async () => target },
    }),
  });
  return Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const active = yield* readActiveApplicationRevisionV1(cleanupContext);
    const opened = yield* openApplicationPointQuerySnapshotV1(
      active.selection,
      "orders:get",
      QUERY_BUDGET,
      cleanupContext,
    );
    yield* Effect.acquireUseRelease(
      Effect.tryPromise({
        try: () => lane.persistence.query(
          `update fx_system_scope_clock
              set storage_generation = 'legacy_v1'
            where scope_id = (select scope_id from fx_control_scope limit 1)`,
        ),
        catch: cause => cause,
      }),
      () => Effect.exit(readApplicationPointQueryDocumentV1(
        opened.capability,
        { tableName: "orders", documentId },
      )).pipe(Effect.flatMap(exit =>
        Exit.isFailure(exit) &&
          hasFailure(exit, ApplicationPointQuerySnapshotStaleV1Error) &&
          Cause.hasDies(exit.cause)
          ? Effect.void
          : Effect.die(new Error(
            `PQV-A1 ${lane.name} lost the callback Cause during cleanup failure.`,
          ))
      )),
      () => Effect.tryPromise({
        try: () => lane.persistence.query(
          `update fx_system_scope_clock
              set storage_generation = 'flarexdb_v1'
            where scope_id = (select scope_id from fx_control_scope limit 1)`,
        ),
        catch: cause => cause,
      }),
    );
    return true as const;
  })));
}

async function backendPid(tx: AppRowTransaction): Promise<number> {
  const result = await tx.execute<{ pid: number }>(
    sql`select pg_backend_pid()::int as pid`,
  );
  if (typeof result !== "object" || result === null) {
    throw new Error("PQV-A1 PostgreSQL backend PID result is invalid.");
  }
  const rows = Reflect.get(result, "rows");
  if (!Array.isArray(rows)) {
    throw new Error("PQV-A1 PostgreSQL backend PID rows are invalid.");
  }
  const firstRow: unknown = rows[0];
  if (typeof firstRow !== "object" || firstRow === null) {
    throw new Error("PQV-A1 PostgreSQL backend PID is missing.");
  }
  const pid = Reflect.get(firstRow, "pid");
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
    throw new Error("PQV-A1 PostgreSQL backend PID is invalid.");
  }
  return pid;
}

async function waitForPostgresBlockingRelationship(
  observer: PoolClient,
  writerPid: number,
  readerPid: number,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await observer.query<{ blocked: boolean }>(
      `select exists (
         select 1
           from pg_stat_activity
          where pid = $1
            and wait_event_type = 'Lock'
            and $2 = any(pg_blocking_pids(pid))
       ) as blocked`,
      [writerPid, readerPid],
    );
    if (result.rows[0]?.blocked === true) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(
    `PQV-A1 writer backend ${writerPid} did not block on reader ${readerPid}.`,
  );
}

async function waitForPostgresBackendIdle(
  observer: PoolClient,
  backendPid: number,
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await observer.query<{ state: string }>(
      `select state
         from pg_stat_activity
        where pid = $1
          and datname = current_database()`,
      [backendPid],
    );
    if (result.rows[0]?.state === "idle") return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`PQV-A1 reader backend ${backendPid} did not become idle.`);
}

async function publicationCounts(persistence: Persistence) {
  const rows = await persistence.query<{
    app_row_revisions: string;
    app_row_current: string;
    commits: string;
    changes: string;
    journals: string;
    outcomes: string;
    outbox: string;
  }>(`select
    (select count(*)::text from fx_app_row_rev) as app_row_revisions,
    (select count(*)::text from fx_app_row_current) as app_row_current,
    (select count(*)::text from fx_system_commit) as commits,
    (select count(*)::text from fx_system_commit_app_row_change) as changes,
    (select count(*)::text from fx_system_tx_journal) as journals,
    (select count(*)::text from fx_system_idempotency) as outcomes,
    (select count(*)::text from fx_system_outbox) as outbox`);
  const row = rows.rows[0];
  if (row === undefined) throw new Error("PQV-A1 publication counts missing.");
  return Object.freeze({
    appRowRevisions: Number(row.app_row_revisions),
    appRowCurrent: Number(row.app_row_current),
    commits: Number(row.commits),
    changes: Number(row.changes),
    journals: Number(row.journals),
    outcomes: Number(row.outcomes),
    outbox: Number(row.outbox),
  });
}

function countsEqual(
  left: Awaited<ReturnType<typeof publicationCounts>>,
  right: Awaited<ReturnType<typeof publicationCounts>>,
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hasExactWriterDelta(
  before: Awaited<ReturnType<typeof publicationCounts>>,
  after: Awaited<ReturnType<typeof publicationCounts>>,
) {
  return after.appRowRevisions === before.appRowRevisions + 1 &&
    after.appRowCurrent === before.appRowCurrent &&
    after.commits === before.commits + 1 &&
    after.changes === before.changes + 1 &&
    after.journals === before.journals &&
    after.outcomes === before.outcomes &&
    after.outbox === before.outbox;
}

function requireStatus<const Status extends "pending" | "complete">(
  result: ReadApplicationPointQueryDocumentV1Result,
  expected: Status,
): Status {
  if (
    result.kind !== "present" ||
    result.document.status !== expected
  ) throw new Error(`PQV-A1 expected document status ${expected}.`);
  return expected;
}

function hasFailure<ErrorType>(
  exit: Exit.Exit<unknown, unknown>,
  errorClass: abstract new (...args: never[]) => ErrorType,
): boolean {
  if (Exit.isSuccess(exit)) return false;
  const error = Cause.findErrorOption(exit.cause);
  return error._tag === "Some" && error.value instanceof errorClass;
}

function isTaggedFailure(exit: Exit.Exit<unknown, unknown>, tag: string) {
  if (Exit.isSuccess(exit)) return false;
  const error = Cause.findErrorOption(exit.cause);
  return error._tag === "Some" &&
    typeof error.value === "object" && error.value !== null &&
    "_tag" in error.value && error.value._tag === tag;
}

function requireTrue(value: boolean, description: string): true {
  if (!value) throw new Error(`PQV-A1 did not prove ${description}.`);
  return true;
}

async function loadPostgresVersion(persistence: Persistence) {
  const rows = await persistence.query<{ version: string }>(
    "select version() as version",
  );
  const version = rows.rows[0]?.version;
  if (typeof version !== "string" || !version.includes("PostgreSQL")) {
    throw new Error("PQV-A1 PostgreSQL version receipt is missing.");
  }
  return version;
}
