import { expect, it } from "vitest";
import { Result } from "effect";
import { makePayloadPopulation, payloadPopulationIds } from "../../payload-adapter/src/testing";

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
  const first = makePayloadPopulation();
  const second = makePayloadPopulation();
  expect(first.admit(["a"])).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
  Result.getOrThrow(first.roots([{ id: "root1", relatedPost: "a" }, { id: "root2", relatedPost: "a" }]));
  expect(Result.getOrThrow(first.admit(["a"]))).toBeUndefined();
  expect(first.admit(["b"])).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
  expect(second.admit(["a"])).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
  expect(first.roots([])).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
  expect(first.outputBytes(["a"], [null])).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption", cause: { reason: "relationTargetMissing", documentId: "a" } } });
  expect(first.outputBytes(["a"], [])).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
  const small = Result.getOrThrow(first.outputBytes(["a"], [{ id: "a", title: "x" }]));
  const larger = Result.getOrThrow(first.outputBytes(["a"], [{ id: "a", title: "xx" }]));
  expect(larger - small).toBe(2);
});

it("reserves limits before expanding a shared target into every root", () => {
  const population = makePayloadPopulation();
  Result.getOrThrow(population.roots(Array.from({ length: 32 }, (_, i) => ({ id: String(i), relatedPost: "a" }))));
  expect(population.outputBytes(["a"], [{ id: "a", title: "x".repeat(40_000) }])).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  expect(makePayloadPopulation().roots(Array.from({ length: 33 }, (_, i) => ({ id: String(i), relatedPost: String(i) })))).toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
  expect(makePayloadPopulation().roots([{ id: "root", relatedPost: 1 }])).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
});
