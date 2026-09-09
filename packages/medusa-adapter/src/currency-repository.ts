import type { CommercePromiseOwner } from "./commerce-promise-owner";
import { commerceRepositoryContext } from "./commerce-repository-context";
import { Clock, Effect, Result } from "effect";
import { currencyUpdateRows } from "./currency-input";
import { currencyKeys } from "./currency-result";
import type { DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { decodeCurrencyQuery } from "./currency-query";
import { currencyReadCatalog, currencyReadProjection } from "./currency-read-profile";
import { compileProjection } from "./query/projection";
import { executeRead, type ReadPlan } from "./query/read";
import { captureCurrencyInput, currencyWriteRows, serializeCurrency } from "./currency-values";

function query(input: unknown) {
  return Result.gen(function* () {
    const value = yield* decodeCurrencyQuery(input ?? {});
    const catalog = yield* currencyReadCatalog;
    const projection = yield* compileProjection(catalog, "currency", value.fields, [], currencyReadProjection);
    return { table: "currency", projection, paths: [], relationFilters: [], ordering: new Map(), withDeleted: value.withDeleted,
      window: { kind: "database", countAt: "beforePopulation" },
      query: { fields: projection.storageFields, skip: value.skip, take: value.take,
        order: { column: "code", direction: value.order }, predicate: { kind: "and", children: [value.predicate,
          ...(value.withDeleted ? [] : [{ kind: "isNull", column: "deleted_at" }])] } },
    } satisfies ReadPlan;
  });
}

/** One repository per admitted command. Framework Promise methods borrow the
 * parent's cancellation signal and can never acquire or settle a transaction. */
export function currencyRepository(root: CommerceCommandContext, owner: CommercePromiseOwner): DAL.RepositoryService {
  const bridge = commerceRepositoryContext(root, owner);
  const { execute, checked } = bridge;
  const find = (input: unknown, shared: unknown) => execute(shared, ctx => Effect.gen(function* () {
    const plan = yield* checked(ctx, Effect.fromResult(query(input)));
    const catalog = yield* checked(ctx, Effect.fromResult(currencyReadCatalog));
    return (yield* executeRead(ctx, catalog, plan, false, ctx.store)).rows;
  }));
  const write = (mode: "insert" | "upsert" | "update", input: unknown, shared: unknown) => execute(shared, ctx => Effect.gen(function* () {
    const rows = yield* checked(ctx, currencyWriteRows(input));
    return [...yield* ctx.store.write(ctx.manager, mode, rows)];
  }));
  const selectedKeys = Effect.fn("CurrencyRepository.selectedKeys")(function* (ctx: CommerceCommandContext, input: unknown, withDeleted: boolean) {
    const captured = yield* checked(ctx, Effect.fromResult(captureCurrencyInput(input)));
    const where = typeof captured === "string" || Array.isArray(captured) ? { code: captured } : captured;
    const rows = yield* ctx.store.find(ctx.manager, (yield* checked(ctx, Effect.fromResult(query({ where, options: { fields: ["code"], filters: { softDeletable: { withDeleted } } } })))).query);
    return yield* checked(ctx, Effect.fromResult(currencyKeys(rows)));
  });
  const soft = (input: unknown, shared: unknown, restore: boolean) => execute(shared, ctx => Effect.gen(function* () {
    const keys = yield* selectedKeys(ctx, input, true);
    const deleted = restore ? null : new Date(yield* Clock.currentTimeMillis).toISOString();
    const rows = yield* ctx.store.write(ctx.manager, "update", keys.map(code => ({ code, deleted_at: deleted })));
    return [[...rows], { Currency: keys }] satisfies [JsonObject[], Record<string, unknown[]>];
  }));
  return {
    getFreshManager: bridge.getFreshManager,
    getActiveManager: bridge.getActiveManager,
    transaction: bridge.transaction,
    serialize: <Output extends object | object[]>(input: unknown, options?: unknown): Promise<Output> =>
      owner.run(Effect.gen(function* () {
        if (options !== undefined) return yield* root.refuse(commerceError("unsupportedProfile"));
        const value = yield* checked(root, serializeCurrency(input));
        if (value === null) return yield* root.refuse(commerceError("storedCorruption"));
        // SAFETY: selected Currency DTOs are checked by the serializer. Medusa's
        // generic signature also types partial projections as the full DTO.
        return value as Output;
      })),
    find: (input, shared) => find(input, shared),
    findAndCount: (input, shared) => execute(shared, ctx => Effect.gen(function* () {
      const selected = yield* checked(ctx, Effect.fromResult(query(input)));
      const catalog = yield* checked(ctx, Effect.fromResult(currencyReadCatalog));
      const result = yield* executeRead(ctx, catalog, selected, true, ctx.store);
      if (result.count === undefined) return yield* ctx.refuse(commerceError("storedCorruption"));
      return [result.rows, result.count] satisfies [JsonObject[], number];
    })),
    create: (rows: unknown[], shared) => write("insert", rows, shared),
    upsert: (rows: unknown[], shared) => write("upsert", rows, shared),
    update: (changes: unknown[], shared) => execute(shared, ctx => Effect.gen(function* () {
      const captured = yield* checked(ctx, Effect.fromResult(captureCurrencyInput(changes)));
      const rows = yield* checked(ctx, Effect.fromResult(currencyUpdateRows(captured)));
      return [...yield* ctx.store.write(ctx.manager, "update", yield* checked(ctx, currencyWriteRows(rows)))];
    })),
    delete: (input, shared) => execute(shared, ctx => Effect.gen(function* () {
      const rows = yield* ctx.store.delete(ctx.manager, yield* selectedKeys(ctx, input, true));
      return yield* checked(ctx, Effect.fromResult(currencyKeys(rows)));
    })),
    softDelete: (input, shared) => soft(input, shared, false),
    restore: (input, shared) => soft(input, shared, true),
    upsertWithReplace: () => owner.run(root.refuse(commerceError("unsupportedProfile"))),
  } satisfies DAL.RepositoryService;
}
