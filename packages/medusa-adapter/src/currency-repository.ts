import type { CurrencyPromiseOwner } from "./currency-promise-owner";
import { Clock, Effect, Result } from "effect";
import { isNonArrayRecord } from "@flarex/utils/records";
import type { DAL } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, CommerceTransactionError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { decodeCurrencyQuery } from "./currency-query";
import type { CurrencyPredicate } from "./currency-query-model";
import { captureCurrencyInput, currencyWriteRows, serializeCurrency } from "./currency-values";

const projectFailure = (cause: unknown) => cause instanceof CommerceTransactionError ? cause : commerceError("adapterFailure", cause);
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
export function currencyRepository(root: CommerceCommandContext, owner: CurrencyPromiseOwner): DAL.RepositoryService {
  const contexts = new Map<unknown, CommerceCommandContext>([[root.manager, root]]);
  const select = Effect.fn("CurrencyRepository.select")(function* (shared: unknown): Effect.fn.Return<CommerceCommandContext, CommerceTransactionError> {
    const captured = yield* checked(root, Effect.fromResult(Result.try({
      try: () => {
        if (shared === null || typeof shared !== "object") return undefined;
        return { prototype: Object.getPrototypeOf(shared), transaction: Object.getOwnPropertyDescriptor(shared, "transactionManager"), manager: Object.getOwnPropertyDescriptor(shared, "manager") };
      }, catch: cause => commerceError("invalidAuthority", cause),
    })));
    if (captured === undefined || (captured.prototype !== Object.prototype && captured.prototype !== null) ||
      (captured.transaction !== undefined && !Object.hasOwn(captured.transaction, "value"))) return yield* root.refuse(commerceError("invalidAuthority"));
    // InjectManager preserves manager through a getter but supplies transactionManager
    // as own data. Prefer that authenticated token without invoking the unused getter.
    const selected = captured.transaction?.value == null ? captured.manager : captured.transaction;
    if (selected === undefined || !Object.hasOwn(selected, "value")) return yield* root.refuse(commerceError("invalidAuthority"));
    const manager: unknown = selected.value;
    const ctx = contexts.get(manager);
    if (ctx === undefined) return yield* root.refuse(commerceError("invalidAuthority"));
    return ctx;
  });
  const execute = <Value>(shared: unknown, work: (ctx: CommerceCommandContext) => Effect.Effect<Value, CommerceTransactionError>): Promise<Value> =>
    owner.run(Effect.gen(function* () {
      const ctx = yield* select(shared);
      return yield* work(ctx);
    }));
  const checked = <Value>(ctx: CommerceCommandContext, value: Effect.Effect<Value, CommerceTransactionError>) =>
    value.pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
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
    // SAFETY: Medusa declares caller-selected manager types; the returned opaque
    // token is authenticated again on every DAL call and nested entry.
    getFreshManager: <Manager>() => root.manager as Manager,
    getActiveManager: <Manager>() => root.manager as Manager,
    transaction: <Manager>(task: (manager: Manager) => Promise<unknown>, options?: { transaction?: Manager; manager?: unknown; isolationLevel?: string; enableNestedTransactions?: boolean }) => {
      return owner.run(Effect.gen(function* () {
        const fields = yield* checked(root, Effect.fromResult(captureTransactionOptions(options)));
        const ctx = yield* select({ manager: fields.transaction ?? fields.manager ?? root.manager });
        if ((fields.isolationLevel !== undefined && fields.isolationLevel !== "READ COMMITTED") ||
          (fields.enableNestedTransactions !== undefined && typeof fields.enableNestedTransactions !== "boolean")) return yield* ctx.refuse(commerceError("unsupportedProfile"));
        return yield* ctx.borrow(child => Effect.gen(function* () {
          contexts.set(child.manager, child);
          // SAFETY: the framework's generic manager contract is opaque at this
          // seam. Only this request's child token is supplied to the callback.
          return yield* Effect.tryPromise({ try: signal => owner.callback(() => task(child.manager as Manager), signal), catch: projectFailure })
            .pipe(Effect.ensuring(Effect.sync(() => { contexts.delete(child.manager); })));
        }));
      }));
    },
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

/** Reflection is the foreign boundary; manager values themselves stay opaque. */
function captureTransactionOptions(input: unknown): Result.Result<Readonly<Record<string, unknown>>, CommerceTransactionError> {
  return Result.gen(function* () {
    if (input === undefined) return {};
    const captured = yield* Result.try({
      try: () => {
        if (input === null || typeof input !== "object") return undefined;
        return { prototype: Object.getPrototypeOf(input), descriptors: Reflect.ownKeys(input).map(key => ({ key, descriptor: Object.getOwnPropertyDescriptor(input, key) })) };
      }, catch: cause => commerceError("invalidInput", cause),
    });
    if (captured === undefined || (captured.prototype !== Object.prototype && captured.prototype !== null)) return yield* Result.fail(commerceError("invalidInput"));
    const values: [string, unknown][] = [];
    for (const { key, descriptor } of captured.descriptors) {
      if (typeof key !== "string" || !["transaction", "manager", "isolationLevel", "enableNestedTransactions"].includes(key) ||
        descriptor === undefined || !Object.hasOwn(descriptor, "value")) return yield* Result.fail(commerceError("invalidInput"));
      values.push([key, descriptor.value]);
    }
    return Object.freeze(Object.fromEntries(values));
  });
}
