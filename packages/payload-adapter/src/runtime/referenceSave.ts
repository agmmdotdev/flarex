import { Effect, type Scope } from "effect";
import { inspectPrivateReferenceSaveAccess, bindPrivateReferenceSaveAccess,
  type SessionJournalAttempt, type PrivateReferenceSaveAccess, type LogicalParticipantBorrow } from "@flarex/persistence-postgres/internal/session-journal";
import { cmsError, type CmsTransactionError } from "@flarex/persistence-postgres/internal/cms-adapter";
import { LogicalParticipantInvocationError } from "@flarex/persistence-postgres/internal/logical-participant-errors";
import { isJsonObject } from "flarex-protocol/json";
import { requireCompiledPayloadCollections, type CompiledPayloadCollections } from "../collections";
import { makePayloadNative, type PayloadNativeInstrumentation } from "./native";
import { makePayloadAttempt } from "./attempt";
import type { PayloadAttemptRuntime } from "../runtime";

/** Source-private test seam for native normalization/lifecycle observations.
 * Neither hooks nor caller data supply the protected permission decisions. */
export const makePayloadReferenceSave: (
  compiled: CompiledPayloadCollections, attempt: SessionJournalAttempt, access: PrivateReferenceSaveAccess,
  instrumentation?: PayloadNativeInstrumentation,
) => Effect.Effect<PayloadAttemptRuntime, CmsTransactionError, Scope.Scope> = Effect.fn("PayloadReferenceSave.make")(function* (
  compiled, attempt, access, instrumentation,
) {
  yield* requireCompiledPayloadCollections(compiled);
  const grant = inspectPrivateReferenceSaveAccess(access, attempt);
  if (grant === undefined || grant.configSha256 !== compiled.contentIdentity.configSha256 ||
    grant.provenanceSha256 !== compiled.contentIdentity.provenanceSha256 ||
    !compiled.configuration.tables.some(table => table.logicalTableName === grant.tableName && table.collectionSlug === grant.collection))
    return yield* Effect.fail(cmsError("invalidAuthority"));
  const token = Object.freeze({});
  const contextKey = "flarexPrivateReferenceSave";
  const allowed = (operation: "create" | "update" | "delete", context: Record<string, unknown>) =>
    context[contextKey] === token && inspectPrivateReferenceSaveAccess(access, attempt)?.source[operation] === true;
  const native = yield* makePayloadNative(compiled, instrumentation, {
    create: ({ req }) => allowed("create", req.context), update: ({ req }) => allowed("update", req.context),
    delete: ({ req }) => allowed("delete", req.context), read: () => false,
  });
  const runtime = yield* makePayloadAttempt(native, attempt, { ...instrumentation, requestContext: { [contextKey]: token } });
  const borrow = bindPrivateReferenceSaveAccess(access, runtime.borrowParticipant);
  const borrowParticipant: LogicalParticipantBorrow = Effect.fn("PayloadReferenceSave.borrow")(function* (input) {
    const borrowed = yield* borrow(input);
    return Object.freeze({ ...borrowed, invoke: Effect.fn("PayloadReferenceSave.invoke")(function* (method, args) {
      if (!isJsonObject(args) || args.collection !== grant.collection)
        return yield* Effect.fail(new LogicalParticipantInvocationError({ kind: "rejection", cause: cmsError("unsupportedProfile") }));
      return yield* borrowed.invoke(method, args);
    }) });
  });
  return Object.freeze({ borrowParticipant });
});

/** Private borrowed saves only; no alternate/direct writer is exposed. */
export const makePayloadReferenceSaveRuntime: (
  compiled: CompiledPayloadCollections, attempt: SessionJournalAttempt, access: PrivateReferenceSaveAccess,
) => Effect.Effect<PayloadAttemptRuntime, CmsTransactionError, Scope.Scope> = Effect.fn("PayloadReferenceSave.makeRuntime")(function* (
  compiled, attempt, access,
) { return yield* makePayloadReferenceSave(compiled, attempt, access); });
