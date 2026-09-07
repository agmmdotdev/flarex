import type { CommercePromiseOwner } from "./commerce-promise-owner";
import { commerceRepositoryContext } from "./commerce-repository-context";
import { Clock, Effect } from "effect";
import { isNonArrayRecord } from "@flarex/utils/records";
import type { DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { decodeCurrencyQuery } from "./currency-query";
import type { CurrencyPredicate } from "./currency-query-model";
import { captureCurrencyInput, currencyWriteRows, serializeCurrency } from "./currency-values";

const translatePredicate = (predicate: CurrencyPredicate): JsonObject => predicate.kind === "codes"
  ? { kind: "in", column: "code", values: predicate.values }
  : { kind: predicate.kind, children: predicate.children.map(translatePredicate) };
const query = Effect.fn("CurrencyRepository.query")(function* (input: unknown) {
  const captured = yield* Effect.fromResult(captureCurrencyInput(input ?? {}));
  const value = yield* Effect.fromResult(decodeCurrencyQuery(captured));
  return { fields: value.fields, skip: value.skip, take: value.take,
    order: { column: "code", direction: value.order }, predicate: { kind: "and", children: [translatePredicate(value.predicate),
      ...(value.withDeleted ? [] : [{ kind: "isNull", column: "deleted_at" }])] } } satisfies JsonObject;
});

/** One repository per admitted command. Framework Promise methods borrow the
 * parent's cancellation signal and can never acquire or settle a transaction. */
export function currencyRepository(root: CommerceCommandContext, owner: CommercePromiseOwner): DAL.RepositoryService {
  const bridge = commerceRepositoryContext(root, owner);
  const { execute, checked } = bridge;
  const find = (input: unknown, shared: unknown) => execute(shared, ctx => Effect.gen(function* () {
    const rows = yield* ctx.store.find(ctx.manager, yield* checked(ctx, query(input)));
    return [...rows];
  }));
  const write = (mode: "insert" | "upsert" | "update", input: unknown, shared: unknown) => execute(shared, ctx => Effect.gen(function* () {
    const rows = yield* checked(ctx, currencyWriteRows(input));
    return [...yield* ctx.store.write(ctx.manager, mode, rows)];
  }));
  const selectedKeys = Effect.fn("CurrencyRepository.selectedKeys")(function* (ctx: CommerceCommandContext, input: unknown, withDeleted: boolean) {
    const captured = yield* checked(ctx, Effect.fromResult(captureCurrencyInput(input)));
    const where = typeof captured === "string" || Array.isArray(captured) ? { code: captured } : captured;
    const rows = yield* ctx.store.find(ctx.manager, yield* checked(ctx, query({ where, options: { fields: ["code"], filters: { softDeletable: { withDeleted } } } })));
    const keys: string[] = [];
    for (const row of rows) {
      if (typeof row.code !== "string") return yield* ctx.refuse(commerceError("storedCorruption"));
      keys.push(row.code);
    }
    return keys;
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
      const selected = yield* checked(ctx, query(input));
      const rows = yield* ctx.store.find(ctx.manager, selected);
      const count = yield* ctx.store.count(ctx.manager, selected);
      return [[...rows], count] satisfies [JsonObject[], number];
    })),
    create: (rows: unknown[], shared) => write("insert", rows, shared),
    upsert: (rows: unknown[], shared) => write("upsert", rows, shared),
    update: (changes: unknown[], shared) => execute(shared, ctx => Effect.gen(function* () {
      const captured = yield* checked(ctx, Effect.fromResult(captureCurrencyInput(changes)));
      if (!Array.isArray(captured)) return yield* ctx.refuse(commerceError("invalidInput"));
      const rows: unknown[] = [];
      for (const change of captured) {
        if (!isNonArrayRecord(change) || !isNonArrayRecord(change.entity) || !isNonArrayRecord(change.update) || typeof change.entity.code !== "string" || "code" in change.update) return yield* ctx.refuse(commerceError("invalidInput"));
        rows.push({ ...change.update, code: change.entity.code });
      }
      return [...yield* ctx.store.write(ctx.manager, "update", yield* checked(ctx, currencyWriteRows(rows)))];
    })),
    delete: (input, shared) => execute(shared, ctx => Effect.gen(function* () {
      const rows = yield* ctx.store.delete(ctx.manager, yield* selectedKeys(ctx, input, true));
      const keys: string[] = [];
      for (const row of rows) { if (typeof row.code !== "string") return yield* ctx.refuse(commerceError("storedCorruption")); keys.push(row.code); }
      return keys;
    })),
    softDelete: (input, shared) => soft(input, shared, false),
    restore: (input, shared) => soft(input, shared, true),
    upsertWithReplace: () => owner.run(root.refuse(commerceError("unsupportedProfile"))),
  } satisfies DAL.RepositoryService;
}
