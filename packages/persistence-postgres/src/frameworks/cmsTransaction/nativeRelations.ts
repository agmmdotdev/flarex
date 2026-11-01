import { Cause, Effect } from "effect";
import type { CoreNativeOperations } from "../../core/api";
import type { CmsRequestLifetime } from "./lifetime";
import { cmsError } from "./model";
import { projectCoreCmsFailure } from "./nativeFailure";
import type { CmsRelations } from "./relations";

/** Core authenticates endpoints, owns the index observation and bounds the scan. */
export function makeNativeCmsRelations(operations: CoreNativeOperations, lifetime: CmsRequestLifetime): CmsRelations {
  return Object.freeze({ incoming: Effect.fn("NativeCmsRelations.incoming")((context, id, source, target, limit) => lifetime.operation(context, id, "read",
    Effect.gen(function* () {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 16) return yield* Effect.fail(cmsError("invalidInput"));
      const page = yield* operations.incomingReferences(source, target, { limit }).pipe(
        Effect.catchCause(cause => Effect.failCause(Cause.map(cause, projectCoreCmsFailure))));
      yield* lifetime.fromResult(lifetime.charge(page.ids.reduce((bytes, value) => bytes + value.length * 4 + 64, 64)));
      return Object.freeze({ docs: Object.freeze([...page.ids]), hasNextPage: page.hasMore });
    }))),
  } satisfies CmsRelations);
}
