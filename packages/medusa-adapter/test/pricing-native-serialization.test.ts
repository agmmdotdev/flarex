import { afterEach, describe, expect, it, vi } from "vitest";
import { Effect, Result } from "effect";
import { PricingModuleService } from "@medusajs/pricing/services";
import { commerceError, commerceLimits, defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeBoundedRequestLifetime } from "../../persistence-postgres/src/execution/preparation/boundedRequestLifetime";
import { makeCommerceCommandContext } from "../../persistence-postgres/src/frameworks/commerceTransaction/context";
import { makeLocalPricingCommands } from "../src/modules/pricing/service";
import { decodeStorePriceSetCount } from "../src/modules/pricing/store-read";
import { mockRelationalRead } from "./mock-relational-read";

const price = { id: "p", price_list_id: null, price_list_type: null, min_quantity: null, max_quantity: null };
const dto = { id: "s", is_calculated_price_price_list: false, is_calculated_price_tax_inclusive: false,
  calculated_amount: 10, raw_calculated_amount: { value: "10", precision: 20 }, is_original_price_price_list: false,
  is_original_price_tax_inclusive: false, original_amount: 10, raw_original_amount: { value: "10", precision: 20 },
  currency_code: "usd", calculated_price: price, original_price: price };

afterEach(() => vi.restoreAllMocks());

describe("native Pricing serializer ownership", () => {
  it.each([false, true])("lets native listAndCountPriceSets attach its DTO after a calculated-only partial read (match=%s)", async match => {
    const rows = Object.freeze([Object.freeze({ id: "s" })]);
    const calculate = vi.spyOn(PricingModuleService.prototype, "calculatePrices").mockResolvedValue(match ? [dto] : []);
    const reads: unknown[] = [];
    const result = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const pricing = yield* makeLocalPricingCommands("store-product-read");
      const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(reason => commerceError(reason), commerceLimits,
        {}, {}, "native-pricing-serializer", "read"), current => current.close);
      const unused = () => Effect.fail(commerceError("unsupportedProfile"));
      const store = { prepareRead(query: unknown) { return mockRelationalRead(this, query); },
        find: (_manager: unknown, query: unknown) => { reads.push(query); return Effect.succeed(rows); },
        count: () => Effect.succeed(1), findPage: unused, aggregate: unused, write: unused, delete: unused, lifecycle: unused };
      const root = makeCommerceCommandContext(lifetime, { resources: defaultCommerceResources, store,
        table: (_manager, name) => name === "price_set" ? Effect.succeed(store) : unused(),
      }, "native-pricing-serializer", lifetime.context, unused, unused);
      return yield* pricing.withService(root, async ({ service, context }) => {
        const result = await service.listAndCountPriceSets({ id: ["s"], context: { currency_code: "usd" } },
          { select: ["id"], relations: ["calculated_price"], take: 4 }, context);
        expect(Object.isFrozen(result[0][0])).toBe(false);
        if (match) expect(result[0][0]?.calculated_price).not.toBe(dto);
        return result;
      });
    })));
    expect(result).toEqual([[{ id: "s", calculated_price: match ? dto : null }], 1]);
    expect(Result.getOrThrow(decodeStorePriceSetCount(result, true))).toEqual(result);
    expect(calculate).toHaveBeenCalledTimes(1);
    expect(calculate).toHaveBeenCalledWith({ id: ["s"] }, { context: { currency_code: "usd" } }, expect.any(Object));
    expect(reads).toHaveLength(1);
    expect(reads[0]).toMatchObject({ fields: ["id"] });
    expect(rows).toEqual([{ id: "s" }]);
    expect(Object.isFrozen(rows[0])).toBe(true);
  });
});
