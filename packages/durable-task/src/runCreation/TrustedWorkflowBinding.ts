import { copyBytes, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { Data, Effect, Result, Schema } from "effect";
import { encodeCanonicalJson } from "flarex-protocol/json";
import { createOwnedCanonicalFlarexRuntimeValueReaderV1, FLAREX_GENERAL_VALUE_LIMITS_V1, FlarexValueRuntimeCoreV1Error, normalizeFlarexRuntimeValueWithLimitsV1 } from "flarex-protocol/internal/value-runtime-core";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { TaskRunAttemptBoundPolicyV1Schema } from "../runAttempt/Schema.js";
import { TrustedWorkflowBindingSha256Schema } from "./TrustedWorkflowBindingDigest.js";

const Revision = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
const Profile = Schema.String.check(Schema.isPattern(/^[a-zA-Z][a-zA-Z0-9._-]{0,127}$/));
/** A binding selects one authenticated-user principal digest, not a caller label.
 * A different principal requires a different binding and request identity. */
export const TrustedWorkflowTaskDefinitionSchema = Schema.Struct({
  scopeId: ScopeIdSchema,
  workflowRevision: Revision,
  adapterRevision: Revision,
  executionProfile: Profile,
  executionPolicy: Schema.JsonObject,
  principalSha256: Revision,
  boundPolicy: TaskRunAttemptBoundPolicyV1Schema,
});
export type TrustedWorkflowTaskDefinition = typeof TrustedWorkflowTaskDefinitionSchema.Type;
const decodeDefinition = Schema.decodeUnknownResult(TrustedWorkflowTaskDefinitionSchema,
  { onExcessProperty: "error" });
const decodeDigest = Schema.decodeUnknownResult(TrustedWorkflowBindingSha256Schema);
const utf8 = new TextEncoder();
const maximumBindingBytes = 65_536;

export class TrustedWorkflowTaskBindingError extends Data.TaggedError("TrustedWorkflowTaskBindingError")<{
  readonly reason: "invalidDefinition" | "definitionTooLarge" | "invalidDigest" | "invalidBinding";
  readonly cause?: unknown;
}> {}

export interface TrustedWorkflowTaskBinding { readonly _TrustedWorkflowTaskBinding: unique symbol }
export interface TrustedWorkflowTaskBindingState {
  readonly definition: TrustedWorkflowTaskDefinition;
  readonly canonicalBytes: Uint8Array;
  readonly sha256: typeof TrustedWorkflowBindingSha256Schema.Type;
}
const bindings = new WeakMap<object, TrustedWorkflowTaskBindingState>();

/** Private trusted construction only. Hashing commits reviewed definition data;
 * neither the bytes nor the digest independently confer execution authority. */
export const prepareTrustedWorkflowTaskBinding = Effect.fn("TrustedWorkflowTask.prepareBinding")(
  function* <HashError>(input: unknown, sha256: (bytes: Uint8Array) => Effect.Effect<Uint8Array, HashError>) {
    const captured = yield* Effect.fromResult(Result.try({
      try: () => normalizeFlarexRuntimeValueWithLimitsV1(input, { ...FLAREX_GENERAL_VALUE_LIMITS_V1,
        maxSemanticBytes: maximumBindingBytes, maxNesting: 16, maxArrayItems: 256, maxObjectFields: 256 }),
      catch: cause => { if (cause instanceof FlarexValueRuntimeCoreV1Error) return new TrustedWorkflowTaskBindingError({ reason: "invalidDefinition", cause }); throw cause; },
    }));
    const decoded = yield* Effect.fromResult(decodeDefinition(captured.value)).pipe(Effect.mapError(cause =>
      new TrustedWorkflowTaskBindingError({ reason: "invalidDefinition", cause })));
    const canonicalText = encodeCanonicalJson({ codec: "flarex.trusted-workflow-task-binding.v1", definition: decoded },
      issue => { throw new Error(`Invalid trusted workflow binding canonical value: ${issue.reason}`); });
    const canonicalBytes = utf8.encode(canonicalText);
    if (canonicalBytes.byteLength > maximumBindingBytes)
      return yield* new TrustedWorkflowTaskBindingError({ reason: "definitionTooLarge" });
    // The protocol owns bounded no-getter capture and immutable tree mechanics.
    createOwnedCanonicalFlarexRuntimeValueReaderV1(decoded);
    const definition = decoded;
    const digest = yield* sha256(copyBytes(canonicalBytes));
    const ownedDigest = yield* Effect.fromResult(decodeDigest(copyBytes(digest))).pipe(Effect.mapError(cause =>
      new TrustedWorkflowTaskBindingError({ reason: "invalidDigest", cause })));
    // SAFETY: only WeakMap membership authenticates this empty private handle.
    const binding = Object.freeze({}) as TrustedWorkflowTaskBinding;
    bindings.set(binding, { definition, canonicalBytes, sha256: ownedDigest });
    return binding;
  },
);

/** Trusted owner seam. Return owned digest/bytes; never expose stored mutable views. */
export function inspectTrustedWorkflowTaskBinding(binding: TrustedWorkflowTaskBinding): Result.Result<
  TrustedWorkflowTaskBindingState, TrustedWorkflowTaskBindingError
> {
  const state = bindings.get(binding);
  return state === undefined ? Result.fail(new TrustedWorkflowTaskBindingError({ reason: "invalidBinding" }))
    : decodeDigest(copyBytes(state.sha256)).pipe(Result.map(sha256 => ({ definition: state.definition,
      canonicalBytes: copyBytes(state.canonicalBytes), sha256 })), Result.mapError(cause =>
      new TrustedWorkflowTaskBindingError({ reason: "invalidDigest", cause })));
}

export function trustedWorkflowPrincipalMatches(binding: TrustedWorkflowTaskBindingState, digest: Uint8Array): boolean {
  return encodeBytesToLowercaseHex(digest) === binding.definition.principalSha256;
}
