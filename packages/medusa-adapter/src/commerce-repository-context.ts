import { Effect, Result } from "effect";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommercePromiseOwner } from "./commerce-promise-owner";
const projectFailure = (cause: unknown) => cause instanceof CommerceTransactionError ? cause : commerceError("adapterFailure", cause);
export function commerceRepositoryContext(root: CommerceCommandContext, owner: CommercePromiseOwner) {
  const contexts = new Map<unknown, CommerceCommandContext>([[root.manager, root]]);
  let active = root;
  const select = Effect.fn("CommerceRepository.select")(function* (shared: unknown): Effect.fn.Return<CommerceCommandContext, CommerceTransactionError> {
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
  return { execute, checked, select, current: () => active,
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
          const parent = active;
          active = child;
          contexts.set(child.manager, child);
          // SAFETY: the framework's generic manager contract is opaque at this
          // seam. Only this request's child token is supplied to the callback.
          return yield* Effect.tryPromise({ try: signal => owner.callback(() => task(child.manager as Manager), signal), catch: projectFailure })
            .pipe(Effect.ensuring(Effect.sync(() => { contexts.delete(child.manager); active = parent; })));
        }));
      }));
    },
  };
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
