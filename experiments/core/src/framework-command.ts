import { randomUUID } from "node:crypto";
import { Effect, type Schema } from "effect";
import type { Definition } from "./definition.ts";
import { CoreError } from "./errors.ts";
import { createGroupRoot, type GroupError, type GroupRoot } from "./group-root.ts";
import { createGroupStorage } from "./group-storage.ts";
import type { Persistence } from "./persistence.ts";
import { supervise } from "./callback.ts";

export interface FrameworkCall<A extends Schema.Json> {
  readonly digest: string;
  readonly run: (participants: Pick<GroupRoot, "withFramework">, transaction: string) => Effect.Effect<A, GroupError>;
  readonly decode: (value: unknown) => Effect.Effect<A, CoreError>;
  readonly authorize: () => Effect.Effect<void, GroupError>;
}

/** Direct framework profile only. Native bridges borrow selected roots; this
 * trusted outer owner alone settles, resolves uncertain acceptance and aborts.
 * Application retry/OCC remains with its distinct owner. */
export const createFrameworkCommands = Effect.fn("ExperimentFramework.commands")(function* (
  persistence: Persistence, scope: string, definitions: readonly Definition[],
) {
  const selected = Object.freeze([...definitions]); const storage = createGroupStorage(persistence); const owner = yield* Effect.scope;
  let live = true; yield* Effect.addFinalizer(() => Effect.sync(() => { live = false; }));
  const execute = Effect.fn("ExperimentFramework.execute")(function* <A extends Schema.Json>(request: string, call: FrameworkCall<A>) {
    if (!live) return yield* Effect.fail(new CoreError({ reason: "closed" }));
    const invocation = Object.freeze({ ...call });
    const command = yield* storage.openFramework(scope, request, invocation.digest, selected, randomUUID());
    const decode = (value: unknown) => invocation.decode(value).pipe(Effect.mapError(cause => new CoreError({ reason: "storage", cause })));
    if (command.status === "committed") {
      const result = yield* decode(command.result); yield* invocation.authorize(); return result;
    }
    let accepting = false;
    return yield* Effect.gen(function* () {
      const group = yield* createGroupRoot(persistence, command, selected);
      return yield* Effect.gen(function* () {
        const result = yield* invocation.run({ withFramework: group.withFramework }, command.id);
        const candidates = yield* group.freeze(); accepting = true;
        const committed = yield* storage.accept(command, candidates, result).pipe(Effect.catchTag("CoreError", error => {
          if (error.reason !== "storage" || error.phase !== undefined && error.phase !== "commit") { accepting = false; return Effect.fail(error); }
          return storage.resolve(scope, request, invocation.digest).pipe(Effect.catchTag("CoreError", recovery =>
            Effect.fail(new CoreError({ reason: "uncertain", cause: { original: error, recovery } }))));
        }));
        return yield* decode(committed);
      }).pipe(Effect.onExit(() => group.close));
    }).pipe(Effect.onExit(() => accepting ? Effect.void : storage.abort(command)));
  });
  return { execute: <A extends Schema.Json>(request: string, call: FrameworkCall<A>) => supervise(owner, execute(request, call)) };
});
