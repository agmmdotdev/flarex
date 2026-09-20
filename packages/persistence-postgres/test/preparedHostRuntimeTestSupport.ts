import { Effect, Exit, Scope } from "effect";
import {
  makePreparedHostRuntime,
  type PreparedHostRuntime,
} from "../src/preparedHostRuntime";

const fixtures = new WeakMap<
  object,
  { readonly runtime: PreparedHostRuntime; readonly scope: Scope.Closeable }
>();

/** The database fixture explicitly owns this scope and closes it before its
 * driver. All shop hosts on that fixture share the same capacity. */
export async function openPreparedHostTestRuntime(
  database: object,
): Promise<void> {
  if (fixtures.has(database))
    throw new Error("Fixture host runtime already open");
  const resource = await Effect.runPromise(
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const runtime = yield* makePreparedHostRuntime({
        maximumHosts: 128,
        maximumPreparedBytes: 134_217_728,
      }).pipe(
        Scope.provide(scope),
        Effect.onExit((exit) =>
          Exit.isFailure(exit) ? Scope.close(scope, exit) : Effect.void,
        ),
      );
      return { runtime, scope };
    }),
  );
  fixtures.set(database, resource);
}

export function preparedHostTestRuntime(database: object): PreparedHostRuntime {
  const resource = fixtures.get(database);
  if (resource === undefined)
    throw new Error("Database fixture has no open host runtime");
  return resource.runtime;
}

export async function closePreparedHostTestRuntime(
  database: object,
): Promise<void> {
  const resource = fixtures.get(database);
  if (resource === undefined) return;
  fixtures.delete(database);
  await Effect.runPromise(Scope.close(resource.scope, Exit.succeed(undefined)));
}
