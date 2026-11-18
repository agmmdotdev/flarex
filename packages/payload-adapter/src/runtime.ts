import { Effect, type Scope } from "effect";
import type { CmsTransactionError } from "@flarex/persistence-postgres/internal/cms-adapter";
import type { CmsCommandBinding, CmsReadBinding } from "@flarex/persistence-postgres/internal/cms-execution";
import type { CmsNativeBinding } from "@flarex/persistence-postgres/internal/cms-execution";
import type {
  LogicalParticipantBorrow,
  SessionJournalAttempt,
} from "@flarex/persistence-postgres/internal/session-journal";
import { makePayloadNative } from "./runtime/native";
import { bindPayloadDirect } from "./direct/binding";
import { makePayloadAttempt } from "./runtime/attempt";
import { registerPayloadRuntime } from "./runtime/registry";
import { requireCompiledPayloadCollections, type CompiledPayloadCollections } from "./collections";
import type { PayloadHost, PayloadReadHost } from "./api";

export type { PayloadHost, PayloadReadHost, PayloadCreateArgs, PayloadUpdateArgs, PayloadDeleteArgs,
  PayloadFindArgs, PayloadFindByIdArgs, PayloadCountArgs, PayloadDocument, PayloadPageResult, PayloadCountResult } from "./api";
export { makePayloadReferenceReadRuntime, makePayloadNativeReferenceRead } from "./runtime/referenceRead";
export { makePayloadReferenceSaveRuntime, makePayloadNativeReferenceSave } from "./runtime/referenceSave";
export { makePayloadReferencePagesRuntime, makePayloadNativeReferencePages } from "./runtime/referencePages";
export type { PayloadNativeInstrumentation } from "./runtime/native";
export interface PayloadAttemptRuntime {
  readonly borrowParticipant: LogicalParticipantBorrow;
}
export interface PayloadRuntime {
  /** Retained full-proof, relationships and borrowed consumers migrate separately. */
  readonly bind: (binding: CmsCommandBinding) => Effect.Effect<PayloadHost, CmsTransactionError>;
  readonly bindRead: (binding: CmsReadBinding) => Effect.Effect<PayloadReadHost, CmsTransactionError>;
  readonly bindNative: (binding: CmsNativeBinding) => Effect.Effect<PayloadHost, CmsTransactionError>;
  readonly bindNativeRead: (binding: CmsNativeBinding) => Effect.Effect<PayloadReadHost, CmsTransactionError>;
  readonly makeAttempt: (attempt: SessionJournalAttempt) => Effect.Effect<PayloadAttemptRuntime, CmsTransactionError, Scope.Scope>;
}
/** Each checked configuration has its own scoped native instance. */
export const makePayloadRuntime: (
  compiled: CompiledPayloadCollections,
) => Effect.Effect<PayloadRuntime, CmsTransactionError, Scope.Scope> =
  Effect.fn("PayloadAdapter.makeRuntime")(function* (compiled) {
    yield* requireCompiledPayloadCollections(compiled);
    const native = yield* makePayloadNative(compiled);
    const runtime: PayloadRuntime = Object.freeze({ ...bindPayloadDirect(native),
      makeAttempt: (attempt: SessionJournalAttempt) => makePayloadAttempt(native, attempt),
    });
    registerPayloadRuntime(runtime, native);
    return runtime;
  });
