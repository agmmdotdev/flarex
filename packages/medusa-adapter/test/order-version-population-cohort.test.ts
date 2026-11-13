import { Effect, Option, Result } from "effect";
import { beforeAll, expect, it } from "vitest";
import { commerceError, defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { compileRelationalRead } from "../../persistence-postgres/src/values/relationalQuery";
import { compileOrderDefinition } from "../src/modules/order/schema";
import { orderFinanceVersionFilters } from "../src/modules/order/finance-query";
import { commerceRelationReadQuery, prepareCommerceRelationPopulation } from "../src/query/relations";

let definition: Effect.Success<ReturnType<typeof compileOrderDefinition>>;
beforeAll(async () => { definition = await Effect.runPromise(compileOrderDefinition("generate")); });

const compile = (parents: readonly { id: string; version: number }[]) => {
  const filters = Result.getOrThrow(orderFinanceVersionFilters("order", ["summary"], parents));
  const predicate = filters[0]?.predicate;
  const population = Result.getOrThrow(prepareCommerceRelationPopulation(["order_id"], parents, ["id"], true, false, predicate));
  const table = definition.schema.tables.find(table => table.identity.tableId === "order_summary");
  if (table === undefined || Option.isNone(population)) throw new Error("Missing actual native summary population");
  return compileRelationalRead(table, commerceRelationReadQuery(defaultCommerceResources, population.value.predicate),
    defaultCommerceResources.queryRows, commerceError);
};

it("admits the actual fifty-parent Order version-population producer within existing query limits", () => {
  const parents = Array.from({ length: 50 }, (_, index) => ({ id: "order-page-" + index, version: 1 }));
  expect(compile(parents)).toMatchObject({ _tag: "Success" });
});

it("preserves exact parent/version pairs across shared version groups", () => {
  const compiled = Result.getOrThrow(compile([
    { id: "order-one", version: 1 }, { id: "order-two", version: 3 }, { id: "order-three", version: 1 },
  ]));
  // Use the real shared predicate compiler's inspector, without duplicating a
  // predicate evaluator. Storage row validation remains covered by DB fixtures.
  const matches = (order_id: string, version: number) => Result.getOrThrow(compiled.inspect({ id: "summary-row", order_id, version, deleted_at: null })).matches;
  expect(matches("order-one", 1)).toBe(true);
  expect(matches("order-three", 1)).toBe(true);
  expect(matches("order-two", 3)).toBe(true);
  expect(matches("order-one", 3)).toBe(false);
  expect(matches("order-three", 3)).toBe(false);
  expect(matches("order-two", 1)).toBe(false);
  expect(matches("other-order", 1)).toBe(false);
});
