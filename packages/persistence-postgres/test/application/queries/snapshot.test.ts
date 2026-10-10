import { webcrypto } from "node:crypto";
import { eq } from "drizzle-orm";
import { Effect, Exit, Result, Scope } from "effect";
import { decodeAppDocumentIdV1 } from "flarex-protocol/app-document-id";
import { beforeAll, describe, expect, it } from "vitest";
import {
  makeApplicationActivationRepository,
} from "../../../src/application/activation/repository";
import {
  finalizeApplicationQueryEvaluationSnapshot,
  readApplicationQueryIndex,
  readApplicationQueryPoint,
  revalidateApplicationQuerySnapshot,
} from "../../../src/application/applicationQuerySnapshot";
import {
  RUN_LOCATED_READ_COMMITTED_V1,
  type RunLocatedReadCommittedTransactionV1,
} from "../../../src/execution/transactionSessionAttemptKernel";
import type { AppRowTransaction } from "../../../src/storage/documents/appRows";
import {
  createAppDeveloperIndexDefinitionPortV1,
} from "../../../src/storage/indexes/appDeveloperIndexCommitV1";
import { runEffect } from "../../support/effectTestRuntime";
import { fxSystemIndexBuildStates } from "../../../src/database/schema";
import { readinessFixture } from "../support/readinessFixture";
import { prepareReadinessAuthorities, enablePhysicalBuilds } from "../support/readinessPreparation";
import { createAdditionalApplicationRevision } from "../support/readinessPublication";
import { deferred } from "../support/readinessEvidence";
import {
  openApplicationQuerySnapshot,
  queryBudget,
  queryDeveloperIndexes,
  insertApplicationQueryRow,
} from "./support/querySnapshot";

beforeAll(() => {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
  }
});

describe("Application queries/snapshot", { timeout: 30_000 }, () => {
  it("opens and revalidates an Application query snapshot from exact active function evidence", async () => {
    const fixture = await readinessFixture();
    await prepareReadinessAuthorities(fixture);
    const activation = makeApplicationActivationRepository({ activation: { kind: "fullProof" },
      deploymentId: fixture.input.deploymentId,
      scopeId: fixture.input.scopeId,
      readiness: fixture.repository,
      authority: fixture.authorityPorts,
    });
    await runEffect(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    }));
    const active = await runEffect(activation.readActive());
    const metadata = await runEffect(Effect.scoped(Effect.gen(function* () {
      const opened = yield* openApplicationQuerySnapshot(
        active.selection,
        "users:get",
        queryBudget(),
        {
          deploymentId: fixture.input.deploymentId,
          controlDb: fixture.control.drizzle,
          authority: fixture.authorityPorts,
          schema: fixture.schema,
          developerIndexes: queryDeveloperIndexes(fixture),
        },
      );
      const revalidated = yield* revalidateApplicationQuerySnapshot(
        opened.snapshot,
      );
      expect(revalidated).toEqual(opened.metadata);
      const finalized = yield* Effect.result(
        finalizeApplicationQueryEvaluationSnapshot(opened.snapshot),
      );
      expect(Result.isFailure(finalized)).toBe(true);
      if (Result.isFailure(finalized)) {
        expect(finalized.failure).toMatchObject({
          operation: "finalizeEvaluation",
          reason: "invalidComposition",
        });
      }
      return revalidated;
    })));

    expect(metadata).toMatchObject({
      function: {
        path: "users:get",
        kind: "query",
        visibility: "public",
      },
      snapshotToken: {
        scopeId: fixture.authority.scopeId,
      },
    });
    expect(metadata.function.entrySha256).toMatch(/^[0-9a-f]{64}$/);
  })

  it("accepts Application query snapshots at or above the retained floor and rejects below it", async () => {
    const fixture = await readinessFixture();
    await prepareReadinessAuthorities(fixture);
    const activation = makeApplicationActivationRepository({ activation: { kind: "fullProof" },
      deploymentId: fixture.input.deploymentId,
      scopeId: fixture.input.scopeId,
      readiness: fixture.repository,
      authority: fixture.authorityPorts,
    });
    await runEffect(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    }));
    await fixture.target.query(
      `with authority as (
         update fx_system_scope_execution_authority set oldest_available_commit_seq = 1
         where scope_id = $1 returning scope_id
       ) update fx_system_scope_clock set last_commit_seq = 2
         where scope_id in (select scope_id from authority)`,
      [fixture.authority.scopeId],
    );
    const proof = await runEffect(Effect.scoped(Effect.gen(function* () {
      const active = yield* activation.readActive();
      const opened = yield* openApplicationQuerySnapshot(
        active.selection,
        "users:get",
        queryBudget(),
        {
          deploymentId: fixture.input.deploymentId,
          controlDb: fixture.control.drizzle,
          authority: fixture.authorityPorts,
          schema: fixture.schema,
          developerIndexes: queryDeveloperIndexes(fixture),
        },
      );
      const aboveFloor = yield* revalidateApplicationQuerySnapshot(
        opened.snapshot,
      );
      yield* Effect.promise(() => fixture.target.query(
        `update fx_system_scope_execution_authority
         set oldest_available_commit_seq = 2 where scope_id = $1`,
        [fixture.authority.scopeId],
      ));
      const atFloor = yield* revalidateApplicationQuerySnapshot(
        opened.snapshot,
      );
      yield* Effect.promise(() => fixture.target.query(
        `with authority as (
           update fx_system_scope_execution_authority set oldest_available_commit_seq = 3
           where scope_id = $1 returning scope_id
         ) update fx_system_scope_clock set last_commit_seq = 3
           where scope_id in (select scope_id from authority)`,
        [fixture.authority.scopeId],
      ));
      const belowFloor = yield* Effect.result(
        revalidateApplicationQuerySnapshot(opened.snapshot),
      );
      return { opened, aboveFloor, atFloor, belowFloor };
    })));
    expect(proof.opened.metadata.snapshotToken.commitSeq).toBe(2n);
    expect(proof.aboveFloor).toEqual(proof.opened.metadata);
    expect(proof.atFloor).toEqual(proof.opened.metadata);
    expect(Result.isFailure(proof.belowFloor)).toBe(true);
    if (Result.isFailure(proof.belowFloor)) {
      expect(proof.belowFloor.failure).toMatchObject({
        operation: "revalidate",
        reason: "historyUnavailable",
      });
    }
  })

  it("rejects corrupted stored Application function evidence before issuing a query snapshot", async () => {
    const fixture = await readinessFixture();
    await prepareReadinessAuthorities(fixture);
    const activation = makeApplicationActivationRepository({ activation: { kind: "fullProof" },
      deploymentId: fixture.input.deploymentId,
      scopeId: fixture.input.scopeId,
      readiness: fixture.repository,
      authority: fixture.authorityPorts,
    });
    await runEffect(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    }));
    const active = await runEffect(activation.readActive());
    await fixture.target.query(
      `update fx_system_application_function_v1
          set entry_bytes = $1
        where scope_id = $2 and revision_id = $3`,
      [new Uint8Array([1]), fixture.authority.scopeId, fixture.input.revisionId],
    );

    const result = await runEffect(Effect.result(Effect.scoped(
      openApplicationQuerySnapshot(
        active.selection,
        "users:get",
        queryBudget(),
        {
          deploymentId: fixture.input.deploymentId,
          controlDb: fixture.control.drizzle,
          authority: fixture.authorityPorts,
          schema: fixture.schema,
          developerIndexes: queryDeveloperIndexes(fixture),
        },
      ),
    )));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({ reason: "storedFunction" });
    }
  })

  it("rejects a developer-index port issued by another control database", async () => {
    const fixture = await readinessFixture();
    await prepareReadinessAuthorities(fixture);
    const activation = makeApplicationActivationRepository({ activation: { kind: "fullProof" },
      deploymentId: fixture.input.deploymentId,
      scopeId: fixture.input.scopeId,
      readiness: fixture.repository,
      authority: fixture.authorityPorts,
    });
    await runEffect(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    }));
    const active = await runEffect(activation.readActive());
    const result = await runEffect(Effect.result(Effect.scoped(
      openApplicationQuerySnapshot(
        active.selection,
        "users:get",
        queryBudget(),
        {
          deploymentId: fixture.input.deploymentId,
          controlDb: fixture.control.drizzle,
          authority: fixture.authorityPorts,
          schema: fixture.schema,
          developerIndexes: createAppDeveloperIndexDefinitionPortV1(
            fixture.target.drizzle,
          ),
        },
      ),
    )));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({ reason: "invalidComposition" });
    }
  })

  it("enforces point-read budgets and retained-history staleness on an issued query snapshot", async () => {
    const fixture = await readinessFixture({ includeTable: true });
    const schemaVersionId = await prepareReadinessAuthorities(fixture);
    await enablePhysicalBuilds(fixture, schemaVersionId);
    const activation = makeApplicationActivationRepository({ activation: { kind: "fullProof" },
      deploymentId: fixture.input.deploymentId,
      scopeId: fixture.input.scopeId,
      readiness: fixture.repository,
      authority: fixture.authorityPorts,
    });
    await runEffect(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    }));
    const active = await runEffect(activation.readActive());
    const result = await runEffect(Effect.scoped(Effect.gen(function* () {
      const opened = yield* openApplicationQuerySnapshot(
        active.selection,
        "users:get",
        Object.freeze({
          ...queryBudget(),
          maximumPointReads: 1,
        }),
        {
          deploymentId: fixture.input.deploymentId,
          controlDb: fixture.control.drizzle,
          authority: fixture.authorityPorts,
          schema: fixture.schema,
          developerIndexes: queryDeveloperIndexes(fixture),
        },
      );
      const missing = yield* readApplicationQueryPoint(
        opened.snapshot,
        "users",
        decodeAppDocumentIdV1("1:00000000-0000-0000-0000-000000000001"),
      );
      const budget = yield* Effect.result(readApplicationQueryPoint(
        opened.snapshot,
        "users",
        decodeAppDocumentIdV1("1:00000000-0000-0000-0000-000000000002"),
      ));
      const staleOpened = yield* openApplicationQuerySnapshot(
        active.selection,
        "users:get",
        queryBudget(),
        {
          deploymentId: fixture.input.deploymentId,
          controlDb: fixture.control.drizzle,
          authority: fixture.authorityPorts,
          schema: fixture.schema,
          developerIndexes: queryDeveloperIndexes(fixture),
        },
      );
      yield* Effect.promise(() => fixture.target.query(
        `with authority as (
           select scope_id from fx_system_scope_execution_authority where scope_id = $1 for update
         ), clock as (
           update fx_system_scope_clock set last_commit_seq = last_commit_seq + 1
           where scope_id in (select scope_id from authority) returning scope_id, last_commit_seq
         ) update fx_system_scope_execution_authority authority
           set oldest_available_commit_seq = clock.last_commit_seq
           from clock where authority.scope_id = clock.scope_id`,
        [fixture.authority.scopeId],
      ));
      const stale = yield* Effect.result(
        revalidateApplicationQuerySnapshot(opened.snapshot),
      );
      const stalePoint = yield* Effect.result(readApplicationQueryPoint(
        staleOpened.snapshot,
        "users",
        decodeAppDocumentIdV1("1:00000000-0000-0000-0000-000000000003"),
      ));
      return { missing, budget, stale, stalePoint };
    })));

    expect(result.missing).toEqual({ kind: "missing" });
    expect(Result.isFailure(result.budget)).toBe(true);
    if (Result.isFailure(result.budget)) {
      expect(result.budget.failure).toMatchObject({ reason: "budgetExceeded" });
    }
    expect(Result.isFailure(result.stale)).toBe(true);
    if (Result.isFailure(result.stale)) {
      expect(result.stale.failure).toMatchObject({
        operation: "revalidate",
        reason: "historyUnavailable",
      });
    }
    expect(Result.isFailure(result.stalePoint)).toBe(true);
    if (Result.isFailure(result.stalePoint)) {
      expect(result.stalePoint.failure).toMatchObject({
        operation: "pointRead",
        reason: "historyUnavailable",
      });
    }
  })

  it("finalizes one immutable deduplicated Application query dependency receipt", async () => {
    const fixture = await readinessFixture({
      includeTable: true,
      includeIndex: true,
    });
    const schemaVersionId = await prepareReadinessAuthorities(fixture);
    await insertApplicationQueryRow(fixture, schemaVersionId);
    await enablePhysicalBuilds(fixture, schemaVersionId);
    await runEffect(fixture.repository.settle(fixture.input));
    const activation = makeApplicationActivationRepository({ activation: { kind: "fullProof" },
      deploymentId: fixture.input.deploymentId,
      scopeId: fixture.input.scopeId,
      readiness: fixture.repository,
      authority: fixture.authorityPorts,
    });
    await runEffect(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    }));
    const active = await runEffect(activation.readActive());
    const proof = await runEffect(Effect.scoped(Effect.gen(function* () {
      const opened = yield* openApplicationQuerySnapshot(
        active.selection,
        "users:get",
        queryBudget(),
        {
          deploymentId: fixture.input.deploymentId,
          controlDb: fixture.control.drizzle,
          authority: fixture.authorityPorts,
          schema: fixture.schema,
          developerIndexes: queryDeveloperIndexes(fixture),
        },
        { dependencyCapture: "evaluation" },
      );
      const presentId = decodeAppDocumentIdV1(
        "1:11111111-1111-1111-1111-111111111111",
      );
      const missingId = decodeAppDocumentIdV1(
        "1:00000000-0000-0000-0000-000000000001",
      );
      yield* readApplicationQueryPoint(opened.snapshot, "users", presentId);
      yield* readApplicationQueryPoint(opened.snapshot, "users", missingId);
      yield* readApplicationQueryPoint(opened.snapshot, "users", missingId);
      yield* readApplicationQueryIndex(
        opened.snapshot,
        "users",
        "by_name",
        {},
        10,
      );
      yield* readApplicationQueryIndex(
        opened.snapshot,
        "users",
        "by_name",
        {},
        10,
      );
      const rejected = yield* Effect.result(readApplicationQueryPoint(
        opened.snapshot,
        "missing_table",
        missingId,
      ));
      const receipt = yield* finalizeApplicationQueryEvaluationSnapshot(
        opened.snapshot,
      );
      const readAfterFinalize = yield* Effect.result(
        readApplicationQueryPoint(opened.snapshot, "users", missingId),
      );
      const finalizeAgain = yield* Effect.result(
        finalizeApplicationQueryEvaluationSnapshot(opened.snapshot),
      );
      return { receipt, rejected, readAfterFinalize, finalizeAgain };
    })));

    expect(Result.isFailure(proof.rejected)).toBe(true);
    expect(proof.receipt.dependencies).toHaveLength(3);
    expect(proof.receipt.dependencies).toEqual(expect.arrayContaining([
      { kind: "appRowPoint", documentId:
        "1:11111111-1111-1111-1111-111111111111" },
      { kind: "appRowPoint", documentId:
        "1:00000000-0000-0000-0000-000000000001" },
      { kind: "appTable", tableId: 1 },
    ]));
    expect(proof.receipt.metadata.snapshotToken.commitSeq).toBe(1n);
    expect(Object.isFrozen(proof.receipt)).toBe(true);
    expect(Object.isFrozen(proof.receipt.dependencies)).toBe(true);
    expect(Result.isFailure(proof.readAfterFinalize)).toBe(true);
    if (Result.isFailure(proof.readAfterFinalize)) {
      expect(proof.readAfterFinalize.failure).toMatchObject({
        operation: "pointRead",
        reason: "invalidComposition",
      });
    }
    expect(Result.isFailure(proof.finalizeAgain)).toBe(true);
    if (Result.isFailure(proof.finalizeAgain)) {
      expect(proof.finalizeAgain.failure).toMatchObject({
        operation: "finalizeEvaluation",
        reason: "invalidComposition",
      });
    }
  })

  it("rejects a query snapshot after the Application active head moves", async () => {
    const fixture = await readinessFixture();
    await prepareReadinessAuthorities(fixture);
    const activation = makeApplicationActivationRepository({ activation: { kind: "fullProof" },
      deploymentId: fixture.input.deploymentId,
      scopeId: fixture.input.scopeId,
      readiness: fixture.repository,
      authority: fixture.authorityPorts,
    });
    const first = await runEffect(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    }));
    const active = await runEffect(activation.readActive());

    const stale = await runEffect(Effect.scoped(Effect.gen(function* () {
      const opened = yield* openApplicationQuerySnapshot(
        active.selection,
        "users:get",
        queryBudget(),
        {
          deploymentId: fixture.input.deploymentId,
          controlDb: fixture.control.drizzle,
          authority: fixture.authorityPorts,
          schema: fixture.schema,
          developerIndexes: queryDeveloperIndexes(fixture),
        },
        { dependencyCapture: "evaluation" },
      );
      const nextRevisionId = yield* Effect.promise(() =>
        createAdditionalApplicationRevision(fixture)
      );
      yield* fixture.repository.settle({
        deploymentId: fixture.input.deploymentId,
        scopeId: fixture.input.scopeId,
        revisionId: nextRevisionId,
      });
      yield* activation.activate({
        revisionId: nextRevisionId,
        expectedActiveHead: first.expectedActiveHead,
      });
      return yield* Effect.result(
        finalizeApplicationQueryEvaluationSnapshot(opened.snapshot),
      );
    })));

    expect(Result.isFailure(stale)).toBe(true);
    if (Result.isFailure(stale)) {
      expect(stale.failure).toMatchObject({
        _tag: "ApplicationActivationError",
        operation: "validateSelection",
        reason: "concurrentHead",
      });
    }
  })

  it("closes queued query reads before they start another transaction", async () => {
    const fixture = await readinessFixture({ includeTable: true });
    const schemaVersionId = await prepareReadinessAuthorities(fixture);
    await enablePhysicalBuilds(fixture, schemaVersionId);
    const activation = makeApplicationActivationRepository({ activation: { kind: "fullProof" },
      deploymentId: fixture.input.deploymentId,
      scopeId: fixture.input.scopeId,
      readiness: fixture.repository,
      authority: fixture.authorityPorts,
    });
    await runEffect(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    }));
    const active = await runEffect(activation.readActive());
    const resolved = await fixture.authorityPorts.scopeClockTargets.resolve();
    const runner = Reflect.get(resolved, RUN_LOCATED_READ_COMMITTED_V1);
    if (typeof runner !== "function") {
      throw new Error("Expected the located query transaction runner.");
    }
    const runReadCommitted = runner as RunLocatedReadCommittedTransactionV1;
    let transactionStarts = 0;
    const firstStarted = deferred<void>();
    const releaseFirst = deferred<void>();
    const observedTarget = Object.freeze({
      ...resolved,
      [RUN_LOCATED_READ_COMMITTED_V1]: async <Value>(
        work: (tx: AppRowTransaction) => Promise<Value>,
      ): Promise<Value> => {
        transactionStarts += 1;
        if (transactionStarts === 2) {
          firstStarted.resolve();
          await releaseFirst.promise;
        }
        return runReadCommitted(work);
      },
    });
    fixture.authorityPorts.scopeClockTargets.resolve = async () => observedTarget;
    const scope = await runEffect(Scope.make());
    const opened = await runEffect(openApplicationQuerySnapshot(
      active.selection,
      "users:get",
      queryBudget(),
      {
        deploymentId: fixture.input.deploymentId,
        controlDb: fixture.control.drizzle,
        authority: fixture.authorityPorts,
        schema: fixture.schema,
        developerIndexes: queryDeveloperIndexes(fixture),
      },
    ).pipe(Scope.provide(scope)));
    const read = () => readApplicationQueryPoint(
      opened.snapshot,
      "users",
      decodeAppDocumentIdV1("1:00000000-0000-0000-0000-000000000001"),
    );
    const first = Effect.runPromise(Effect.result(read()));
    await firstStarted.promise;
    const queued = Array.from({ length: 8 }, () =>
      Effect.runPromise(Effect.result(read()))
    );
    await runEffect(Scope.close(scope, Exit.succeed(undefined)));
    releaseFirst.resolve();
    const [firstResult, ...queuedResults] = await Promise.all([first, ...queued]);

    expect(Result.isSuccess(firstResult)).toBe(true);
    expect(queuedResults.every(Result.isFailure)).toBe(true);
    expect(transactionStarts).toBe(2);
  })

  it("materializes an ordered developer-index page from the active snapshot", async () => {
    const fixture = await readinessFixture({
      includeTable: true,
      includeIndex: true,
    });
    const schemaVersionId = await prepareReadinessAuthorities(fixture);
    const expected = await insertApplicationQueryRow(fixture, schemaVersionId);
    await enablePhysicalBuilds(fixture, schemaVersionId);
    await runEffect(fixture.repository.settle(fixture.input));
    const activation = makeApplicationActivationRepository({ activation: { kind: "fullProof" },
      deploymentId: fixture.input.deploymentId,
      scopeId: fixture.input.scopeId,
      readiness: fixture.repository,
      authority: fixture.authorityPorts,
    });
    await runEffect(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    }));
    const active = await runEffect(activation.readActive());

    const page = await runEffect(Effect.scoped(Effect.gen(function* () {
      const opened = yield* openApplicationQuerySnapshot(
        active.selection,
        "users:get",
        queryBudget(),
        {
          deploymentId: fixture.input.deploymentId,
          controlDb: fixture.control.drizzle,
          authority: fixture.authorityPorts,
          schema: fixture.schema,
          developerIndexes: queryDeveloperIndexes(fixture),
        },
      );
      return yield* readApplicationQueryIndex(
        opened.snapshot,
        "users",
        "by_name",
        {},
        10,
      );
    })));

    expect(page).toEqual({ documents: [expected.value], isDone: true });

    const indexBudget = await runEffect(Effect.result(Effect.scoped(Effect.gen(function* () {
      const opened = yield* openApplicationQuerySnapshot(
        active.selection,
        "users:get",
        Object.freeze({ ...queryBudget(), maximumIndexReads: 1 }),
        {
          deploymentId: fixture.input.deploymentId,
          controlDb: fixture.control.drizzle,
          authority: fixture.authorityPorts,
          schema: fixture.schema,
          developerIndexes: queryDeveloperIndexes(fixture),
        },
      );
      yield* readApplicationQueryIndex(opened.snapshot, "users", "by_name", {}, 10);
      return yield* readApplicationQueryIndex(
        opened.snapshot,
        "users",
        "by_name",
        {},
        10,
      );
    }))));
    expect(Result.isFailure(indexBudget)).toBe(true);
    if (Result.isFailure(indexBudget)) {
      expect(indexBudget.failure).toMatchObject({ reason: "budgetExceeded" });
    }

    const documentBudget = await runEffect(Effect.result(Effect.scoped(Effect.gen(function* () {
      const opened = yield* openApplicationQuerySnapshot(
        active.selection,
        "users:get",
        Object.freeze({ ...queryBudget(), maximumDocuments: 1 }),
        {
          deploymentId: fixture.input.deploymentId,
          controlDb: fixture.control.drizzle,
          authority: fixture.authorityPorts,
          schema: fixture.schema,
          developerIndexes: queryDeveloperIndexes(fixture),
        },
      );
      yield* readApplicationQueryIndex(opened.snapshot, "users", "by_name", {}, 10);
      return yield* readApplicationQueryPoint(
        opened.snapshot,
        "users",
        decodeAppDocumentIdV1(
          "1:11111111-1111-1111-1111-111111111111",
        ),
      );
    }))));
    expect(Result.isFailure(documentBudget)).toBe(true);
    if (Result.isFailure(documentBudget)) {
      expect(documentBudget.failure).toMatchObject({ reason: "budgetExceeded" });
    }

    const semanticBudget = await runEffect(Effect.result(Effect.scoped(Effect.gen(function* () {
      const opened = yield* openApplicationQuerySnapshot(
        active.selection,
        "users:get",
        Object.freeze({ ...queryBudget(), maximumSemanticBytes: 1 }),
        {
          deploymentId: fixture.input.deploymentId,
          controlDb: fixture.control.drizzle,
          authority: fixture.authorityPorts,
          schema: fixture.schema,
          developerIndexes: queryDeveloperIndexes(fixture),
        },
      );
      return yield* readApplicationQueryIndex(
        opened.snapshot,
        "users",
        "by_name",
        {},
        10,
      );
    }))));
    expect(Result.isFailure(semanticBudget)).toBe(true);
    if (Result.isFailure(semanticBudget)) {
      expect(semanticBudget.failure).toMatchObject({ reason: "budgetExceeded" });
    }

    const resolved = await fixture.authorityPorts.scopeClockTargets.resolve();
    const runner = Reflect.get(resolved, RUN_LOCATED_READ_COMMITTED_V1);
    if (typeof runner !== "function") {
      throw new Error("Expected the located query transaction runner.");
    }
    const runReadCommitted = runner as RunLocatedReadCommittedTransactionV1;
    let transactionStarts = 0;
    const observedTarget = Object.freeze({
      ...resolved,
      [RUN_LOCATED_READ_COMMITTED_V1]: <Value>(
        work: (tx: AppRowTransaction) => Promise<Value>,
      ): Promise<Value> => {
        transactionStarts += 1;
        return runReadCommitted(work);
      },
    });
    fixture.authorityPorts.scopeClockTargets.resolve = async () => observedTarget;
    const fanOut = await runEffect(Effect.scoped(Effect.gen(function* () {
      const opened = yield* openApplicationQuerySnapshot(
        active.selection,
        "users:get",
        Object.freeze({ ...queryBudget(), maximumDocuments: 1 }),
        {
          deploymentId: fixture.input.deploymentId,
          controlDb: fixture.control.drizzle,
          authority: fixture.authorityPorts,
          schema: fixture.schema,
          developerIndexes: queryDeveloperIndexes(fixture),
        },
      );
      yield* readApplicationQueryIndex(opened.snapshot, "users", "by_name", {}, 10);
      const startsBeforeFanOut = transactionStarts;
      const results = yield* Effect.all(
        Array.from({ length: 8 }, () => Effect.result(
          readApplicationQueryPoint(
            opened.snapshot,
            "users",
            decodeAppDocumentIdV1(
              "1:11111111-1111-1111-1111-111111111111",
            ),
          ),
        )),
        { concurrency: "unbounded" },
      );
      return { results, startsBeforeFanOut };
    })));
    expect(fanOut.results.every(Result.isFailure)).toBe(true);
    expect(transactionStarts).toBe(fanOut.startsBeforeFanOut);

    await fixture.target.drizzle.update(fxSystemIndexBuildStates).set({
      lifecycle: "validating",
      maintenanceActivationSequence: null,
    }).where(eq(fxSystemIndexBuildStates.scopeId, fixture.authority.scopeId));
    const unavailable = await runEffect(Effect.result(Effect.scoped(Effect.gen(function* () {
      const opened = yield* openApplicationQuerySnapshot(
        active.selection,
        "users:get",
        queryBudget(),
        {
          deploymentId: fixture.input.deploymentId,
          controlDb: fixture.control.drizzle,
          authority: fixture.authorityPorts,
          schema: fixture.schema,
          developerIndexes: queryDeveloperIndexes(fixture),
        },
      );
      return yield* readApplicationQueryIndex(
        opened.snapshot,
        "users",
        "by_name",
        {},
        10,
      );
    }))));
    expect(Result.isFailure(unavailable)).toBe(true);
    if (Result.isFailure(unavailable)) {
      expect(unavailable.failure).toMatchObject({ reason: "indexUnavailable" });
    }
  })
});
