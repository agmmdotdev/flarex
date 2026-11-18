import { Effect, Option, Result } from "effect";
import { decodeDocumentId } from "flarex-protocol/document-id";
import type { CoreNativeOperations } from "../../core/api";
import type { CmsRequestLifetime } from "./lifetime";
import { cmsError } from "./model";
import { nativeResult } from "./nativeFailure";
import type { CmsRelations } from "./relations";

/** The trusted host derives target tables from its authenticated definition.
 * Core owns indexed source observations; this request owns join admission. */
export function makeNativeCmsRelations(operations: CoreNativeOperations, lifetime: CmsRequestLifetime,
  referenceTargets: ReadonlyMap<string, string>, standalone: boolean): CmsRelations {
  const targets = new Map(referenceTargets);
  let windows = 0;
  let inspected = 0;
  return Object.freeze({ incoming: Effect.fn("NativeCmsRelations.incoming")((context, id, source, target, limit) => lifetime.operation(context, id, "read",
    Effect.gen(function* () {
      if (!standalone || lifetime.mode !== "read" || context !== lifetime.context) return yield* Effect.fail(cmsError("invalidAuthority"));
      const table = targets.get(source);
      if (table === undefined) return yield* Effect.fail(cmsError("invalidAuthority"));
      yield* Effect.fromResult(decodeDocumentId(target).pipe(
        Result.mapError(cause => cmsError("invalidInput", cause))));
      const normalized = yield* nativeResult(operations.normalizeId(table, target));
      if (Option.isNone(normalized) || normalized.value !== target) return yield* Effect.fail(cmsError("invalidInput"));
      if (Option.isNone(yield* nativeResult(operations.get(target)))) return yield* Effect.fail(cmsError("documentMissing"));
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 16) return yield* Effect.fail(cmsError("invalidInput"));
      if (++windows > 64) return yield* Effect.fail(cmsError("limitExceeded"));
      yield* lifetime.fromResult(lifetime.charge((limit + 1) * 128));
      const page = yield* nativeResult(operations.incomingReferences(source, target, { limit }));
      inspected += page.inspectedMemberships;
      if (inspected > 1088) return yield* Effect.fail(cmsError("limitExceeded"));
      return Object.freeze({ docs: Object.freeze([...page.ids]), hasNextPage: page.hasMore });
    }))),
  } satisfies CmsRelations);
}
