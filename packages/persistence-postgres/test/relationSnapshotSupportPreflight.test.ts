import { PGlite } from "@electric-sql/pglite";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  applyRelationEdgeTransitions,
  installRelationSnapshotPreflightSchema,
  makeRelationSnapshotPreflightDatabase,
  makeRelationSnapshotPreflightTransactionDatabase,
  readAdjacencyVersionIncomingPage,
  readHistoryIncomingPage,
  RelationSnapshotPreflightContractError,
  RelationSnapshotPreflightSqlError,
  type RelationEdgeOccurrence,
  type RelationEdgeTransition,
  type RelationIncomingPageInput,
  type RelationSnapshotPreflightDatabase,
  type RelationSnapshotPreflightTransactionDatabase,
} from "./relationSnapshotSupportPreflight";

describe("R01-P relation snapshot-support semantics", () => {
  it("freezes bounded pages, internal frontiers, and empty/exhausted meaning", async () => {
    await runPGliteProof(Effect.fn("R01P.pageSemantics")(function* ({
      database,
      applyTransition,
      applyTransitions,
    }) {
      yield* insertInitialEdges(applyTransitions);
      const firstInput = pageInput(100, 1, 2, null);

      const historyFirst = yield* readHistoryIncomingPage(database, firstInput);
      const adjacencyFirst = yield* readAdjacencyVersionIncomingPage(
        database,
        firstInput,
      );
      expect(historyFirst).toEqual({
        occurrences: [occurrenceProjection(10, 0, 100), occurrenceProjection(20, 0, 100)],
        consumedFrontier: frontier(20),
        exhausted: false,
        inspectedOccurrenceCount: 2,
      });
      expect(adjacencyFirst).toEqual({
        status: "success",
        expectedAdjacencyVersion: 1,
        page: historyFirst,
      });

      const secondInput = pageInput(
        100,
        1,
        2,
        historyFirst.consumedFrontier,
      );
      const historySecond = yield* readHistoryIncomingPage(database, secondInput);
      const adjacencySecond = yield* readAdjacencyVersionIncomingPage(
        database,
        secondInput,
      );
      expect(historySecond).toEqual({
        occurrences: [occurrenceProjection(30, 0, 100)],
        consumedFrontier: frontier(30),
        exhausted: true,
        inspectedOccurrenceCount: 1,
      });
      expect(adjacencySecond).toEqual({
        status: "success",
        expectedAdjacencyVersion: 1,
        page: historySecond,
      });

      const emptyInput = pageInput(999, 1, 2, null);
      expect(yield* readHistoryIncomingPage(database, emptyInput)).toEqual({
        occurrences: [],
        consumedFrontier: null,
        exhausted: true,
        inspectedOccurrenceCount: 0,
      });
      expect(yield* readAdjacencyVersionIncomingPage(database, emptyInput)).toEqual({
        status: "success",
        expectedAdjacencyVersion: 0,
        page: {
          occurrences: [],
          consumedFrontier: null,
          exhausted: true,
          inspectedOccurrenceCount: 0,
        },
      });

      const exactPageInput = pageInput(100, 1, 3, null);
      const exactHistoryPage = yield* readHistoryIncomingPage(
        database,
        exactPageInput,
      );
      expect(exactHistoryPage).toMatchObject({
        exhausted: true,
        inspectedOccurrenceCount: 3,
      });
      expect(yield* readAdjacencyVersionIncomingPage(
        database,
        exactPageInput,
      )).toMatchObject({
        status: "success",
        page: {
          exhausted: true,
          inspectedOccurrenceCount: 3,
        },
      });

      const ordinalZero = edge(40, 7, 400, 1, 0);
      const ordinalOne = edge(40, 2, 400, 1, 1);
      yield* applyTransitions([
        Object.freeze({ before: null, after: ordinalZero }),
        Object.freeze({ before: null, after: ordinalOne }),
      ]);
      const duplicateFirst = yield* readHistoryIncomingPage(
        database,
        pageInput(400, 2, 1, null),
      );
      expect(duplicateFirst).toEqual({
        occurrences: [occurrenceProjection(40, 7, 400, 0, 2)],
        consumedFrontier: frontier(40, 0),
        exhausted: false,
        inspectedOccurrenceCount: 1,
      });
      expect(yield* readAdjacencyVersionIncomingPage(
        database,
        pageInput(400, 2, 1, null),
      )).toMatchObject({ status: "success", page: duplicateFirst });

      const duplicateSecondInput = pageInput(
        400,
        2,
        1,
        duplicateFirst.consumedFrontier,
      );
      const duplicateSecond = yield* readHistoryIncomingPage(
        database,
        duplicateSecondInput,
      );
      expect(duplicateSecond).toEqual({
        occurrences: [occurrenceProjection(40, 2, 400, 1, 2)],
        consumedFrontier: frontier(40, 1),
        exhausted: true,
        inspectedOccurrenceCount: 1,
      });
      expect(yield* readAdjacencyVersionIncomingPage(
        database,
        duplicateSecondInput,
      )).toMatchObject({ status: "success", page: duplicateSecond });

      yield* applyTransition({
        before: ordinalOne,
        after: Object.freeze({ ...ordinalOne, position: 9 }),
      });
      const repositioned = yield* readHistoryIncomingPage(
        database,
        pageInput(400, 3, 1, frontier(40, 0)),
      );
      expect(repositioned.occurrences).toEqual([
        occurrenceProjection(40, 9, 400, 1, 3),
      ]);
      expect(yield* readAdjacencyVersionIncomingPage(
        database,
        pageInput(400, 3, 1, frontier(40, 0)),
      )).toMatchObject({
        status: "success",
        expectedAdjacencyVersion: 3,
        page: repositioned,
      });
    }));
  });

  it("reconstructs history while the current-edge candidate conflicts on an old snapshot", async () => {
    await runPGliteProof(Effect.fn("R01P.snapshotSemantics")(function* ({
      database,
      applyTransition,
      applyTransitions,
    }) {
      yield* insertInitialEdges(applyTransitions);
      yield* applyTransition({
        before: edge(10, 0, 100),
        after: edge(10, 0, 200),
      });

      const oldTargetAtOldSnapshot = pageInput(100, 1, 8, null);
      expect(
        (yield* readHistoryIncomingPage(database, oldTargetAtOldSnapshot))
          .occurrences.map(value => value.sourceDocumentId),
      ).toEqual([10, 20, 30]);
      expect(
        yield* readAdjacencyVersionIncomingPage(
          database,
          oldTargetAtOldSnapshot,
        ),
      ).toEqual({
        status: "conflict",
        reason: "newerThanSnapshot",
        beforeVersion: 2,
        afterVersion: 2,
      });

      const oldTargetAtCurrentSnapshot = pageInput(100, 2, 8, null);
      const historyCurrent = yield* readHistoryIncomingPage(
        database,
        oldTargetAtCurrentSnapshot,
      );
      const adjacencyCurrent = yield* readAdjacencyVersionIncomingPage(
        database,
        oldTargetAtCurrentSnapshot,
      );
      expect(historyCurrent.occurrences.map(value => value.sourceDocumentId))
        .toEqual([20, 30]);
      expect(historyCurrent.inspectedOccurrenceCount).toBe(3);
      expect(adjacencyCurrent).toMatchObject({
        status: "success",
        expectedAdjacencyVersion: 2,
        page: {
          occurrences: historyCurrent.occurrences,
          consumedFrontier: historyCurrent.consumedFrontier,
          exhausted: historyCurrent.exhausted,
          inspectedOccurrenceCount: 2,
        },
      });
    }));
  });

  it("detects present and absent endpoint races with the version handshake", async () => {
    await runPGliteProof(Effect.fn("R01P.readRace")(function* ({
      database,
      applyTransition,
      applyTransitions,
    }) {
      yield* insertInitialEdges(applyTransitions);

      const presentRace = yield* readAdjacencyVersionIncomingPage(
        database,
        pageInput(100, 1, 8, null),
        {
          afterPage: () => applyTransition({
            before: edge(10, 0, 100),
            after: edge(10, 0, 200),
          }),
        },
      );
      expect(presentRace).toEqual({
        status: "conflict",
        reason: "changedDuringRead",
        beforeVersion: 1,
        afterVersion: 2,
      });

      const absentRace = yield* readAdjacencyVersionIncomingPage(
        database,
        pageInput(300, 2, 8, null),
        {
          afterPage: () => applyTransition({
            before: null,
            after: edge(40, 0, 300),
          }),
        },
      );
      expect(absentRace).toEqual({
        status: "conflict",
        reason: "changedDuringRead",
        beforeVersion: 0,
        afterVersion: 3,
      });
    }));
  });

  it("bounds tombstone scans and distinguishes empty from exhausted", async () => {
    await runPGliteProof(Effect.fn("R01P.historyFrontier")(function* ({
      database,
      applyTransition,
      applyTransitions,
    }) {
      yield* insertInitialEdges(applyTransitions);
      yield* applyTransition({
        before: edge(10, 0, 100),
        after: edge(10, 0, 200),
      });
      yield* applyTransition({
        before: edge(20, 0, 100),
        after: null,
      });
      yield* applyTransition({
        before: edge(30, 0, 100),
        after: edge(30, 1, 100),
      });

      const first = yield* readHistoryIncomingPage(
        database,
        pageInput(100, 4, 1, null),
        1,
      );
      expect(first).toEqual({
        occurrences: [],
        consumedFrontier: frontier(10),
        exhausted: false,
        inspectedOccurrenceCount: 1,
      });
      const second = yield* readHistoryIncomingPage(
        database,
        pageInput(100, 4, 1, first.consumedFrontier),
        1,
      );
      expect(second).toEqual({
        occurrences: [],
        consumedFrontier: frontier(20),
        exhausted: false,
        inspectedOccurrenceCount: 1,
      });
      const third = yield* readHistoryIncomingPage(
        database,
        pageInput(100, 4, 1, second.consumedFrontier),
        1,
      );
      expect(third).toEqual({
        occurrences: [occurrenceProjection(30, 1, 100, 0, 4)],
        consumedFrontier: frontier(30),
        exhausted: true,
        inspectedOccurrenceCount: 1,
      });
      const terminalInput = pageInput(100, 4, 1, third.consumedFrontier);
      const terminal = yield* readHistoryIncomingPage(
        database,
        terminalInput,
        1,
      );
      expect(terminal).toEqual({
        occurrences: [],
        consumedFrontier: null,
        exhausted: true,
        inspectedOccurrenceCount: 0,
      });
      expect(yield* readAdjacencyVersionIncomingPage(
        database,
        terminalInput,
      )).toEqual({
        status: "success",
        expectedAdjacencyVersion: 4,
        page: terminal,
      });
    }));
  });

  it("keeps candidate writes rollback-safe and maps driver rejection once", async () => {
    await runPGliteProof(Effect.fn("R01P.rollback")(function* ({
      database,
      rollbackTransition,
    }) {
      yield* rollbackTransition({
        before: null,
        after: edge(50, 0, 500),
      });

      const empty = yield* readHistoryIncomingPage(
        database,
        pageInput(500, 1, 8, null),
      );
      expect(empty.occurrences).toEqual([]);
      expect(
        yield* readAdjacencyVersionIncomingPage(
          database,
          pageInput(500, 1, 8, null),
        ),
      ).toMatchObject({ status: "success", expectedAdjacencyVersion: 0 });

      const failure = yield* Effect.flip(database.query({
        owner: "edgeHistory",
        phase: "read",
        operation: "injected invalid proof query",
        sql: "select * from r01p_missing_relation",
      }));
      expect(failure).toBeInstanceOf(RelationSnapshotPreflightSqlError);
      expect(failure).toMatchObject({
        owner: "edgeHistory",
        phase: "read",
        operation: "injected invalid proof query",
      });
    }));
  });

  it("reports invalid page bounds and driver rows through the typed contract channel", async () => {
    const database = makeRelationSnapshotPreflightDatabase({
      query: async () => [],
    });
    const invalidBounds = await Effect.runPromise(Effect.flip(
      readAdjacencyVersionIncomingPage(
        database,
        pageInput(100, 1, 0, null),
      ),
    ));
    expect(invalidBounds).toBeInstanceOf(RelationSnapshotPreflightContractError);
    expect(invalidBounds).toMatchObject({ issue: "invalidPageBounds" });

    const invalidDriverResult = await Effect.runPromise(Effect.flip(
      readAdjacencyVersionIncomingPage(
        database,
        pageInput(100, 1, 1, null),
      ),
    ));
    expect(invalidDriverResult).toBeInstanceOf(
      RelationSnapshotPreflightContractError,
    );
    expect(invalidDriverResult).toMatchObject({ issue: "invalidDriverResult" });

    await runPGliteProof(Effect.fn("R01P.invalidInputs")(function* ({
      database: pgliteDatabase,
      applyTransition,
    }) {
      const invalidTransition = yield* Effect.flip(applyTransition({
        before: null,
        after: Object.freeze({ ...edge(80, 0, 800), position: -1 }),
      }));
      expect(invalidTransition).toMatchObject({ issue: "invalidTransition" });

      const invalidSnapshot = yield* Effect.flip(
        readAdjacencyVersionIncomingPage(
          pgliteDatabase,
          Object.freeze({ ...pageInput(800, 1, 1, null), snapshotCommitSeq: NaN }),
        ),
      );
      expect(invalidSnapshot).toMatchObject({ issue: "invalidPageInput" });

      const invalidFrontier = yield* Effect.flip(readHistoryIncomingPage(
        pgliteDatabase,
        pageInput(800, 1, 1, Object.freeze({
          sourceDocumentId: 0,
          duplicateOrdinal: 0,
        })),
      ));
      expect(invalidFrontier).toMatchObject({ issue: "invalidPageInput" });

      yield* pgliteDatabase.query({
        owner: "shared",
        phase: "provision",
        operation: "permit invalid scope clock proof fixture",
        sql: `alter table r01p_scope_clock
              drop constraint r01p_scope_clock_last_commit_seq_check`,
      });
      yield* pgliteDatabase.query({
        owner: "shared",
        phase: "seed",
        operation: "seed invalid scope clock proof fixture",
        sql: `insert into r01p_scope_clock (scope_id, last_commit_seq)
              values (1, -1)`,
      });
      const invalidCommitSequence = yield* Effect.flip(applyTransition({
        before: null,
        after: edge(81, 0, 810),
      }));
      expect(invalidCommitSequence).toMatchObject({ issue: "invalidDriverResult" });

      yield* pgliteDatabase.query({
        owner: "edgeHistory",
        phase: "provision",
        operation: "replace history table with malformed proof view",
        sql: "drop table r01p_edge_history",
      });
      yield* pgliteDatabase.query({
        owner: "edgeHistory",
        phase: "provision",
        operation: "create malformed history proof view",
        sql: `create view r01p_edge_history as
              select 1::integer as scope_id, 1::bigint as edge_definition_key,
                     80::bigint as source_document_id,
                     800::bigint as target_document_id,
                     0::integer as duplicate_ordinal,
                     0::integer as position, 1::bigint as commit_seq,
                     'false'::text as is_present`,
      });
      const malformedPresence = yield* Effect.flip(readHistoryIncomingPage(
        pgliteDatabase,
        pageInput(800, 1, 1, null),
      ));
      expect(malformedPresence).toMatchObject({ issue: "invalidDriverResult" });
    }));
  });

  it("isolates stale and replacement physical-definition keys", async () => {
    await runPGliteProof(Effect.fn("R01P.definitionIsolation")(function* ({
      database,
      applyTransition,
    }) {
      yield* applyTransition({
        before: null,
        after: edge(60, 0, 600, 1),
      });
      yield* applyTransition({
        before: null,
        after: edge(60, 0, 600, 2),
      });

      const oldDefinition = yield* readAdjacencyVersionIncomingPage(
        database,
        Object.freeze({ ...pageInput(600, 2, 8, null), edgeDefinitionKey: 1 }),
      );
      const replacementDefinition = yield* readAdjacencyVersionIncomingPage(
        database,
        Object.freeze({ ...pageInput(600, 2, 8, null), edgeDefinitionKey: 2 }),
      );
      expect(oldDefinition).toMatchObject({
        status: "success",
        expectedAdjacencyVersion: 1,
        page: { occurrences: [occurrenceProjection(60, 0, 600)] },
      });
      expect(replacementDefinition).toMatchObject({
        status: "success",
        expectedAdjacencyVersion: 2,
        page: { occurrences: [occurrenceProjection(60, 0, 600, 0, 2)] },
      });
      expect(yield* readAdjacencyVersionIncomingPage(
        database,
        Object.freeze({ ...pageInput(600, 1, 8, null), edgeDefinitionKey: 2 }),
      )).toMatchObject({
        status: "conflict",
        reason: "newerThanSnapshot",
      });

      yield* applyTransition({
        before: edge(60, 0, 600, 2),
        after: edge(60, 5, 600, 2),
      });
      const oldDefinitionAfterReplacementChange =
        yield* readAdjacencyVersionIncomingPage(
          database,
          Object.freeze({
            ...pageInput(600, 3, 8, null),
            edgeDefinitionKey: 1,
          }),
        );
      const replacementAfterChange = yield* readAdjacencyVersionIncomingPage(
        database,
        Object.freeze({ ...pageInput(600, 3, 8, null), edgeDefinitionKey: 2 }),
      );
      expect(oldDefinitionAfterReplacementChange).toMatchObject({
        status: "success",
        expectedAdjacencyVersion: 1,
        page: { occurrences: [occurrenceProjection(60, 0, 600)] },
      });
      expect(replacementAfterChange).toMatchObject({
        status: "success",
        expectedAdjacencyVersion: 3,
        page: { occurrences: [occurrenceProjection(60, 5, 600, 0, 3)] },
      });
      expect(yield* readHistoryIncomingPage(
        database,
        Object.freeze({ ...pageInput(600, 3, 8, null), edgeDefinitionKey: 1 }),
      )).toEqual(oldDefinitionAfterReplacementChange.status === "success"
        ? oldDefinitionAfterReplacementChange.page
        : null);
      expect(yield* readHistoryIncomingPage(
        database,
        Object.freeze({ ...pageInput(600, 3, 8, null), edgeDefinitionKey: 2 }),
      )).toEqual(replacementAfterChange.status === "success"
        ? replacementAfterChange.page
        : null);
    }));
  });
});

interface PGliteProofContext {
  readonly database: RelationSnapshotPreflightDatabase;
  readonly applyTransitions: (
    transitions: ReadonlyArray<RelationEdgeTransition>,
  ) => Effect.Effect<
    void,
    RelationSnapshotPreflightContractError | RelationSnapshotPreflightSqlError
  >;
  readonly applyTransition: (
    transition: RelationEdgeTransition,
  ) => Effect.Effect<
    void,
    RelationSnapshotPreflightContractError | RelationSnapshotPreflightSqlError
  >;
  readonly rollbackTransition: (
    transition: RelationEdgeTransition,
  ) => Effect.Effect<
    void,
    RelationSnapshotPreflightContractError | RelationSnapshotPreflightSqlError
  >;
}

function runPGliteProof<A, E>(
  proof: (
    context: PGliteProofContext,
  ) => Effect.Effect<A, E | RelationSnapshotPreflightSqlError>,
): Promise<A> {
  return Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const pglite = yield* Effect.acquireRelease(
      Effect.sync(() => new PGlite()),
      database => Effect.promise(() => database.close()),
    );
    const driver = {
      query: async <Row extends Readonly<Record<string, unknown>>>(
        sql: string,
        parameters: ReadonlyArray<unknown>,
      ) => {
        const result = await pglite.query<Row>(sql, [...parameters]);
        return result.rows;
      },
    };
    const database = makeRelationSnapshotPreflightDatabase(driver);
    const transactionDatabase =
      makeRelationSnapshotPreflightTransactionDatabase(driver);
    yield* installRelationSnapshotPreflightSchema(database);
    return yield* proof(Object.freeze({
      database,
      applyTransition: (transition: RelationEdgeTransition) => runPGliteTransition(
        database,
        transactionDatabase,
        [transition],
        "commit",
      ),
      applyTransitions: (transitions: ReadonlyArray<RelationEdgeTransition>) =>
        runPGliteTransition(
          database,
          transactionDatabase,
          transitions,
          "commit",
        ),
      rollbackTransition: (transition: RelationEdgeTransition) => runPGliteTransition(
        database,
        transactionDatabase,
        [transition],
        "rollback",
      ),
    }));
  })));
}

function runPGliteTransition(
  database: RelationSnapshotPreflightDatabase,
  transactionDatabase: RelationSnapshotPreflightTransactionDatabase,
  transitions: ReadonlyArray<RelationEdgeTransition>,
  disposition: "commit" | "rollback",
) {
  return Effect.gen(function* () {
    yield* database.query({
      owner: "shared",
      phase: "write",
      operation: "begin PGlite relation transition",
      sql: "begin",
    });
    yield* applyRelationEdgeTransitions(transactionDatabase, transitions);
    yield* database.query({
      owner: "shared",
      phase: "write",
      operation: `${disposition} PGlite relation transition`,
      sql: disposition,
    });
  }).pipe(
    Effect.ensuring(database.query({
      owner: "shared",
      phase: "write",
      operation: "clean up PGlite relation transition",
      sql: "rollback",
    }).pipe(Effect.catchCause(() => Effect.void))),
  );
}

const insertInitialEdges = Effect.fn("R01P.insertInitialEdges")(
  function* (
    applyTransitions: PGliteProofContext["applyTransitions"],
  ) {
    yield* applyTransitions([10, 20, 30].map(sourceDocumentId =>
      Object.freeze({
        before: null,
        after: edge(sourceDocumentId, 0, 100),
      })
    ));
  },
);

function edge(
  sourceDocumentId: number,
  position: number,
  targetDocumentId: number,
  edgeDefinitionKey = 1,
  duplicateOrdinal = 0,
): RelationEdgeOccurrence {
  return Object.freeze({
    scopeId: 1,
    edgeDefinitionKey,
    sourceDocumentId,
    targetDocumentId,
    duplicateOrdinal,
    position,
  });
}

function pageInput(
  targetDocumentId: number,
  snapshotCommitSeq: number,
  pageSize: number,
  consumedFrontier: RelationIncomingPageInput["consumedFrontier"],
): RelationIncomingPageInput {
  return Object.freeze({
    scopeId: 1,
    edgeDefinitionKey: 1,
    targetDocumentId,
    snapshotCommitSeq,
    pageSize,
    consumedFrontier,
  });
}

function occurrenceProjection(
  sourceDocumentId: number,
  position: number,
  targetDocumentId: number,
  duplicateOrdinal = 0,
  commitSeq = 1,
) {
  return {
    sourceDocumentId,
    targetDocumentId,
    duplicateOrdinal,
    position,
    commitSeq,
  };
}

function frontier(sourceDocumentId: number, duplicateOrdinal = 0) {
  return {
    sourceDocumentId,
    duplicateOrdinal,
  };
}
