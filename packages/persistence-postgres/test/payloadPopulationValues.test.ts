import { expect, it } from "vitest";
import { Result } from "effect";
import { makePayloadPopulation, payloadPopulationIds } from "../../payload-adapter/src/testing";
import { payloadRelationConfiguration } from "../../payload-adapter/src/conformanceProfile";

import { makePayloadCollectionRuntime } from "../../payload-adapter/src/collectionRuntime";

const posts = makePayloadCollectionRuntime(payloadRelationConfiguration.tables[0]!);
const population = () => makePayloadPopulation("payload.content-relations", posts);

it("binds renamed references to their logical target and gives scalar targets no outgoing evidence", () => {
  const relation = payloadRelationConfiguration.tables[0]!.fields.find(field => field.kind === "relationship");
  if (relation?.kind !== "relationship" || relation.cardinality !== "one") throw new Error("Missing optional-one metadata");
  const articles = makePayloadCollectionRuntime({ collectionSlug: "articles", logicalTableName: "articles", timestamps: false,
    fields: [{ ...relation, name: "editor", target: "article_authors" }] });
  const authors = makePayloadCollectionRuntime({ collectionSlug: "article-authors", logicalTableName: "article_authors", timestamps: false,
    fields: [{ name: "name", kind: "text" }] });
  const ledger = makePayloadPopulation("payload.content-relations", articles);
  Result.getOrThrow(ledger.roots([{ id: "root", editor: "target", relatedPost: "not-a-reference" }]));
  expect(ledger.admit("article_authors", ["target"])).toMatchObject({ _tag: "Success" });
  for (const [table, ids] of [["article-authors", ["target"]], ["articles", ["target"]], ["article_authors", ["not-a-reference"]]] as const) {
    expect(ledger.admit(table, ids)).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
  }
  expect(ledger.outputBytes("articles", ["target"], [{ id: "target" }])).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
  const scalar = makePayloadPopulation("payload.content-relations", authors);
  Result.getOrThrow(scalar.roots([{ id: "target", name: "Ada", editor: "invented", relatedPost: "invented" }]));
  expect(scalar.admit("articles", ["invented"])).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
});

it("admits only the pinned bounded batch grammar", () => {
  expect(Result.getOrThrow(payloadPopulationIds({ and: [{ id: { in: ["a", "b"] } }] }))).toEqual(["a", "b"]);
  expect(Result.getOrThrow(payloadPopulationIds({ id: { equals: "a" } }))).toBeNull();
  for (const ids of [[], ["a", "a"], [1], [{ id: "a" }], new Array(1)]) {
    expect(payloadPopulationIds({ id: { in: ids } })).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
  }
  expect(payloadPopulationIds({ id: { in: Array.from({ length: 33 }, (_, i) => String(i)) } })).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  expect(payloadPopulationIds({ id: { in: ["a"] }, title: { equals: "x" } })).toMatchObject({ _tag: "Failure" });
});

it("keeps reference admission and repeated-output accounting request-local", () => {
  const first = population();
  const second = population();
  expect(first.admit("posts", ["a"])).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
  Result.getOrThrow(first.roots([{ id: "root1", relatedPost: "a" }, { id: "root2", relatedPost: "a" }]));
  expect(Result.getOrThrow(first.admit("posts", ["a"]))).toBeUndefined();
  expect(first.admit("authors", ["a"])).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
  expect(first.admit("posts", ["b"])).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
  expect(second.admit("posts", ["a"])).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
  expect(first.roots([])).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
  expect(first.outputBytes("posts", ["a"], [null])).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption", cause: { reason: "relationTargetMissing", documentId: "a" } } });
  expect(first.outputBytes("posts", ["a"], [])).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
  const small = Result.getOrThrow(first.outputBytes("posts", ["a"], [{ id: "a", title: "x" }]));
  const larger = Result.getOrThrow(first.outputBytes("posts", ["a"], [{ id: "a", title: "xx" }]));
  expect(larger - small).toBe(2);
});

it("reserves limits before expanding a shared target into every root", () => {
  const ledger = population();
  Result.getOrThrow(ledger.roots(Array.from({ length: 32 }, (_, i) => ({ id: String(i), relatedPost: "a" }))));
  expect(ledger.outputBytes("posts", ["a"], [{ id: "a", title: "x".repeat(40_000) }])).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  expect(population().roots(Array.from({ length: 33 }, (_, i) => ({ id: String(i), relatedPost: String(i) })))).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  expect(population().roots([{ id: "root", relatedPost: 1 }])).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
});
