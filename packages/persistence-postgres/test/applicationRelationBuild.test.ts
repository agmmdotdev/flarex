import { and, eq, sql } from "drizzle-orm";
import { Cause, Effect, Exit, Result } from "effect";
import { decodeAppCreationTimeV1 } from "flarex-protocol/app-document";
import {
  appDocumentIdV1FromRowIdentity,
  appRowIdHexV1ToBytes,
} from "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import {
  CatalogSchemaVersionIdSchema,
} from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  projectScopeIdUuidV1Result,
  ScopeEpochSchema,
  ScopeIdSchema,
  type ScopeUuidV1,
} from "flarex-protocol/storage-authority";
import { TransactionGrantDeploymentIdV1Schema } from
  "flarex-protocol/transaction-grant";
import { canonicalizeFlarexValueV1 } from "flarex-protocol/value";
import { describe, expect, it } from "vitest";

import {
  type ApplicationRelationBindingRepository,
  publishApplicationRelationBindingEffect,
} from "../src/applicationRelationBinding";
import {
  ApplicationRelationBuildDecisionUncertainError,
  ApplicationRelationBuildCorruptionError,
  ApplicationRelationBuildEnabledDefinitionError,
  ApplicationRelationBuildMismatchError,
  ApplicationRelationBuildPersistenceError,
  ApplicationRelationBuildUnavailableError,
  createApplicationRelationBuildPort,
  hasApplicationRelationBuildAuthority,
  hasApplicationRelationReadinessEvidenceAuthority,
  type ApplicationRelationBuildPort,
  type ApplicationRelationBuildQueryObservation,
  type ApplicationRelationBuildStepResult,
  type LocatedApplicationRelationBuildTarget,
} from "../src/applicationRelationBuild";
import {
  createApplicationRelationCommitPort,
  type LocatedApplicationRelationDefinitionSet,
} from "../src/applicationRelationCommit";
import {
  appendAppRowRevisionAndAdvanceCurrentInTransaction,
  type AppRowTransaction,
} from "../src/appRows";
import { AppRelationEdgeBuildCorruptionError } from
  "../src/appRelationEdges";
import {
  createPGliteLocatedIndexBuildReconciliationTargetV1,
  createPGliteLocatedPointMutationSessionActivationTargetV1,
  createPGlitePersistence,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import {
  fxAppEdgeAdjacencyVersions,
  fxAppEdgeCurrent,
  fxSystemEdgeDefinitionBuilds,
  fxSystemScopeClocks,
} from "../src/schema";
import type { ScopePhysicalLocator } from "../src/scopeMetadataTypes";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type RunLocatedReadCommittedTransactionV1,
} from "../src/transactionSessionAttemptKernel";
import {
  ensureRelationBuildTestWebCrypto,
  relationBuildDocumentId,
  relationBuildPublicationInput,
  relationBuildRowId,
  type RelationBuildPublicationOptions,
} from "./applicationRelationBuildTestSupport";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const LOCATOR = Object.freeze({
  kind: "shared_database",
  databaseKey: "e01-a-pglite",
  schemaName: "public",
} as const satisfies ScopePhysicalLocator);

let fixtureOrdinal = 0;

describe("E01-A private application relation builder", () => {
  it("settles and replays an authenticated immutable receipt for an empty definition", async () => {
    const fixture = await fixtureFor("empty");
    const observed: ApplicationRelationBuildStepResult[] = [];

    for (let step = 0; step < 8; step += 1) {
      const result = await runEffect(fixture.port.advance(fixture.input));
      observed.push(result);
      if (result.lifecycle === "enabled") break;
    }

    expect(observed.map((result) => result.lifecycle)).toEqual([
      "cleaning",
      "backfilling",
      "validating_sources",
      "validating_edges",
      "validating_versions",
      "enabled",
    ]);
    expect(observed.map((result) => result.status)).toEqual([
      "initialized",
      "advanced",
      "advanced",
      "advanced",
      "advanced",
      "enabled",
    ]);
    const replay = await runEffect(fixture.port.advance(fixture.input));
    expect(replay).toMatchObject({ status: "replayed", lifecycle: "enabled" });

    const evidence = await runEffect(fixture.port.readiness(fixture.input));
    expect(evidence).not.toBeNull();
    if (evidence === null) throw new Error("E01-A readiness evidence missing.");
    expect(evidence.receipt).toMatchObject({
      format: "flarex.application-relation-readiness",
      version: 1,
      sourceCount: "0",
      edgeCount: "0",
      versionCount: "0",
    });
    expect(hasApplicationRelationBuildAuthority(fixture.port)).toBe(true);
    expect(hasApplicationRelationBuildAuthority({ ...fixture.port })).toBe(false);
    expect(hasApplicationRelationReadinessEvidenceAuthority(
      fixture.port,
      evidence,
    )).toBe(true);
    expect(hasApplicationRelationReadinessEvidenceAuthority(
      fixture.port,
      { ...evidence },
    )).toBe(false);

    const coldPort = buildPort(fixture);
    const coldEvidence = await runEffect(coldPort.readiness(fixture.input));
    expect(coldEvidence?.receipt).toEqual(evidence.receipt);
    expect(coldEvidence?.canonicalBytes).toEqual(evidence.canonicalBytes);
    expect(coldEvidence?.sha256).toEqual(evidence.sha256);
    expect(hasApplicationRelationReadinessEvidenceAuthority(
      coldPort,
      coldEvidence,
    )).toBe(true);
    expect(hasApplicationRelationReadinessEvidenceAuthority(
      fixture.port,
      coldEvidence,
    )).toBe(false);
  });

  it("keeps bounded progress durable across rollback, detects missing evidence, repairs, and restarts on frontier movement", async () => {
    const fixture = await fixtureFor("populated");
    await seedPopulatedRows(fixture, 5);
    await runEffect(fixture.port.advance(fixture.input));
    await runEffect(fixture.port.advance(fixture.input));

    const rollback = await runEffectFailure(fixture.port.advance(
      fixture.input,
      {
        faultAfter: (point) => {
          if (point === "afterBackfillRow") {
            throw new Error("injected E01-A backfill failure");
          }
        },
      },
    ));
    expect(rollback._tag).toBe("ApplicationRelationBuildPersistenceError");
    expect(await storageCounts(fixture)).toEqual({ edges: 0, versions: 0 });
    expect(await buildHead(fixture)).toMatchObject({
      lifecycle: "backfilling",
      sourceCursorRowId: null,
      processedSourceCount: 0n,
    });

    await fixture.target.drizzle.update(fxSystemScopeClocks).set({
      lastCommitSeq: CommitSeqSchema.make(2n),
    }).where(eq(fxSystemScopeClocks.scopeId, fixture.scopeId));
    const invalidated = await runEffect(fixture.port.advance(fixture.input));
    expect(invalidated).toMatchObject({
      status: "restarted",
      lifecycle: "cleaning",
      frontierCommitSeq: 2n,
      attemptFence: 2n,
    });
    const recleaned = await runEffect(fixture.port.advance(fixture.input));
    expect(recleaned).toMatchObject({ lifecycle: "backfilling" });

    const firstPage = await runEffect(fixture.port.advance(fixture.input));
    expect(firstPage).toMatchObject({
      lifecycle: "backfilling",
      processedSourceRows: 4,
    });
    const finalPage = await runEffect(fixture.port.advance(fixture.input));
    expect(finalPage).toMatchObject({
      lifecycle: "validating_sources",
      processedSourceRows: 1,
    });
    expect(await storageCounts(fixture)).toEqual({ edges: 5, versions: 10 });

    await fixture.target.drizzle.delete(fxAppEdgeCurrent).where(and(
      eq(fxAppEdgeCurrent.scopeUuid, fixture.scopeUuid),
      eq(fxAppEdgeCurrent.edgeDefinitionId, fixture.input.edgeDefinitionId),
      eq(
        fxAppEdgeCurrent.sourceRowId,
        appRowIdHexV1ToBytes(relationBuildRowId(101)),
      ),
    ));
    const mismatch = await runEffectFailure(
      fixture.port.advance(fixture.input),
    );
    expect(mismatch).toBeInstanceOf(ApplicationRelationBuildMismatchError);
    expect(mismatch).toMatchObject({
      lifecycle: "validating_sources",
      reason: "sourceContents",
      rowId: relationBuildRowId(101),
    });
    expect(await buildHead(fixture)).toMatchObject({
      lifecycle: "validating_sources",
      validatedSourceCount: 0n,
    });

    const restarted = await runEffect(fixture.port.restart(fixture.input));
    expect(restarted).toMatchObject({
      status: "restarted",
      lifecycle: "cleaning",
      attemptFence: 3n,
    });
    const enabled = await advanceUntilEnabled(fixture);
    expect(enabled).toMatchObject({ lifecycle: "enabled", attemptFence: 3n });
    expect(await storageCounts(fixture)).toEqual({ edges: 5, versions: 10 });
    const ready = await runEffect(fixture.port.readiness(fixture.input));
    expect(ready?.receipt).toMatchObject({
      sourceCount: "5",
      edgeCount: "5",
      versionCount: "10",
      attemptFence: "3",
    });

    await fixture.target.drizzle.update(fxSystemScopeClocks).set({
      lastCommitSeq: CommitSeqSchema.make(3n),
    }).where(eq(fxSystemScopeClocks.scopeId, fixture.scopeId));
    const moved = await runEffect(fixture.port.advance(fixture.input));
    expect(moved).toMatchObject({
      status: "restarted",
      lifecycle: "cleaning",
      frontierCommitSeq: 3n,
      attemptFence: 4n,
    });
    expect(await runEffect(fixture.port.readiness(fixture.input))).toBeNull();
    expect(await buildHead(fixture)).toMatchObject({
      lifecycle: "cleaning",
      processedSourceCount: 0n,
      validatedSourceCount: 0n,
      validatedEdgeCount: 0n,
      validatedVersionCount: 0n,
      readinessSha256: null,
    });
  });

  it("fails closed on a dead target and a malformed relation value", async () => {
    const dead = await fixtureFor("dead_target");
    await seedSourceRows(dead, [{
      ordinal: 101,
      author: relationBuildDocumentId(2, 201),
    }]);
    await runEffect(dead.port.advance(dead.input));
    await runEffect(dead.port.advance(dead.input));
    const missingTarget = await runEffectFailure(dead.port.advance(dead.input));
    expect(missingTarget).toBeInstanceOf(ApplicationRelationBuildMismatchError);
    expect(missingTarget).toMatchObject({
      lifecycle: "backfilling",
      reason: "targetNotLive",
    });

    const malformed = await fixtureFor("malformed");
    await seedSourceRows(malformed, [{ ordinal: 101, author: 42 }]);
    await runEffect(malformed.port.advance(malformed.input));
    await runEffect(malformed.port.advance(malformed.input));
    const invalidValue = await runEffectFailure(
      malformed.port.advance(malformed.input),
    );
    expect(invalidValue).toBeInstanceOf(ApplicationRelationBuildMismatchError);
    expect(invalidValue).toMatchObject({
      lifecycle: "backfilling",
      reason: "invalidSourceValue",
    });
  });

  it("rejects source and target current pointers newer than the fixed frontier", async () => {
    const futureSource = await fixtureFor("future_source");
    await seedPopulatedRows(futureSource, 1);
    await seedRows(futureSource, [{
      tableId: 1,
      ordinal: 101,
      fields: { author: relationBuildDocumentId(2, 201) },
    }], 2n, { prevCommitSeq: 1n });
    await runEffect(futureSource.port.advance(futureSource.input));
    await runEffect(futureSource.port.advance(futureSource.input));
    const sourceFailure = await runEffectFailure(
      futureSource.port.advance(futureSource.input),
    );
    expect(sourceFailure).toBeInstanceOf(
      ApplicationRelationBuildCorruptionError,
    );
    expect(sourceFailure).toMatchObject({ reason: "futureCurrentRevision" });
    expect(await storageCounts(futureSource)).toEqual({ edges: 0, versions: 0 });

    const futureTarget = await fixtureFor("future_target");
    await seedPopulatedRows(futureTarget, 1);
    await seedRows(futureTarget, [{
      tableId: 2,
      ordinal: 201,
      fields: { name: "future-target" },
    }], 2n, { prevCommitSeq: 1n });
    await runEffect(futureTarget.port.advance(futureTarget.input));
    await runEffect(futureTarget.port.advance(futureTarget.input));
    const targetFailure = await runEffectFailure(
      futureTarget.port.advance(futureTarget.input),
    );
    expect(targetFailure).toBeInstanceOf(
      ApplicationRelationBuildCorruptionError,
    );
    expect(targetFailure).toMatchObject({ reason: "futureCurrentRevision" });
    expect(await storageCounts(futureTarget)).toEqual({ edges: 0, versions: 0 });
  });

  it("fails closed when target transaction capability is absent, rejected, or decision-uncertain", async () => {
    const fixture = await fixtureFor("target_capability");
    const target = createPGliteLocatedIndexBuildReconciliationTargetV1(
      fixture.target,
      LOCATOR,
    );
    const missingRunnerPort = buildPortWithTarget(
      fixture,
      withTransactionRunner(target, undefined),
    );
    const missingRunner = await runEffectFailure(
      missingRunnerPort.advance(fixture.input),
    );
    expect(missingRunner).toBeInstanceOf(
      ApplicationRelationBuildUnavailableError,
    );
    expect(missingRunner).toMatchObject({ reason: "targetCapabilityMissing" });

    const runnerCause = new Error("synchronous located runner failure");
    const throwingRunnerPort = buildPortWithTarget(
      fixture,
      withTransactionRunner(target, () => {
        throw runnerCause;
      }),
    );
    const rejectedRunner = await runEffectFailure(
      throwingRunnerPort.advance(fixture.input),
    );
    expect(rejectedRunner).toBeInstanceOf(
      ApplicationRelationBuildPersistenceError,
    );
    expect(rejectedRunner).toMatchObject({
      operation: "targetTransaction",
      retryable: false,
      cause: runnerCause,
    });

    let firstSettlement = true;
    const settlementCause = new Error("lost E01-A transaction response");
    const runReadCommitted = target[RUN_LOCATED_READ_COMMITTED_V1];
    const uncertainRunner: RunLocatedReadCommittedTransactionV1 = async <Value>(
      work: (tx: AppRowTransaction) => Promise<Value>,
    ): Promise<Value> => {
      const value = await runReadCommitted(work);
      if (firstSettlement) {
        firstSettlement = false;
        throw new LocatedReadCommittedTransactionFailureV1(Object.freeze({
          kind: "decisionUncertain",
          settlementCause,
        }));
      }
      return value;
    };
    const uncertainPort = buildPortWithTarget(
      fixture,
      withTransactionRunner(target, uncertainRunner),
    );
    const uncertain = await runEffectFailure(uncertainPort.advance(fixture.input));
    expect(uncertain).toBeInstanceOf(
      ApplicationRelationBuildDecisionUncertainError,
    );
    expect(uncertain).toMatchObject({
      scopeId: fixture.scopeId,
      edgeDefinitionId: fixture.input.edgeDefinitionId,
      cause: { issue: { kind: "decisionUncertain", settlementCause } },
    });
    expect(await buildHead(fixture)).toMatchObject({
      lifecycle: "cleaning",
      attemptFence: 1n,
    });
    expect(await runEffect(uncertainPort.advance(fixture.input))).toMatchObject({
      status: "advanced",
      lifecycle: "backfilling",
      attemptFence: 1n,
    });
  });

  it("preserves the build failure and rollback-cleanup defect in one Cause", async () => {
    const fixture = await fixtureFor("cleanup_failure");
    const target = createPGliteLocatedIndexBuildReconciliationTargetV1(
      fixture.target,
      LOCATOR,
    );
    const cleanupCause = new Error("E01-A rollback cleanup failed");
    const cleanupRunner: RunLocatedReadCommittedTransactionV1 = async <Value>(
      work: (tx: AppRowTransaction) => Promise<Value>,
    ): Promise<Value> => {
      try {
        return await fixture.target.drizzle.transaction(work);
      } catch (callbackCause) {
        throw new LocatedReadCommittedTransactionFailureV1(Object.freeze({
          kind: "callbackCleanupFailed",
          callbackCause,
          transactionCause: cleanupCause,
        }));
      }
    };
    const cleanupPort = buildPortWithTarget(
      fixture,
      withTransactionRunner(target, cleanupRunner),
    );
    const buildCause = new Error("E01-A build body failed");
    const exit = await Effect.runPromiseExit(cleanupPort.advance(
      fixture.input,
      {
        faultAfter: (point) => {
          if (point === "afterScopeClockLock") throw buildCause;
        },
      },
    ));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      throw new Error("Expected the cleanup-failure build to fail.");
    }
    const failureReason = exit.cause.reasons.find(Cause.isFailReason);
    expect(failureReason).toBeDefined();
    if (failureReason === undefined || !Cause.isFailReason(failureReason)) {
      throw new Error("Expected the original typed build failure.");
    }
    expect(failureReason.error).toBeInstanceOf(
      ApplicationRelationBuildPersistenceError,
    );
    expect(failureReason.error).toMatchObject({
      operation: "targetTransaction",
      retryable: true,
      cause: buildCause,
    });
    const defectReason = exit.cause.reasons.find(Cause.isDieReason);
    expect(defectReason).toBeDefined();
    if (defectReason === undefined || !Cause.isDieReason(defectReason)) {
      throw new Error("Expected the rollback-cleanup defect.");
    }
    expect(defectReason.defect).toBeInstanceOf(
      ApplicationRelationBuildPersistenceError,
    );
    expect(defectReason.defect).toMatchObject({
      operation: "targetTransaction",
      retryable: true,
      cause: {
        issue: {
          kind: "callbackCleanupFailed",
          transactionCause: cleanupCause,
        },
      },
    });
    expect(await buildHead(fixture)).toBeNull();
  });

  it("bounds four maximum-fanout target checks to four set-based queries", async () => {
    const fixture = await fixtureFor("maximum_target_batch", { many: true });
    await seedSourceRows(fixture, Array.from({ length: 4 }, (_, source) => ({
      ordinal: 101 + source,
      author: Array.from({ length: 1_024 }, (_, target) =>
        relationBuildDocumentId(2, 10_000 + source * 1_024 + target)
      ),
    })));
    await runEffect(fixture.port.advance(fixture.input));
    await runEffect(fixture.port.advance(fixture.input));
    const observations: ApplicationRelationBuildQueryObservation[] = [];
    const failure = await runEffectFailure(fixture.port.advance(
      fixture.input,
      { observeQuery: (observation) => observations.push(observation) },
    ));
    expect(failure).toBeInstanceOf(ApplicationRelationBuildMismatchError);
    expect(failure).toMatchObject({
      lifecycle: "backfilling",
      reason: "targetNotLive",
    });
    expect(observations.filter(({ name }) => name === "readSourceCurrentBatch")
      .map(({ requestedRows }) => requestedRows)).toEqual([4]);
    expect(observations.filter(({ name }) => name === "readSourceRevisionBatch")
      .map(({ requestedRows }) => requestedRows)).toEqual([4]);
    expect(observations.filter(({ name }) => name === "readTargetCurrentBatch")
      .map(({ requestedRows }) => requestedRows)).toEqual([
        1_024,
        1_024,
        1_024,
        1_024,
      ]);
    expect(await storageCounts(fixture)).toEqual({ edges: 0, versions: 0 });
    expect(await buildHead(fixture)).toMatchObject({
      lifecycle: "backfilling",
      processedSourceCount: 0n,
    });
  });

  it("paginates and cleans a 129-edge definition through fixed storage bounds", async () => {
    const fixture = await fixtureFor("bounded_fanout", { many: true });
    const targets = Array.from({ length: 129 }, (_, index) => ({
      tableId: 2,
      ordinal: 201 + index,
      fields: { name: `target-${index + 1}` },
    }));
    await seedRows(fixture, targets, 1n);
    await seedSourceRows(fixture, [{
      ordinal: 101,
      author: targets.map((target) =>
        relationBuildDocumentId(target.tableId, target.ordinal)
      ),
    }]);

    await runEffect(fixture.port.advance(fixture.input));
    await runEffect(fixture.port.advance(fixture.input));
    const backfilled = await runEffect(fixture.port.advance(fixture.input));
    expect(backfilled).toMatchObject({
      lifecycle: "validating_sources",
      processedSourceRows: 1,
    });
    expect(await storageCounts(fixture)).toEqual({
      edges: 129,
      versions: 130,
    });

    const restarted = await runEffect(fixture.port.restart(fixture.input));
    expect(restarted).toMatchObject({
      status: "restarted",
      lifecycle: "cleaning",
      attemptFence: 2n,
    });
    const cleanup = [
      await runEffect(fixture.port.advance(fixture.input)),
      await runEffect(fixture.port.advance(fixture.input)),
      await runEffect(fixture.port.advance(fixture.input)),
    ];
    expect(cleanup.map((result) => ({
      lifecycle: result.lifecycle,
      deletedEdges: result.deletedEdges,
      deletedVersions: result.deletedVersions,
    }))).toEqual([
      { lifecycle: "cleaning", deletedEdges: 128, deletedVersions: 128 },
      { lifecycle: "cleaning", deletedEdges: 1, deletedVersions: 2 },
      { lifecycle: "backfilling", deletedEdges: 0, deletedVersions: 0 },
    ]);

    const progress: ApplicationRelationBuildStepResult[] = [];
    const observations: ApplicationRelationBuildQueryObservation[] = [];
    for (let step = 0; step < 8; step += 1) {
      const result = await runEffect(fixture.port.advance(fixture.input, {
        observeQuery: (observation) => observations.push(observation),
      }));
      progress.push(result);
      if (result.lifecycle === "enabled") break;
    }
    expect(progress.filter((result) => result.processedSourceRows > 0)
      .map((result) => result.processedSourceRows)).toEqual([1, 1]);
    expect(progress.filter((result) => result.processedEdges > 0)
      .map((result) => result.processedEdges)).toEqual([128, 1]);
    expect(progress.filter((result) => result.processedVersions > 0)
      .map((result) => result.processedVersions)).toEqual([128, 2]);
    expect(observations.filter(({ name }) => name === "readTargetCurrentBatch")
      .map(({ requestedRows }) => requestedRows)).toEqual([129, 129, 128, 1]);
    expect(observations.filter(
      ({ name }) => name === "readEdgeEndpointVersionsBatch",
    ).map(({ requestedRows }) => requestedRows)).toEqual([129, 2]);
    expect(observations.filter(
      ({ name }) => name === "readVersionEndpointPresenceBatch",
    ).map(({ requestedRows }) => requestedRows)).toEqual([128, 2]);
    expect(progress.at(-1)?.lifecycle).toBe("enabled");
    expect((await runEffect(fixture.port.readiness(fixture.input)))?.receipt)
      .toMatchObject({
        sourceCount: "1",
        edgeCount: "129",
        versionCount: "130",
        attemptFence: "2",
      });
  });

  it("rejects canonical edge corruption and wrong or orphan adjacency versions", async () => {
    const fixture = await fixtureFor("corruption");
    await seedPopulatedRows(fixture, 1);
    await runEffect(fixture.port.advance(fixture.input));
    await runEffect(fixture.port.advance(fixture.input));
    await runEffect(fixture.port.advance(fixture.input));

    const edgeRows = await fixture.target.drizzle.select({
      occurrenceSha256: fxAppEdgeCurrent.occurrenceSha256,
    }).from(fxAppEdgeCurrent).where(and(
      eq(fxAppEdgeCurrent.scopeUuid, fixture.scopeUuid),
      eq(fxAppEdgeCurrent.edgeDefinitionId, fixture.input.edgeDefinitionId),
    ));
    const originalSha256 = edgeRows[0]?.occurrenceSha256;
    if (originalSha256 === undefined) {
      throw new Error("E01-A canonical edge fixture is missing.");
    }
    await fixture.target.drizzle.update(fxAppEdgeCurrent).set({
      occurrenceSha256: new Uint8Array(32).fill(0x5a),
    }).where(and(
      eq(fxAppEdgeCurrent.scopeUuid, fixture.scopeUuid),
      eq(fxAppEdgeCurrent.edgeDefinitionId, fixture.input.edgeDefinitionId),
    ));
    const corruptEdge = await runEffectFailure(
      fixture.port.advance(fixture.input),
    );
    expect(corruptEdge).toBeInstanceOf(AppRelationEdgeBuildCorruptionError);
    expect(corruptEdge).toMatchObject({
      operation: "validateEdge",
      reason: "stored edge does not equal its exact expected build evidence",
    });
    expect(await buildHead(fixture)).toMatchObject({
      lifecycle: "validating_sources",
      validatedSourceCount: 0n,
    });

    await fixture.target.drizzle.update(fxAppEdgeCurrent).set({
      occurrenceSha256: originalSha256,
    }).where(and(
      eq(fxAppEdgeCurrent.scopeUuid, fixture.scopeUuid),
      eq(fxAppEdgeCurrent.edgeDefinitionId, fixture.input.edgeDefinitionId),
    ));
    await runEffect(fixture.port.advance(fixture.input));
    await runEffect(fixture.port.advance(fixture.input));

    const sourceRowId = appRowIdHexV1ToBytes(relationBuildRowId(101));
    await fixture.target.drizzle.update(fxAppEdgeAdjacencyVersions).set({
      lastChangedCommitSeq: CommitSeqSchema.make(2n),
    }).where(and(
      eq(fxAppEdgeAdjacencyVersions.scopeUuid, fixture.scopeUuid),
      eq(
        fxAppEdgeAdjacencyVersions.edgeDefinitionId,
        fixture.input.edgeDefinitionId,
      ),
      eq(fxAppEdgeAdjacencyVersions.direction, "outgoing"),
      eq(fxAppEdgeAdjacencyVersions.endpointRowId, sourceRowId),
    ));
    const wrongVersion = await runEffectFailure(
      fixture.port.advance(fixture.input),
    );
    expect(wrongVersion).toBeInstanceOf(ApplicationRelationBuildMismatchError);
    expect(wrongVersion).toMatchObject({
      lifecycle: "validating_versions",
      reason: "versionValue",
    });
    await fixture.target.drizzle.update(fxAppEdgeAdjacencyVersions).set({
      lastChangedCommitSeq: CommitSeqSchema.make(1n),
    }).where(and(
      eq(fxAppEdgeAdjacencyVersions.scopeUuid, fixture.scopeUuid),
      eq(
        fxAppEdgeAdjacencyVersions.edgeDefinitionId,
        fixture.input.edgeDefinitionId,
      ),
      eq(fxAppEdgeAdjacencyVersions.direction, "outgoing"),
      eq(fxAppEdgeAdjacencyVersions.endpointRowId, sourceRowId),
    ));
    await fixture.target.drizzle.insert(fxAppEdgeAdjacencyVersions).values({
      scopeUuid: fixture.scopeUuid,
      edgeDefinitionId: fixture.input.edgeDefinitionId,
      direction: "incoming",
      endpointRowId: sourceRowId,
      lastChangedCommitSeq: CommitSeqSchema.make(1n),
    });
    const orphanVersion = await runEffectFailure(
      fixture.port.advance(fixture.input),
    );
    expect(orphanVersion).toBeInstanceOf(ApplicationRelationBuildMismatchError);
    expect(orphanVersion).toMatchObject({
      lifecycle: "validating_versions",
      reason: "orphanVersion",
    });
  });

  it("treats schema ID as physical provenance and defers semantic reuse", async () => {
    const fixture = await fixtureFor("schema_provenance");
    await seedPopulatedRows(fixture, 1);
    await runEffect(fixture.port.advance(fixture.input));
    await runEffect(fixture.port.advance(fixture.input));
    await runEffect(fixture.port.advance(fixture.input));

    const reused = await runEffect(publishApplicationRelationBindingEffect(
      repositoryFor(fixture.control),
      await relationBuildPublicationInput(
        fixture.deploymentId,
        fixtureOrdinal + 10_000,
        {
          extraUserField: true,
          decisions: Object.freeze([{
            relationOrdinal: 1,
            evolution: Object.freeze({
              kind: "preserve" as const,
              fromSchemaVersionId: fixture.schemaVersionId,
              fromRelationOrdinal: 1,
              physical: "reuse" as const,
            }),
          }]),
        },
      ),
    ));
    const reusedDefinitions = await runEffect(fixture.relationCommit.locate({
      deploymentId: fixture.deploymentId,
      schemaVersionId: reused.binding.schemaVersionId,
    }));
    const reusedDefinition = reusedDefinitions?.definitions[0];
    if (reusedDefinition === undefined) {
      throw new Error("E01-A reused relation definition is missing.");
    }
    expect(reused.binding.schemaVersionId).not.toBe(fixture.schemaVersionId);
    expect(reusedDefinition.edge.edgeDefinitionId).toBe(
      fixture.input.edgeDefinitionId,
    );
    expect(reusedDefinition.binding.semanticDefinitionSha256).not.toBe(
      fixture.definitions.definitions[0]?.binding.semanticDefinitionSha256,
    );
    const reusedInput = Object.freeze({
      deploymentId: fixture.deploymentId,
      schemaVersionId: reused.binding.schemaVersionId,
      edgeDefinitionId: reusedDefinition.edge.edgeDefinitionId,
    });
    await fixture.target.drizzle.update(fxAppEdgeCurrent).set({
      schemaVersionId: reused.binding.schemaVersionId,
    }).where(and(
      eq(fxAppEdgeCurrent.scopeUuid, fixture.scopeUuid),
      eq(fxAppEdgeCurrent.edgeDefinitionId, fixture.input.edgeDefinitionId),
    ));
    const continued = await runEffect(fixture.port.advance(fixture.input));
    expect(continued).toMatchObject({
      lifecycle: "validating_edges",
      attemptFence: 1n,
    });
    await advanceUntilEnabled(fixture);
    const storedProvenance = await fixture.target.drizzle.select({
      schemaVersionId: fxAppEdgeCurrent.schemaVersionId,
    }).from(fxAppEdgeCurrent).where(and(
      eq(fxAppEdgeCurrent.scopeUuid, fixture.scopeUuid),
      eq(fxAppEdgeCurrent.edgeDefinitionId, fixture.input.edgeDefinitionId),
    ));
    expect(storedProvenance[0]?.schemaVersionId).toBe(
      reused.binding.schemaVersionId,
    );

    const beforeHead = await buildHead(fixture);
    const beforeReadiness = await runEffect(
      fixture.port.readiness(fixture.input),
    );
    const movedBinding = await runEffectFailure(
      fixture.port.advance(reusedInput),
    );
    expect(movedBinding).toBeInstanceOf(
      ApplicationRelationBuildEnabledDefinitionError,
    );
    expect(movedBinding).toMatchObject({ reason: "bindingMoved" });
    expect(await buildHead(fixture)).toEqual(beforeHead);
    expect(await runEffect(fixture.port.readiness(reusedInput))).toBeNull();
    expect((await runEffect(fixture.port.readiness(fixture.input)))?.sha256)
      .toEqual(beforeReadiness?.sha256);
    expect(await storageCounts(fixture)).toEqual({ edges: 1, versions: 2 });
  });

  it("isolates replacement-definition build and cleanup state", async () => {
    const fixture = await fixtureFor("replacement_isolation");
    await seedPopulatedRows(fixture, 1);
    await runEffect(fixture.port.advance(fixture.input));
    await runEffect(fixture.port.advance(fixture.input));
    await runEffect(fixture.port.advance(fixture.input));
    const originalHead = await buildHead(fixture);

    const replacement = await runEffect(publishApplicationRelationBindingEffect(
      repositoryFor(fixture.control),
      await relationBuildPublicationInput(
        fixture.deploymentId,
        fixtureOrdinal + 30_000,
        {
          many: true,
          decisions: Object.freeze([{
            relationOrdinal: 1,
            evolution: Object.freeze({
              kind: "preserve" as const,
              fromSchemaVersionId: fixture.schemaVersionId,
              fromRelationOrdinal: 1,
              physical: "replace" as const,
            }),
          }]),
        },
      ),
    ));
    const replacementDefinitions = await runEffect(
      fixture.relationCommit.locate({
        deploymentId: fixture.deploymentId,
        schemaVersionId: replacement.binding.schemaVersionId,
      }),
    );
    const replacementDefinition = replacementDefinitions?.definitions[0];
    if (replacementDefinition === undefined) {
      throw new Error("E01-A replacement relation definition is missing.");
    }
    expect(replacementDefinition.binding.relationId).toBe(
      fixture.definitions.definitions[0]?.binding.relationId,
    );
    expect(replacementDefinition.edge.edgeDefinitionId).not.toBe(
      fixture.input.edgeDefinitionId,
    );
    await seedRows(fixture, [{
      tableId: 1,
      ordinal: 101,
      fields: { author: [relationBuildDocumentId(2, 201)] },
    }], 2n, {
      prevCommitSeq: 1n,
      schemaVersionId: replacement.binding.schemaVersionId,
    });
    await fixture.target.drizzle.update(fxSystemScopeClocks).set({
      lastCommitSeq: CommitSeqSchema.make(2n),
    }).where(eq(fxSystemScopeClocks.scopeId, fixture.scopeId));
    const replacementInput = Object.freeze({
      deploymentId: fixture.deploymentId,
      schemaVersionId: replacement.binding.schemaVersionId,
      edgeDefinitionId: replacementDefinition.edge.edgeDefinitionId,
    });
    await runEffect(fixture.port.advance(replacementInput));
    await runEffect(fixture.port.advance(replacementInput));
    await runEffect(fixture.port.advance(replacementInput));
    expect(await storageCounts(
      fixture,
      fixture.input.edgeDefinitionId,
    )).toEqual({ edges: 1, versions: 2 });
    expect(await storageCounts(
      fixture,
      replacementInput.edgeDefinitionId,
    )).toEqual({ edges: 1, versions: 2 });

    await runEffect(fixture.port.restart(replacementInput));
    const cleaned = await runEffect(fixture.port.advance(replacementInput));
    expect(cleaned).toMatchObject({ deletedEdges: 1, deletedVersions: 2 });
    expect(await storageCounts(
      fixture,
      replacementInput.edgeDefinitionId,
    )).toEqual({ edges: 0, versions: 0 });
    expect(await storageCounts(
      fixture,
      fixture.input.edgeDefinitionId,
    )).toEqual({ edges: 1, versions: 2 });
    expect(await buildHead(
      fixture,
      fixture.input.edgeDefinitionId,
    )).toEqual(originalHead);
  });
});

interface Fixture {
  readonly control: PGliteFlarexPersistence;
  readonly target: PGliteFlarexPersistence;
  readonly deploymentId: ReturnType<
    typeof TransactionGrantDeploymentIdV1Schema.make
  >;
  readonly scopeId: ReturnType<typeof ScopeIdSchema.make>;
  readonly scopeUuid: ScopeUuidV1;
  readonly epoch: ReturnType<typeof ScopeEpochSchema.make>;
  readonly schemaVersionId: ReturnType<typeof CatalogSchemaVersionIdSchema.make>;
  readonly definitions: LocatedApplicationRelationDefinitionSet;
  readonly relationCommit: ReturnType<typeof createApplicationRelationCommitPort>;
  readonly port: ApplicationRelationBuildPort;
  readonly input: Parameters<ApplicationRelationBuildPort["advance"]>[0];
}

async function fixtureFor(
  suffix: string,
  publicationOptions: RelationBuildPublicationOptions = {},
): Promise<Fixture> {
  ensureRelationBuildTestWebCrypto();
  fixtureOrdinal += 1;
  const control = await createPGlitePersistence();
  await control.migrate();
  const target = control;
  const uuidSuffix = fixtureOrdinal.toString(16).padStart(12, "0");
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
    `deployment_e01_${suffix}_${fixtureOrdinal}`,
  );
  const scopeId = ScopeIdSchema.make(
    `scope_e0100000-0000-4000-8000-${uuidSuffix}`,
  );
  const scopeUuid = Result.getOrThrow(
    projectScopeIdUuidV1Result(scopeId),
  ).scopeUuid;
  const epoch = ScopeEpochSchema.make(
    `epoch_e0200000-0000-4000-8000-${uuidSuffix}`,
  );
  await control.insertDeploymentMetadata({
    deploymentId,
    projectId: `project_e01_${suffix}_${fixtureOrdinal}`,
  });
  await control.insertScopeMetadata({ scopeId, deploymentId, physicalLocator: LOCATOR });
  await target.query(
    `insert into fx_system_scope_clock
       (scope_id, storage_generation, storage_generation_fence,
        last_commit_seq, last_outbox_seq, epoch)
     values ($1, 'flarexdb_v1', 1, 0, 0, $2)`,
    [scopeId, epoch],
  );
  const publication = await runEffect(publishApplicationRelationBindingEffect(
    repositoryFor(control),
    await relationBuildPublicationInput(
      deploymentId,
      fixtureOrdinal,
      publicationOptions,
    ),
  ));
  const pointTarget = createPGliteLocatedPointMutationSessionActivationTargetV1(
    target,
    LOCATOR,
  );
  const relationCommit = createApplicationRelationCommitPort(
    control.drizzle,
    {
      scopeMetadata: control,
      provisioningReceipts: {
        getScopeAuthorityProvisioningReceipt: async () => null,
      },
      scopeSessionTargets: { resolve: async () => pointTarget },
    },
  );
  const definitions = await runEffect(relationCommit.locate({
    deploymentId,
    schemaVersionId: publication.binding.schemaVersionId,
  }));
  if (definitions === null || definitions.definitions[0] === undefined) {
    throw new Error("E01-A test relation definition missing.");
  }
  const input = Object.freeze({
    deploymentId,
    schemaVersionId: publication.binding.schemaVersionId,
    edgeDefinitionId: definitions.definitions[0].edge.edgeDefinitionId,
  });
  const base = Object.freeze({
    control,
    target,
    deploymentId,
    scopeId,
    scopeUuid,
    epoch,
    schemaVersionId: publication.binding.schemaVersionId,
    definitions,
    relationCommit,
    input,
  });
  return Object.freeze({ ...base, port: buildPort(base) });
}

function buildPort(fixture: Pick<
  Fixture,
  "control" | "target" | "relationCommit"
>): ApplicationRelationBuildPort {
  const target = createPGliteLocatedIndexBuildReconciliationTargetV1(
    fixture.target,
    LOCATOR,
  );
  return buildPortWithTarget(fixture, target);
}

function buildPortWithTarget(
  fixture: Pick<Fixture, "control" | "relationCommit">,
  target: LocatedApplicationRelationBuildTarget,
): ApplicationRelationBuildPort {
  return createApplicationRelationBuildPort(
    fixture.control.drizzle,
    {
      scopeMetadata: fixture.control,
      provisioningReceipts: {
        getScopeAuthorityProvisioningReceipt: async () => null,
      },
      scopeClockTargets: { resolve: async () => target },
    },
    fixture.relationCommit,
  );
}

function withTransactionRunner(
  target: LocatedApplicationRelationBuildTarget,
  runner: unknown,
): LocatedApplicationRelationBuildTarget {
  const wrapper: LocatedApplicationRelationBuildTarget = {
    physicalLocator: target.physicalLocator,
    getCurrentClock: (scopeId) => target.getCurrentClock(scopeId),
    [RUN_LOCATED_READ_COMMITTED_V1]: (run) =>
      target[RUN_LOCATED_READ_COMMITTED_V1](run),
  };
  return new Proxy(wrapper, {
    get: (owner, property) => {
      if (property === RUN_LOCATED_READ_COMMITTED_V1) return runner;
      return Reflect.get(owner, property, owner);
    },
  });
}

async function advanceUntilEnabled(
  fixture: Fixture,
  input: Fixture["input"] = fixture.input,
): Promise<ApplicationRelationBuildStepResult> {
  for (let step = 0; step < 128; step += 1) {
    const result = await runEffect(fixture.port.advance(input));
    if (result.lifecycle === "enabled") return result;
  }
  throw new Error("E01-A fixture did not settle within 128 bounded steps.");
}

async function seedPopulatedRows(fixture: Fixture, count: number): Promise<void> {
  const targets = Array.from({ length: count }, (_, index) => ({
    ordinal: 201 + index,
    fields: { name: `target-${index + 1}` },
  }));
  const sources = Array.from({ length: count }, (_, index) => ({
    ordinal: 101 + index,
    fields: { author: relationBuildDocumentId(2, 201 + index) },
  }));
  await seedRows(fixture, targets.map((row) => ({ tableId: 2, ...row })), 1n);
  await seedRows(fixture, sources.map((row) => ({ tableId: 1, ...row })), 1n);
  await fixture.target.drizzle.update(fxSystemScopeClocks).set({
    lastCommitSeq: CommitSeqSchema.make(1n),
  }).where(eq(fxSystemScopeClocks.scopeId, fixture.scopeId));
}

async function seedSourceRows(
  fixture: Fixture,
  rows: ReadonlyArray<{ readonly ordinal: number; readonly author: unknown }>,
): Promise<void> {
  await seedRows(fixture, rows.map((row) => ({
    tableId: 1,
    ordinal: row.ordinal,
    fields: { author: row.author },
  })), 1n);
  await fixture.target.drizzle.update(fxSystemScopeClocks).set({
    lastCommitSeq: CommitSeqSchema.make(1n),
  }).where(eq(fxSystemScopeClocks.scopeId, fixture.scopeId));
}

async function seedRows(
  fixture: Fixture,
  rows: ReadonlyArray<{
    readonly tableId: number;
    readonly ordinal: number;
    readonly fields: Readonly<Record<string, unknown>>;
  }>,
  commitSeqValue: bigint,
  options: Readonly<{
    readonly prevCommitSeq?: bigint | null;
    readonly schemaVersionId?: Fixture["schemaVersionId"];
  }> = {},
): Promise<void> {
  const commitSeq = CommitSeqSchema.make(commitSeqValue);
  await fixture.target.drizzle.transaction(async (tx) => {
    for (const row of rows) {
      const tableId = decodeCatalogTableId(row.tableId);
      const rowIdentity = relationBuildRowId(row.ordinal);
      const creationTime = decodeAppCreationTimeV1(row.ordinal);
      const value = await canonicalizeFlarexValueV1({
        _id: appDocumentIdV1FromRowIdentity({ tableId, rowId: rowIdentity }),
        _creationTime: creationTime,
        ...row.fields,
      }, "appDocument");
      await appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
        kind: "live",
        scopeId: fixture.scopeId,
        tableId,
        rowId: rowIdentity,
        writeEpoch: fixture.epoch,
        commitSeq,
        prevCommitSeq: options.prevCommitSeq === undefined ||
            options.prevCommitSeq === null
          ? null
          : CommitSeqSchema.make(options.prevCommitSeq),
        schemaVersionId: options.schemaVersionId ?? fixture.schemaVersionId,
        creationTime,
        value: {
          codecVersion: value.codecVersion,
          valueJson: value.valueJson,
          canonicalBytes: value.canonicalBytes,
          sha256: value.sha256,
        },
      });
    }
  });
}

async function storageCounts(
  fixture: Fixture,
  edgeDefinitionId: Fixture["input"]["edgeDefinitionId"] =
    fixture.input.edgeDefinitionId,
) {
  const [edgeRows, versionRows] = await Promise.all([
    fixture.target.drizzle.select({ count: sql<number>`count(*)::integer` })
      .from(fxAppEdgeCurrent).where(and(
        eq(fxAppEdgeCurrent.scopeUuid, fixture.scopeUuid),
        eq(fxAppEdgeCurrent.edgeDefinitionId, edgeDefinitionId),
      )),
    fixture.target.drizzle.select({ count: sql<number>`count(*)::integer` })
      .from(fxAppEdgeAdjacencyVersions).where(and(
        eq(fxAppEdgeAdjacencyVersions.scopeUuid, fixture.scopeUuid),
        eq(
          fxAppEdgeAdjacencyVersions.edgeDefinitionId,
          edgeDefinitionId,
        ),
      )),
  ]);
  return {
    edges: edgeRows[0]?.count ?? -1,
    versions: versionRows[0]?.count ?? -1,
  };
}

async function buildHead(
  fixture: Fixture,
  edgeDefinitionId: Fixture["input"]["edgeDefinitionId"] =
    fixture.input.edgeDefinitionId,
) {
  const rows = await fixture.target.drizzle.select()
    .from(fxSystemEdgeDefinitionBuilds).where(and(
      eq(fxSystemEdgeDefinitionBuilds.scopeId, fixture.scopeId),
      eq(
        fxSystemEdgeDefinitionBuilds.edgeDefinitionId,
        edgeDefinitionId,
      ),
    ));
  return rows[0] ?? null;
}

function repositoryFor(
  persistence: PGliteFlarexPersistence,
): ApplicationRelationBindingRepository {
  return {
    db: persistence.drizzle,
    runTransaction: (run) => persistence.drizzle.transaction(run),
  };
}
