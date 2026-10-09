import { Effect } from "effect";
import { expect, it } from "vitest";
import { CatalogTableIdSchema } from "flarex-protocol/catalog";
import { makePreparedHostRuntime, retainPreparedHost } from "../../../src/execution/preparation/preparedHostRuntime";
import { prepareLogicalWriteMechanics, combineLogicalWriteMechanics } from "../../../src/storage/documents/logicalDocuments/workingSet";
import { runEffect } from "../../support/effectTestRuntime";

const failure = (reason: string, cause?: unknown) => new Error(reason, { cause });
const prepare = (ordinal: number) => prepareLogicalWriteMechanics({
  tables: [{ tableId: CatalogTableIdSchema.make(ordinal), logicalName: `table_${ordinal}` }], indexes: [], unique: [],
}, failure);

it("releases actual mechanics and ordered combination payloads after the last retired generation borrower", () =>
  runEffect(Effect.scoped(Effect.gen(function* () {
    const runtime = yield* makePreparedHostRuntime({ maximumHosts: 1, maximumPreparedBytes: 1_048_576 });
    const retained = yield* retainPreparedHost(runtime, prepare(1));
    const first = yield* retained.use(Effect.succeed);
    const secondGeneration = yield* retained.reconstruct(() => prepare(2));
    const thirdGeneration = yield* retained.reconstruct(() => prepare(3));
    const third = yield* thirdGeneration.use(Effect.succeed);
    const issued = yield* secondGeneration.use(second => Effect.gen(function* () {
      const pair = yield* combineLogicalWriteMechanics([first, second], failure);
      const triple = yield* combineLogicalWriteMechanics([first, second, third], failure);
      expect(yield* combineLogicalWriteMechanics([first, second], failure)).toBe(pair);
      expect(yield* combineLogicalWriteMechanics([first, second, third], failure)).toBe(triple);
      yield* secondGeneration.retire;
      // Retirement rejects new borrowers, while this actual borrower keeps all
      // original issuers and their combination usable through its callback exit.
      expect(yield* Effect.result(secondGeneration.use(Effect.succeed)))
        .toMatchObject({ _tag: "Failure", failure: { reason: "closed" } });
      expect(second.tableName(CatalogTableIdSchema.make(2))).toBe("table_2");
      expect(pair.tables).toHaveLength(2);
      expect(triple.tables).toHaveLength(3);
      expect(yield* combineLogicalWriteMechanics([first, second], failure)).toBe(pair);
      return { second, pair, triple };
    }));
    for (const disposed of [issued.second, issued.pair, issued.triple]) {
      expect(disposed.tables).toEqual([]);
      expect(disposed.indexes).toEqual([]);
      expect(disposed.unique).toEqual([]);
      expect(disposed.searchDefinitions).toEqual([]);
      expect(disposed.tableName(CatalogTableIdSchema.make(2))).toBeUndefined();
      expect(disposed.tableId("table_2")).toBeUndefined();
      expect(yield* Effect.result(combineLogicalWriteMechanics([disposed], failure)))
        .toMatchObject({ _tag: "Failure", failure: { message: "closed" } });
    }
    expect(first.tables).toHaveLength(1);
    expect(third.tables).toHaveLength(1);
    const replacementGeneration = yield* retained.reconstruct(() => prepare(2));
    const replacement = yield* replacementGeneration.use(Effect.succeed);
    const replacementPair = yield* combineLogicalWriteMechanics([first, replacement], failure);
    expect(replacementPair).not.toBe(issued.pair);
    expect(replacementPair.tables).toHaveLength(2);
    yield* replacementGeneration.retire;
    expect(replacementPair.tables).toEqual([]);
    yield* thirdGeneration.retire;
    yield* retained.close;
    expect(first.tables).toEqual([]);
    expect(third.tables).toEqual([]);
  }))));
