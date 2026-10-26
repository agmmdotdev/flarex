import { Cause, Effect, Ref, Schema } from "effect";
import type { Definition } from "./definition.ts";
import { CoreError } from "./errors.ts";
import type { BorrowedFrameworkRoot, GroupError } from "./group-root.ts";
import type { Persistence } from "./persistence.ts";
import { createStorage } from "./storage.ts";
import { createBudget } from "./budget.ts";
import { TextEquality } from "./query.ts";
import { captureJsonInput } from "./value.ts";

export type FrameworkReader = Pick<BorrowedFrameworkRoot, "get" | "equalRows" | "poison" | "poisonCause">;
const decodeSelection = Schema.decodeUnknownEffect(TextEquality);

/** One complete framework point/equality read, without a command or pending
 * journal. The native binding owns its complete Promise lifetime. Multiple DAL
 * acquisitions are refused rather than silently switching observation times. */
export function createFrameworkReads(persistence: Persistence) {
  const storage = createStorage(persistence);
  const withRead = Effect.fn("ExperimentFramework.read")(function* <A, E extends GroupError>(scope: string, definition: Definition,
    use: (reader: FrameworkReader) => Effect.Effect<A, E>) {
    const state = yield* Ref.make<{ live: boolean; used: boolean; failure: Cause.Cause<CoreError> | null }>({ live: true, used: false, failure: null });
    const budget = createBudget();
    const poisonCause = (cause: Cause.Cause<CoreError>) => Ref.update(state, prior => prior.live ? { ...prior, failure: prior.failure ?? cause } : prior);
    const run = Effect.fn("ExperimentFramework.readOperation")(function* <B>(work: Effect.Effect<B, CoreError>) {
      const before = yield* Ref.getAndUpdate(state, prior => prior.live && prior.failure === null ? { ...prior, used: true } : prior);
      if (!before.live) return yield* Effect.fail(new CoreError({ reason: "closed" }));
      if (before.failure !== null) return yield* Effect.failCause(before.failure);
      if (before.used) return yield* Effect.fail(new CoreError({ reason: "unsupported" }));
      return yield* work;
    }, effect => effect.pipe(Effect.tapCause(poisonCause)));
    const equalRows = Effect.fn("ExperimentFramework.readEquality")(function* (selection: TextEquality) {
      const captured = yield* Effect.fromResult(captureJsonInput(selection, true));
      const decoded = yield* decodeSelection(captured, { onExcessProperty: "error" }).pipe(
        Effect.mapError(cause => new CoreError({ reason: "invalid", cause })));
      const normalized = { ...decoded, keys: [...new Set(decoded.keys)].toSorted() };
      const acquired = yield* storage.readEqualityRows(scope, definition, normalized, budget.remainingReads(), budget.remainingBytes());
      yield* Effect.fromResult(budget.read(acquired.bytes, acquired.examined));
      return yield* Effect.forEach(acquired.rows, row => row.body === null
        ? Effect.fail(new CoreError({ reason: "storage" })) : definition.decode(row.body));
    });
    const reader: FrameworkReader = {
      get: id => run(storage.read(scope, definition, id).pipe(Effect.flatMap(body => body === null ? Effect.succeed(null) : definition.decode(body)),
        Effect.tap(body => Effect.fromResult(budget.read(body === null ? 0 : Buffer.byteLength(JSON.stringify(body)), 1))))),
      equalRows: selection => run(equalRows(selection)),
      poison: error => poisonCause(Cause.fail(error)), poisonCause,
    };
    return yield* Effect.suspend(() => use(reader)).pipe(Effect.tap(() => Ref.get(state).pipe(Effect.flatMap(prior => prior.failure === null
      ? Effect.void : Effect.failCause(prior.failure)))), Effect.onExit(() => Ref.update(state, prior => ({ ...prior, live: false }))));
  });
  return { withRead };
}
