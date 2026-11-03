import { Effect, Result } from "effect";
import { expect, it } from "vitest";
import { AppCreationTimeV1Schema } from "flarex-protocol/app-document";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import type { JsonObject } from "flarex-protocol/json";
import { captureCommerceResources, defaultCommerceResources } from "../../../src/frameworks/commerceTransaction/resources";
import { makeBoundedRequestLifetime } from "../../../src/execution/preparation/boundedRequestLifetime";
import { decodeScopeClockRecord } from "../../../src/scope/scopeClock";
import { makeLogicalDocumentWorkingSet } from "../../../src/storage/documents/logicalDocuments/workingSet";
import { prepareRelatedRelationalPredicate, decodeRelatedRelationalQuery } from "../../../src/values/relatedRelationalPredicate";
import { prepareLogicalRelationalRead } from "../../../src/storage/documents/logicalDocuments/relationalQuery";
import { relatedPredicateParent, relatedPredicateChild, relatedQuery } from "./relatedRelationalPredicate.schema";
import { relatedPredicateNodes } from "./relatedPredicateBudget.programs";

const parent = relatedPredicateParent, child = relatedPredicateChild;
if (parent === undefined || child === undefined) throw new Error("Missing neutral related budget tables");
const error = (reason: string) => new Error(reason);
const prepare = (predicate: JsonObject, limit?: number) => prepareRelatedRelationalPredicate(parent, child, decodeCatalogTableId(2),
  Result.getOrThrow(decodeRelatedRelationalQuery(relatedQuery(predicate))), 8, error, limit);

it("keeps default 64/65 and explicitly selected 256/257 aggregate node boundaries", () => {
  expect(prepare(relatedPredicateNodes(64))).toMatchObject({ _tag: "Success" });
  expect(prepare(relatedPredicateNodes(65))).toMatchObject({ _tag: "Failure", failure: { message: "limitExceeded" } });
  expect(prepare(relatedPredicateNodes(256), 256)).toMatchObject({ _tag: "Success" });
  expect(prepare(relatedPredicateNodes(257), 256)).toMatchObject({ _tag: "Failure", failure: { message: "limitExceeded" } });
  expect(prepare(relatedPredicateNodes(188), 256)).toMatchObject({ _tag: "Success" });
  for (const limit of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 257])
    expect(prepare(relatedPredicateNodes(2), limit)).toMatchObject({ _tag: "Failure", failure: { message: "invalidInput" } });
});

it("retains the scalar node limit, aggregate depth and raw operand charges", () => {
  const scalar = (leaves: number): JsonObject => ({ kind: "and", children: Array.from({ length: leaves }, () =>
    ({ kind: "in", column: "attribute", values: ["threshold"] })) });
  expect(prepare({ kind: "parent", predicate: scalar(63) }, 256)).toMatchObject({ _tag: "Success" });
  expect(prepare({ kind: "parent", predicate: scalar(64) }, 256)).toMatchObject({ _tag: "Failure", failure: { message: "limitExceeded" } });
  expect(prepareLogicalRelationalRead(parent, [], { order: { column: "id", direction: "asc" }, predicate: scalar(64) }, 8, error))
    .toMatchObject({ _tag: "Failure", failure: { message: "limitExceeded" } });
  const operands = (count: number): JsonObject => ({ kind: "parent", predicate: { kind: "in", column: "attribute", values: Array.from({ length: count }, () => "threshold") } });
  expect(prepare({ kind: "and", children: [operands(128), operands(128)] }, 256)).toMatchObject({ _tag: "Success" });
  expect(prepare({ kind: "and", children: [operands(128), operands(129)] }, 256)).toMatchObject({ _tag: "Failure", failure: { message: "limitExceeded" } });
  let depth: JsonObject = relatedPredicateNodes(2);
  for (let index = 0; index < 7; index++) depth = { kind: "and", children: [depth] };
  expect(prepare(depth, 256)).toMatchObject({ _tag: "Success" });
  expect(prepare({ kind: "and", children: [depth] }, 256)).toMatchObject({ _tag: "Failure", failure: { message: "limitExceeded" } });
});

it("captures only valid optional trusted selections and refuses query-level escalation", () => {
  expect(Object.hasOwn(defaultCommerceResources, "relatedPredicateNodes")).toBe(false);
  const selected = { ...defaultCommerceResources, relatedPredicateNodes: 256 };
  const captured = Result.getOrThrow(captureCommerceResources(selected));
  selected.relatedPredicateNodes = 1;
  expect(captured.relatedPredicateNodes).toBe(256);
  expect(Object.isFrozen(captured)).toBe(true);
  expect(JSON.stringify(Result.getOrThrow(captureCommerceResources(defaultCommerceResources)))).toBe(JSON.stringify(defaultCommerceResources));
  for (const value of [null, undefined, 0, -1, 1.5, "256", Number.NaN, Number.POSITIVE_INFINITY, 257])
    expect(captureCommerceResources({ ...defaultCommerceResources, relatedPredicateNodes: value }))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  expect(decodeRelatedRelationalQuery({ ...relatedQuery(relatedPredicateNodes(65)), relatedPredicateNodes: 256 }))
    .toMatchObject({ _tag: "Failure" });
});

it("validates direct working-set selections before admission or storage", async () => {
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const clock = decodeScopeClockRecord({ scopeId: "scope_73100000-0000-4000-8000-000000000001", epoch: "epoch_related-budget",
      storageGeneration: "flarexdb_v1", storageGenerationFence: 1n, lastCommitSeq: 0n, lastMetadataSequence: 0n,
      oldestAvailableCommitSeq: 0n, updatedAt: new Date("2026-10-29T00:00:00Z") });
    const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(error, { calls: 8, commandBytes: 65_536, commandMs: 10_000 }, {}, {}, "related-budget-construction", "write"), owner => owner.close);
    let admissions = 0, reads = 0;
    const input = { scopeId: clock.scopeId, clock, lifetime,
      tables: [{ tableId: decodeCatalogTableId(1), logicalName: "parent", relational: parent }], relationalCapabilities: [],
      readTransaction: () => { reads++; return Effect.die("No storage needed for construction"); },
      requireAdmission: Effect.sync(() => { admissions++; }), validateDocument: () => Effect.void, error, uniqueConflict: () => error("uniqueConflict"),
      limits: { pageRows: 8, identities: 8, documentBytes: 8192 } };
    yield* makeLogicalDocumentWorkingSet({ ...input, relatedPredicateNodes: 256 }, AppCreationTimeV1Schema.make(1), [], []);
    expect(admissions).toBe(1); expect(reads).toBe(0);
    admissions = 0;
    for (const relatedPredicateNodes of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 257]) {
      const result = yield* Effect.result(makeLogicalDocumentWorkingSet({ ...input, relatedPredicateNodes }, AppCreationTimeV1Schema.make(1), [], []));
      expect(result).toMatchObject({ _tag: "Failure", failure: { message: "invalidInput" } });
    }
    expect(admissions).toBe(0); expect(reads).toBe(0);
  })));
});
